"""
RadioTelemetryService — manages the background reader thread and exposes a
thread-safe snapshot / SSE interface for the Flask layer.
"""

from __future__ import annotations

import threading
import time
from typing import Any

import serial

from crsf.parser import extract_crsf_frames
from telemetry.ports import auto_select_port, list_candidate_ports, list_serial_ports_snapshot
from telemetry.serial_io import (
    DEFAULT_BAUD,
    DEFAULT_CHUNK_SIZE,
    DEFAULT_LISTEN_WINDOW,
    DEFAULT_TIMEOUT,
    open_serial,
    read_window,
)
from telemetry.state import TelemetryState, update_telemetry_state


class RadioTelemetryService:
    def __init__(
        self,
        baud: int = DEFAULT_BAUD,
        timeout: float = DEFAULT_TIMEOUT,
        chunk_size: int = DEFAULT_CHUNK_SIZE,
        listen_window: float = DEFAULT_LISTEN_WINDOW,
    ) -> None:
        self.default_baud = baud
        self.timeout = timeout
        self.chunk_size = chunk_size
        self.listen_window = listen_window

        self._lock = threading.Lock()
        self._condition = threading.Condition(self._lock)
        self._version = 0
        self._state = TelemetryState()
        self._connection_state = "disconnected"
        self._connected = False
        self._port: str | None = None
        self._baud: int | None = None
        self._last_error: str | None = None
        self._thread: threading.Thread | None = None
        self._stop_event: threading.Event | None = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return self._snapshot_locked()

    def list_ports(self) -> dict[str, Any]:
        snap = list_serial_ports_snapshot()
        with self._lock:
            current_port = self._port
        for port in snap["ports"]:
            if current_port and port["device"] == current_port:
                port["selected"] = True
        return snap

    def is_busy(self) -> bool:
        with self._lock:
            return self._thread is not None and self._thread.is_alive()

    def auto_connect(self) -> dict[str, Any]:
        if self.is_busy():
            return self.snapshot()
        port_snapshot = self.list_ports()
        suggested_port = port_snapshot["suggestedPort"]
        if suggested_port is None:
            return self.snapshot()
        return self.connect(port=suggested_port, baud=self.default_baud)

    def connect(self, port: str | None = None, baud: int | None = None) -> dict[str, Any]:
        if port is None:
            selected = auto_select_port(list_candidate_ports())
            if selected is None:
                with self._lock:
                    self._connection_state = "disconnected"
                    self._last_error = "No likely radio serial port found."
                    self._publish_locked()
                    return self._snapshot_locked()
            port = selected.device

        baud = baud or self.default_baud
        self.disconnect(join_timeout=0.5)

        stop_event = threading.Event()
        thread = threading.Thread(
            target=self._reader_loop,
            name="radio-telemetry-reader",
            daemon=True,
            args=(port, baud, stop_event),
        )
        with self._lock:
            self._state = TelemetryState()
            self._connection_state = "connecting"
            self._connected = False
            self._port = port
            self._baud = baud
            self._last_error = None
            self._stop_event = stop_event
            self._thread = thread
            self._publish_locked()
        thread.start()
        return self.snapshot()

    def disconnect(self, join_timeout: float = 1.0) -> dict[str, Any]:
        with self._lock:
            stop_event = self._stop_event
            thread = self._thread

        if stop_event is not None:
            stop_event.set()
        if thread is not None and thread.is_alive() and thread is not threading.current_thread():
            thread.join(timeout=join_timeout)

        with self._lock:
            if self._thread is thread:
                self._thread = None
                self._stop_event = None
            self._connected = False
            if self._connection_state != "error":
                self._connection_state = "disconnected"
            self._publish_locked()
            return self._snapshot_locked()

    def wait_for_update(
        self,
        last_version: int,
        timeout: float = 2.0,
    ) -> tuple[bool, int, dict[str, Any]]:
        """Block until the state version advances beyond *last_version*."""
        with self._condition:
            changed = self._condition.wait_for(
                lambda: self._version > last_version,
                timeout=timeout,
            )
            return changed, self._version, self._snapshot_locked()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _snapshot_locked(self) -> dict[str, Any]:
        return {
            "connectionState": self._connection_state,
            "connected":       self._connected,
            "port":            self._port,
            "baud":            self._baud,
            "lastError":       self._last_error,
            "telemetry":       self._state.to_dict(),
        }

    def _publish_locked(self) -> None:
        self._version += 1
        self._condition.notify_all()

    def _reader_loop(self, port: str, baud: int, stop_event: threading.Event) -> None:
        pending = bytearray()
        try:
            with open_serial(port, baud=baud, timeout=self.timeout) as ser:
                with self._lock:
                    self._connection_state = "connected"
                    self._connected = True
                    self._last_error = None
                    self._state.started_at = time.monotonic()
                    self._publish_locked()

                while not stop_event.is_set():
                    chunk = read_window(ser, self.listen_window, self.chunk_size)
                    if not chunk:
                        continue
                    pending.extend(chunk)
                    frames, remainder = extract_crsf_frames(bytes(pending))
                    pending = bytearray(remainder)
                    if not frames:
                        continue
                    with self._lock:
                        update_telemetry_state(self._state, frames)
                        self._publish_locked()

        except serial.SerialException as exc:
            with self._lock:
                self._connection_state = "error"
                self._connected = False
                self._last_error = str(exc)
                self._publish_locked()
        finally:
            with self._lock:
                self._connected = False
                self._stop_event = None
                self._thread = None
                if self._connection_state != "error":
                    self._connection_state = "disconnected"
                self._publish_locked()