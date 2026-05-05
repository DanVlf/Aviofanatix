#!/usr/bin/env python3
"""
Flask backend — only HTTP routes.

All business logic lives in the sub-packages:
  crsf/         — protocol constants, parser, decoders
  telemetry/    — TelemetryState (collected values), serial I/O, service, recording
  radar/        — CHMI precipitation feed
"""

from __future__ import annotations

import json
import os

from flask import Flask, Response, jsonify, request, stream_with_context
from flask_cors import CORS

from radar.chmi import CHMI_MAXZ_FILENAME_RE, ChmiPrecipitationFeed
from telemetry.recording import RecordingService
from telemetry.serial_io import DEFAULT_BAUD
from telemetry.service import RadioTelemetryService


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

BACKEND_PORT = int(os.environ.get("BACKEND_PORT", "5001"))
FRONTEND_PORT = int(os.environ.get("FRONTEND_PORT", "3000"))
FLASK_DEBUG = os.environ.get("FLASK_DEBUG", "").lower() in {"1", "true", "yes", "on"}


# ---------------------------------------------------------------------------
# Singletons
# ---------------------------------------------------------------------------

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

service = RadioTelemetryService()
chmi_feed = ChmiPrecipitationFeed()
recorder = RecordingService(service)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _with_public_urls(snapshot: dict[str, object], host_url: str) -> dict[str, object]:
    """Attach absolute imageUrl fields based on the current request host."""
    public = dict(snapshot)
    base = host_url.rstrip("/")
    image_path = public.get("imagePath")
    public["imageUrl"] = f"{base}{image_path}" if isinstance(image_path, str) else None

    frames = public.get("frames")
    if isinstance(frames, list):
        public["frames"] = [
            {
                **frame,
                "imageUrl": (
                    f"{base}{frame['imagePath']}"
                    if isinstance(frame.get("imagePath"), str)
                    else None
                ),
            }
            for frame in frames
            if isinstance(frame, dict)
        ]
    return public


def _ensure_connected() -> None:
    snap = service.snapshot()
    if snap["connected"]:
        return
    if service.is_busy():
        return
    service.auto_connect()


# ---------------------------------------------------------------------------
# Routes — health / ports / connection
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health() -> Response:
    _ensure_connected()
    snap = service.snapshot()
    return jsonify({
        "ok":              True,
        "backendPort":     BACKEND_PORT,
        "frontendPort":    FRONTEND_PORT,
        "connectionState": snap["connectionState"],
        "connected":       snap["connected"],
        "recording":       recorder.status(),
    })


@app.get("/api/ports")
def ports() -> Response:
    _ensure_connected()
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


# ---------------------------------------------------------------------------
# Routes — telemetry
# ---------------------------------------------------------------------------

@app.get("/api/telemetry")
def telemetry() -> Response:
    _ensure_connected()
    return jsonify(service.snapshot())


@app.get("/api/stream")
def stream() -> Response:
    _ensure_connected()

    def event_stream():
        last_version = -1
        while True:
            _ensure_connected()
            changed, last_version, snap = service.wait_for_update(last_version, timeout=2.0)
            if changed:
                yield f"data: {json.dumps(snap)}\n\n"
            else:
                yield ": heartbeat\n\n"

    response = Response(stream_with_context(event_stream()), mimetype="text/event-stream")
    response.headers["Cache-Control"] = "no-cache"
    response.headers["X-Accel-Buffering"] = "no"
    return response


# ---------------------------------------------------------------------------
# Routes — recording
# ---------------------------------------------------------------------------

@app.get("/api/recordings")
def recordings_list() -> Response:
    return jsonify({
        "recordings": recorder.list_recordings(),
        "status": recorder.status(),
    })


@app.post("/api/recordings/start")
def recordings_start() -> Response:
    return jsonify(recorder.start())


@app.post("/api/recordings/stop")
def recordings_stop() -> Response:
    return jsonify(recorder.stop())


@app.get("/api/recordings/status")
def recordings_status() -> Response:
    return jsonify(recorder.status())


@app.get("/api/recordings/<filename>")
def recordings_load(filename: str) -> Response:
    frames = recorder.load_recording(filename)
    if frames is None:
        return Response("Recording not found.", status=404, mimetype="text/plain")
    return jsonify({
        "filename": filename,
        "frameCount": len(frames),
        "frames": frames,
    })


@app.delete("/api/recordings/<filename>")
def recordings_delete(filename: str) -> Response:
    deleted = recorder.delete_recording(filename)
    return jsonify({"deleted": deleted, "filename": filename})


# ---------------------------------------------------------------------------
# Routes — CHMI radar
# ---------------------------------------------------------------------------

@app.get("/api/chmi/precipitation")
def chmi_precipitation() -> Response:
    force = request.args.get("refresh", "").lower() in {"1", "true", "yes", "on"}
    snap = chmi_feed.snapshot(force=force)
    return jsonify(_with_public_urls(snap, request.host_url))


@app.get("/api/chmi/precipitation/current.png")
def chmi_precipitation_current_image() -> Response:
    force = request.args.get("refresh", "").lower() in {"1", "true", "yes", "on"}
    chmi_feed.snapshot(force=force)
    image_bytes = chmi_feed.image_bytes()
    if image_bytes is None:
        return Response("CHMI current radar image is not available.", status=404, mimetype="text/plain")
    response = Response(image_bytes, mimetype="image/png")
    response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/api/chmi/precipitation/frame/<filename>")
def chmi_precipitation_frame_image(filename: str) -> Response:
    if CHMI_MAXZ_FILENAME_RE.fullmatch(filename) is None:
        return Response("Invalid CHMI frame filename.", status=404, mimetype="text/plain")
    image_bytes = chmi_feed.fetch_frame_bytes(filename)
    response = Response(image_bytes, mimetype="image/png")
    response.headers["Cache-Control"] = "no-store"
    return response


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    _ensure_connected()
    app.run(
        host="0.0.0.0",
        port=BACKEND_PORT,
        debug=FLASK_DEBUG,
        threaded=True,
        use_reloader=False,
    )
