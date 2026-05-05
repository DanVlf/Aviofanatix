"""
RecordingService — records live telemetry snapshots to JSONL files.

Each line in the file is one JSON object:
  { "t": <wall_time_iso_z>, "elapsed": <seconds_float>, "snap": <telemetry_snapshot> }
"""

from __future__ import annotations

import json
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from telemetry.service import RadioTelemetryService


RECORDINGS_DIR = Path(__file__).parent.parent / "recordings"


def _isoformat_z(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _is_valid_recording_filename(filename: str) -> bool:
    return Path(filename).name == filename and filename.endswith(".jsonl")


class RecordingService:
    def __init__(
        self,
        telemetry_service: RadioTelemetryService,
        recordings_dir: Path = RECORDINGS_DIR,
    ) -> None:
        self._telemetry_service = telemetry_service
        self._dir = recordings_dir
        self._dir.mkdir(parents=True, exist_ok=True)

        self._lock = threading.Lock()
        self._active = False
        self._file: Any = None
        self._filename: str | None = None
        self._started_at_wall: datetime | None = None
        self._started_at_mono: float | None = None
        self._frame_count = 0
        self._worker: threading.Thread | None = None
        self._stop_event: threading.Event | None = None

    def start(self) -> dict[str, object]:
        with self._lock:
            if self._active:
                return self._status_locked()

            now_wall = _now_utc()
            stamp = now_wall.strftime("%Y-%m-%d_%H-%M-%S")
            filename = f"{stamp}.jsonl"
            path = self._dir / filename

            self._file = open(path, "w", encoding="utf-8", buffering=1)
            self._filename = filename
            self._started_at_wall = now_wall
            self._started_at_mono = time.monotonic()
            self._frame_count = 0
            self._active = True

            stop_event = threading.Event()
            worker = threading.Thread(
                target=self._recording_loop,
                name="telemetry-recorder",
                daemon=True,
                args=(stop_event,),
            )
            self._stop_event = stop_event
            self._worker = worker

        worker.start()
        return self.status()

    def stop(self) -> dict[str, object]:
        with self._lock:
            if not self._active:
                return self._status_locked()
            self._active = False
            stop_event = self._stop_event
            worker = self._worker

        if stop_event is not None:
            stop_event.set()
        if worker is not None and worker.is_alive() and worker is not threading.current_thread():
            worker.join(timeout=2.0)

        with self._lock:
            if self._file is not None:
                self._file.close()
                self._file = None
            self._worker = None
            self._stop_event = None
            return self._status_locked()

    def list_recordings(self) -> list[dict[str, object]]:
        recordings: list[dict[str, object]] = []
        for path in sorted(self._dir.glob("*.jsonl"), reverse=True):
            stat = path.stat()
            line_count = 0
            try:
                with open(path, encoding="utf-8") as file_obj:
                    for _ in file_obj:
                        line_count += 1
            except OSError:
                pass

            recordings.append(
                {
                    "filename": path.name,
                    "sizeBytes": stat.st_size,
                    "frameCount": line_count,
                    "modifiedUtc": _isoformat_z(datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)),
                }
            )
        return recordings

    def load_recording(self, filename: str) -> list[dict[str, Any]] | None:
        path = self._resolve_recording_path(filename)
        if path is None or not path.exists():
            return None

        frames: list[dict[str, Any]] = []
        with open(path, encoding="utf-8") as file_obj:
            for line in file_obj:
                line = line.strip()
                if not line:
                    continue
                try:
                    frames.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
        return frames

    def delete_recording(self, filename: str) -> bool:
        path = self._resolve_recording_path(filename)
        if path is None or not path.exists():
            return False

        with self._lock:
            if self._active and self._filename == filename:
                return False

        path.unlink()
        return True

    def status(self) -> dict[str, object]:
        with self._lock:
            return self._status_locked()

    def is_active(self) -> bool:
        with self._lock:
            return self._active

    def record_snapshot(self, snap: dict[str, Any]) -> None:
        with self._lock:
            if not self._active or self._file is None or self._started_at_mono is None:
                return

            elapsed = time.monotonic() - self._started_at_mono
            entry = {
                "t": _isoformat_z(_now_utc()),
                "elapsed": round(elapsed, 3),
                "snap": snap,
            }
            self._file.write(json.dumps(entry, separators=(",", ":")) + "\n")
            self._frame_count += 1

    def _resolve_recording_path(self, filename: str) -> Path | None:
        if not _is_valid_recording_filename(filename):
            return None
        return self._dir / filename

    def _recording_loop(self, stop_event: threading.Event) -> None:
        last_version, initial_snapshot = self._telemetry_service.snapshot_with_version()
        self.record_snapshot(initial_snapshot)

        while not stop_event.is_set():
            changed, last_version, snap = self._telemetry_service.wait_for_update(last_version, timeout=1.0)
            if not changed:
                continue
            self.record_snapshot(snap)

    def _status_locked(self) -> dict[str, object]:
        elapsed = None
        if self._active and self._started_at_mono is not None:
            elapsed = round(time.monotonic() - self._started_at_mono, 1)

        return {
            "recording": self._active,
            "filename": self._filename,
            "startedAtUtc": _isoformat_z(self._started_at_wall) if self._started_at_wall else None,
            "elapsedSeconds": elapsed,
            "frameCount": self._frame_count,
        }
