#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime, timezone
from threading import Lock
from urllib.request import Request, urlopen

from flask import Flask, Response, jsonify, request, stream_with_context
from flask_cors import CORS

from fpv_radio_live import DEFAULT_BAUD, RadioTelemetryService


BACKEND_PORT = int(os.environ.get("BACKEND_PORT", "5001"))
FRONTEND_PORT = int(os.environ.get("FRONTEND_PORT", "3000"))
FLASK_DEBUG = os.environ.get("FLASK_DEBUG", "").lower() in {"1", "true", "yes", "on"}
CHMI_CACHE_TTL_SECONDS = int(os.environ.get("CHMI_CACHE_TTL_SECONDS", "30"))
CHMI_MAXZ_INDEX_URL = "https://opendata.chmi.cz/meteorology/weather/radar/composite/maxz/png/"
CHMI_MAXZ_FILENAME_RE = re.compile(r"pacz2gmaps3\.z_max3d\.(\d{8})\.(\d{4})\.0\.png")
CHMI_CURRENT_IMAGE_PATH = "/api/chmi/precipitation/current.png"
CHMI_FRAME_IMAGE_PATH_TEMPLATE = "/api/chmi/precipitation/frame/{filename}"
CHMI_FRAME_HISTORY_LIMIT = 10
CHMI_RADAR_BOUNDS = {
    "south": 48.047,
    "west": 11.267,
    "north": 52.167,
    "east": 20.770,
}

app = Flask(__name__)
CORS(
    app,
    resources={
        r"/api/*": {
            "origins": "*"
        }
    },
)

service = RadioTelemetryService()


