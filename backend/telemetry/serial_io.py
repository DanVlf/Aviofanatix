"""
Low-level serial I/O helpers — opening a port and reading a timed burst window.
"""

from __future__ import annotations

import time

import serial


DEFAULT_BAUD = 420000
DEFAULT_TIMEOUT = 0.02
DEFAULT_CHUNK_SIZE = 4096
DEFAULT_LISTEN_WINDOW = 0.05
DEFAULT_POLL_INTERVAL = 0.005
DEFAULT_BURST_GRACE = 0.015


def open_serial(port: str, baud: int, timeout: float = DEFAULT_TIMEOUT) -> serial.Serial:
    return serial.Serial(
        port=port,
        baudrate=baud,
        timeout=timeout,
        write_timeout=timeout,
        exclusive=True,
    )


def read_window(
    ser: serial.Serial,
    duration: float,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
) -> bytes:
    """
    Read from *ser* for up to *duration* seconds.

    Blocks briefly for the first byte so we avoid busy-looping, then
    drains available bytes with a short burst-grace period so we don't
    split a multi-byte frame across two calls.
    """
    deadline = time.monotonic() + duration
    buffer = bytearray()
    burst_deadline: float | None = None

    while time.monotonic() < deadline:
        if not buffer:
            first_byte = ser.read(1)
            if first_byte:
                buffer.extend(first_byte)
                burst_deadline = time.monotonic() + DEFAULT_BURST_GRACE
        else:
            waiting = ser.in_waiting
            if waiting > 0:
                chunk = ser.read(min(waiting, chunk_size))
                if chunk:
                    buffer.extend(chunk)
                    burst_deadline = time.monotonic() + DEFAULT_BURST_GRACE
                    continue

            if burst_deadline is not None and time.monotonic() >= burst_deadline:
                break

            time.sleep(DEFAULT_POLL_INTERVAL)

    return bytes(buffer)