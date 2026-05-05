"""
CHMI precipitation radar feed — fetches the latest MAX-Z composite PNG
from the Czech Hydrometeorological Institute's open-data index, caches
it in memory, and exposes a snapshot dict + raw image bytes.
"""

from __future__ import annotations

import re
import time
from datetime import datetime, timezone
from threading import Lock
from urllib.request import Request, urlopen

import os


CHMI_CACHE_TTL_SECONDS = int(os.environ.get("CHMI_CACHE_TTL_SECONDS", "30"))
CHMI_MAXZ_INDEX_URL = "https://opendata.chmi.cz/meteorology/weather/radar/composite/maxz/png/"
CHMI_MAXZ_FILENAME_RE = re.compile(
    r"pacz2gmaps3\.z_max3d\.(\d{8})\.(\d{4})\.0\.png"
)
CHMI_CURRENT_IMAGE_PATH = "/api/chmi/precipitation/current.png"
CHMI_FRAME_IMAGE_PATH_TEMPLATE = "/api/chmi/precipitation/frame/{filename}"
CHMI_FRAME_HISTORY_LIMIT = 10

CHMI_RADAR_BOUNDS = {
    "south": 48.047,
    "west":  11.267,
    "north": 52.167,
    "east":  20.770,
}


def _isoformat_z(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _fetch_text(url: str) -> str:
    req = Request(url, headers={"User-Agent": "CansatTelemetryDashboard/1.0"})
    with urlopen(req, timeout=10) as response:
        return response.read().decode("utf-8", errors="replace")


def _fetch_bytes(url: str) -> bytes:
    req = Request(url, headers={"User-Agent": "CansatTelemetryDashboard/1.0"})
    with urlopen(req, timeout=10) as response:
        return response.read()


def _build_frame_metadata(filename: str, checked_at_utc: datetime) -> dict[str, object]:
    match = CHMI_MAXZ_FILENAME_RE.fullmatch(filename)
    if not match:
        raise ValueError(f"Invalid CHMI radar frame filename: {filename}")
    frame_time_utc = datetime.strptime(
        f"{match.group(1)}{match.group(2)}", "%Y%m%d%H%M"
    ).replace(tzinfo=timezone.utc)
    return {
        "filename":       filename,
        "imagePath":      CHMI_FRAME_IMAGE_PATH_TEMPLATE.format(filename=filename),
        "frameTimeUtc":   _isoformat_z(frame_time_utc),
        "frameTimeLocal": frame_time_utc.astimezone().isoformat(),
        "ageMinutes":     round(
            max((checked_at_utc - frame_time_utc).total_seconds(), 0) / 60.0, 1
        ),
    }


class ChmiPrecipitationFeed:
    """Thread-safe in-memory cache for the CHMI MAX-Z radar product."""

    def __init__(self) -> None:
        self._lock = Lock()
        self._snapshot: dict[str, object] | None = None
        self._expires_at = 0.0
        self._image_bytes: bytes | None = None

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    def snapshot(self, force: bool = False) -> dict[str, object]:
        """Return a (potentially cached) metadata snapshot dict."""
        now = time.time()
        with self._lock:
            if not force and self._snapshot is not None and now < self._expires_at:
                return dict(self._snapshot)

            previous = dict(self._snapshot) if self._snapshot is not None else None

            try:
                snap = self._fetch_snapshot()
            except Exception as exc:
                if previous is not None and self._image_bytes is not None:
                    stale = {
                        **previous,
                        "ok":           True,
                        "stale":        True,
                        "error":        str(exc),
                        "checkedAtUtc": _isoformat_z(datetime.now(timezone.utc)),
                    }
                    self._snapshot = stale
                    self._expires_at = now + min(CHMI_CACHE_TTL_SECONDS, 30)
                    return dict(stale)

                err_snap = self._empty_snapshot(str(exc))
                self._snapshot = err_snap
                self._expires_at = now + min(CHMI_CACHE_TTL_SECONDS, 30)
                return dict(err_snap)

            self._snapshot = snap
            self._expires_at = now + CHMI_CACHE_TTL_SECONDS
            return dict(snap)

    def image_bytes(self) -> bytes | None:
        """Return the raw PNG bytes of the most recently fetched frame."""
        return self._image_bytes

    def fetch_frame_bytes(self, filename: str) -> bytes:
        """Fetch the PNG for a specific historical frame filename."""
        return _fetch_bytes(f"{CHMI_MAXZ_INDEX_URL}{filename}")

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _fetch_snapshot(self) -> dict[str, object]:
        frame = self._fetch_latest_frame()
        checked_at_utc = datetime.now(timezone.utc)
        self._image_bytes = frame.pop("_imageBytes")
        return {
            "ok":           True,
            "stale":        False,
            "provider":     "CHMI",
            "product":      "maxz",
            "label":        "Live MAX_Z radar over the Czech Republic",
            "sourceUrl":    CHMI_MAXZ_INDEX_URL,
            "bounds":       CHMI_RADAR_BOUNDS,
            "checkedAtUtc": _isoformat_z(checked_at_utc),
            "error":        None,
            **frame,
        }

    def _fetch_latest_frame(self) -> dict[str, object]:
        listing_html = _fetch_text(CHMI_MAXZ_INDEX_URL)
        matches = list(CHMI_MAXZ_FILENAME_RE.finditer(listing_html))
        if not matches:
            raise ValueError("CHMI did not return any current radar frames.")

        ordered_matches = sorted(matches, key=lambda m: (m.group(1), m.group(2)))
        seen: set[str] = set()
        ordered_filenames: list[str] = []
        for m in ordered_matches:
            fn = m.group(0)
            if fn not in seen:
                seen.add(fn)
                ordered_filenames.append(fn)

        filename = ordered_filenames[-1]
        recent_filenames = ordered_filenames[-CHMI_FRAME_HISTORY_LIMIT:]

        full_match = CHMI_MAXZ_FILENAME_RE.fullmatch(filename)
        frame_time_utc = datetime.strptime(
            f"{full_match.group(1)}{full_match.group(2)}", "%Y%m%d%H%M"
        ).replace(tzinfo=timezone.utc)

        image_bytes = _fetch_bytes(f"{CHMI_MAXZ_INDEX_URL}{filename}")
        checked_at_utc = datetime.now(timezone.utc)

        return {
            "imagePath":      CHMI_CURRENT_IMAGE_PATH,
            "product":        "MAX_Z",
            "filename":       filename,
            "frameTimeUtc":   _isoformat_z(frame_time_utc),
            "frameTimeLocal": frame_time_utc.astimezone().isoformat(),
            "ageMinutes":     round(
                max((checked_at_utc - frame_time_utc).total_seconds(), 0) / 60.0, 1
            ),
            "frames": [
                _build_frame_metadata(fn, checked_at_utc)
                for fn in reversed(recent_filenames)
            ],
            "_imageBytes": image_bytes,
        }

    def _empty_snapshot(self, error: str) -> dict[str, object]:
        return {
            "ok":           False,
            "stale":        False,
            "provider":     "CHMI",
            "product":      "maxz",
            "label":        "Live MAX_Z radar over the Czech Republic",
            "sourceUrl":    CHMI_MAXZ_INDEX_URL,
            "bounds":       CHMI_RADAR_BOUNDS,
            "imagePath":    None,
            "imageUrl":     None,
            "filename":     None,
            "frameTimeUtc": None,
            "frameTimeLocal": None,
            "ageMinutes":   None,
            "frames":       [],
            "checkedAtUtc": _isoformat_z(datetime.now(timezone.utc)),
            "error":        error,
        }