def isoformat_z(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


class ChmiPrecipitationFeed:
    def __init__(self) -> None:
        self._lock = Lock()
        self._snapshot: dict[str, object] | None = None
        self._expires_at = 0.0
        self._image_bytes: bytes | None = None

    def snapshot(self, force: bool = False) -> dict[str, object]:
        now = time.time()

        with self._lock:
            if not force and self._snapshot is not None and now < self._expires_at:
                return dict(self._snapshot)

            previous = dict(self._snapshot) if self._snapshot is not None else None

            try:
                snapshot = self._fetch_snapshot()
            except Exception as exc:
                has_cached_image = self._image_bytes is not None
                if previous is not None and has_cached_image:
                    stale_snapshot = {
                        **previous,
                        "ok": True,
                        "stale": True,
                        "error": str(exc),
                        "checkedAtUtc": isoformat_z(datetime.now(timezone.utc)),
                    }
                    self._snapshot = stale_snapshot
                    self._expires_at = now + min(CHMI_CACHE_TTL_SECONDS, 30)
                    return dict(stale_snapshot)

                error_snapshot = self._empty_snapshot(str(exc))
                self._snapshot = error_snapshot
                self._expires_at = now + min(CHMI_CACHE_TTL_SECONDS, 30)
                return dict(error_snapshot)

            self._snapshot = snapshot
            self._expires_at = now + CHMI_CACHE_TTL_SECONDS
            return dict(snapshot)

    def _fetch_snapshot(self) -> dict[str, object]:
        frame = self._fetch_latest_frame()
        checked_at_utc = datetime.now(timezone.utc)
        self._image_bytes = frame.pop("_imageBytes")

        return {
            "ok": True,
            "stale": False,
            "provider": "CHMI",
            "product": "maxz",
            "label": "Live MAX_Z radar over the Czech Republic",
            "sourceUrl": CHMI_MAXZ_INDEX_URL,
            "bounds": CHMI_RADAR_BOUNDS,
            "checkedAtUtc": isoformat_z(checked_at_utc),
            "error": None,
            **frame,
        }

    def image_bytes(self) -> bytes | None:
        return self._image_bytes

    def _fetch_latest_frame(self) -> dict[str, object]:
        listing_html = self._fetch_text(CHMI_MAXZ_INDEX_URL)
        matches = list(CHMI_MAXZ_FILENAME_RE.finditer(listing_html))
        if not matches:
            raise ValueError("CHMI did not return any current radar frames.")

        ordered_matches = sorted(matches, key=lambda match: (match.group(1), match.group(2)))
        ordered_filenames: list[str] = []
        seen_filenames: set[str] = set()
        for match in ordered_matches:
            filename = match.group(0)
            if filename in seen_filenames:
                continue
            seen_filenames.add(filename)
            ordered_filenames.append(filename)

        filename = ordered_filenames[-1]
        recent_filenames = ordered_filenames[-CHMI_FRAME_HISTORY_LIMIT:]
        frame_time_utc = datetime.strptime(
            f"{CHMI_MAXZ_FILENAME_RE.fullmatch(filename).group(1)}{CHMI_MAXZ_FILENAME_RE.fullmatch(filename).group(2)}",
            "%Y%m%d%H%M",
        ).replace(tzinfo=timezone.utc)
        image_bytes = self._fetch_bytes(f"{CHMI_MAXZ_INDEX_URL}{filename}")
        checked_at_utc = datetime.now(timezone.utc)

        return {
            "imagePath": CHMI_CURRENT_IMAGE_PATH,
            "product": "MAX_Z",
            "filename": filename,
            "frameTimeUtc": isoformat_z(frame_time_utc),
            "frameTimeLocal": frame_time_utc.astimezone().isoformat(),
            "ageMinutes": round(max((checked_at_utc - frame_time_utc).total_seconds(), 0) / 60.0, 1),
            "frames": [
                self._build_frame_metadata(frame_filename, checked_at_utc)
                for frame_filename in reversed(recent_filenames)
            ],
            "_imageBytes": image_bytes,
        }

    def _build_frame_metadata(self, filename: str, checked_at_utc: datetime) -> dict[str, object]:
        match = CHMI_MAXZ_FILENAME_RE.fullmatch(filename)
        if not match:
            raise ValueError(f"Invalid CHMI radar frame filename: {filename}")

        frame_time_utc = datetime.strptime(
            f"{match.group(1)}{match.group(2)}",
            "%Y%m%d%H%M",
        ).replace(tzinfo=timezone.utc)

        return {
            "filename": filename,
            "imagePath": CHMI_FRAME_IMAGE_PATH_TEMPLATE.format(filename=filename),
            "frameTimeUtc": isoformat_z(frame_time_utc),
            "frameTimeLocal": frame_time_utc.astimezone().isoformat(),
            "ageMinutes": round(max((checked_at_utc - frame_time_utc).total_seconds(), 0) / 60.0, 1),
        }

    def _fetch_text(self, url: str) -> str:
        request_obj = Request(url, headers={"User-Agent": "CansatTelemetryDashboard/1.0"})
        with urlopen(request_obj, timeout=10) as response:
            return response.read().decode("utf-8", errors="replace")

    def _fetch_bytes(self, url: str) -> bytes:
        request_obj = Request(url, headers={"User-Agent": "CansatTelemetryDashboard/1.0"})
        with urlopen(request_obj, timeout=10) as response:
            return response.read()

    def _empty_snapshot(self, error: str) -> dict[str, object]:
        return {
            "ok": False,
            "stale": False,
            "provider": "CHMI",
            "product": "maxz",
            "label": "Live MAX_Z radar over the Czech Republic",
            "sourceUrl": CHMI_MAXZ_INDEX_URL,
            "bounds": CHMI_RADAR_BOUNDS,
            "imagePath": None,
            "imageUrl": None,
            "filename": None,
            "frameTimeUtc": None,
            "frameTimeLocal": None,
            "ageMinutes": None,
            "frames": [],
            "checkedAtUtc": isoformat_z(datetime.now(timezone.utc)),
            "error": error,
        }


chmi_precipitation_feed = ChmiPrecipitationFeed()


def with_chmi_public_urls(snapshot: dict[str, object], host_url: str) -> dict[str, object]:
    public = dict(snapshot)
    base = host_url.rstrip("/")
    image_path = public.get("imagePath")
    if isinstance(image_path, str):
        public["imageUrl"] = f"{base}{image_path}"
    else:
        public["imageUrl"] = None

    frames = public.get("frames")
    if isinstance(frames, list):
        public["frames"] = [
            {
                **frame,
                "imageUrl": f"{base}{frame['imagePath']}" if isinstance(frame.get("imagePath"), str) else None,
            }
            for frame in frames
            if isinstance(frame, dict)
        ]

    return public


def ensure_service_connected() -> None:
    snapshot = service.snapshot()
    if snapshot["connected"]:
        return
    if service.is_busy():
        return
    service.auto_connect()


@app.get("/api/health")
def health() -> Response:
    ensure_service_connected()
    snapshot = service.snapshot()
    return jsonify(
        {
            "ok": True,
            "backendPort": BACKEND_PORT,
            "frontendPort": FRONTEND_PORT,
            "connectionState": snapshot["connectionState"],
            "connected": snapshot["connected"],
        }
    )


@app.get("/api/ports")
def ports() -> Response:
    ensure_service_connected()
    return jsonify(service.list_ports())


@app.post("/api/connect")
def connect() -> Response:
    payload = request.get_json(silent=True) or {}
    port = payload.get("port")
    baud = int(payload.get("baud") or DEFAULT_BAUD)
    return jsonify(service.connect(port=port, baud=baud))


@app.post("/api/disconnect")
def disconnect() -> Response:
    return jsonify(service.disconnect())


@app.get("/api/telemetry")
def telemetry() -> Response:
    ensure_service_connected()
    return jsonify(service.snapshot())


@app.get("/api/chmi/precipitation")
def chmi_precipitation() -> Response:
    force = request.args.get("refresh", "").lower() in {"1", "true", "yes", "on"}
    snapshot = chmi_precipitation_feed.snapshot(force=force)
    return jsonify(with_chmi_public_urls(snapshot, request.host_url))


@app.get(CHMI_CURRENT_IMAGE_PATH)
def chmi_precipitation_current_image() -> Response:
    force = request.args.get("refresh", "").lower() in {"1", "true", "yes", "on"}
    chmi_precipitation_feed.snapshot(force=force)
    image_bytes = chmi_precipitation_feed.image_bytes()
    if image_bytes is None:
        return Response("CHMI current radar image is not available.", status=404, mimetype="text/plain")

    response = Response(image_bytes, mimetype="image/png")
    response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/api/chmi/precipitation/frame/<filename>")
def chmi_precipitation_frame_image(filename: str) -> Response:
    if CHMI_MAXZ_FILENAME_RE.fullmatch(filename) is None:
        return Response("Invalid CHMI frame filename.", status=404, mimetype="text/plain")

    image_bytes = chmi_precipitation_feed._fetch_bytes(f"{CHMI_MAXZ_INDEX_URL}{filename}")
    response = Response(image_bytes, mimetype="image/png")
    response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/api/stream")
def stream() -> Response:
    ensure_service_connected()

    def event_stream():
        last_version = -1
        while True:
            ensure_service_connected()
            changed, last_version, snapshot = service.wait_for_update(last_version, timeout=2.0)
            if changed:
                yield f"data: {json.dumps(snapshot)}\n\n"
            else:
                yield ": heartbeat\n\n"

    response = Response(stream_with_context(event_stream()), mimetype="text/event-stream")
    response.headers["Cache-Control"] = "no-cache"
    response.headers["X-Accel-Buffering"] = "no"
    return response


if __name__ == "__main__":
    ensure_service_connected()
    app.run(
        host="0.0.0.0",
        port=BACKEND_PORT,
        debug=FLASK_DEBUG,
        threaded=True,
        use_reloader=False,
    )
