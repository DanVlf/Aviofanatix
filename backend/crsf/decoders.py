"""
Decoders for individual CRSF payload types.

Each function accepts a raw payload (bytes) and returns a typed dict,
or None when the payload is too short / malformed.
"""

from __future__ import annotations

import math


# ---------------------------------------------------------------------------
# Byte helpers
# ---------------------------------------------------------------------------

def _u16be(data: bytes) -> int:
    return int.from_bytes(data[:2], byteorder="big", signed=False)


def _i16be(data: bytes) -> int:
    return int.from_bytes(data[:2], byteorder="big", signed=True)


def _i32be(data: bytes) -> int:
    return int.from_bytes(data[:4], byteorder="big", signed=True)


def _u24be(data: bytes) -> int:
    return int.from_bytes(data[:3], byteorder="big", signed=False)


# ---------------------------------------------------------------------------
# Public decoders
# ---------------------------------------------------------------------------

_RF_POWER_MAP: dict[int, str] = {
    0: "0mW",
    1: "10mW",
    2: "25mW",
    3: "100mW",
    4: "500mW",
    5: "1W",
    6: "2W",
    7: "250mW",
    8: "50mW",
}

_RF_PROFILE_MAP: dict[int, str] = {
    0: "4fps",
    1: "50fps",
    2: "150fps",
}


def decode_link_statistics(payload: bytes) -> dict[str, object] | None:
    """Frame type 0x14 — uplink / downlink RSSI, LQ, SNR, RF profile."""
    if len(payload) < 10:
        return None
    return {
        "uplinkRssi1":    -payload[0],
        "uplinkRssi2":    -payload[1],
        "uplinkLq":        payload[2],
        "uplinkSnr":       int.from_bytes(payload[3:4], byteorder="big", signed=True),
        "activeAntenna":   payload[4],
        "rfProfile":       _RF_PROFILE_MAP.get(payload[5], str(payload[5])),
        "rfPower":         _RF_POWER_MAP.get(payload[6], str(payload[6])),
        "downlinkRssi":   -payload[7],
        "downlinkLq":      payload[8],
        "downlinkSnr":     int.from_bytes(payload[9:10], byteorder="big", signed=True),
    }


def decode_battery(payload: bytes) -> dict[str, object] | None:
    """Frame type 0x08 — voltage, current, capacity, remaining %."""
    if len(payload) < 8:
        return None
    return {
        "voltageV":     _u16be(payload[0:2]) / 10.0,
        "currentA":     _u16be(payload[2:4]) / 10.0,
        "capacityMah":  _u24be(payload[4:7]),
        "remainingPct": payload[7],
    }


def decode_gps(payload: bytes) -> dict[str, object] | None:
    """Frame type 0x02 — lat/lon, groundspeed, heading, altitude, satellites."""
    if len(payload) < 15:
        return None
    return {
        "latitude":       _i32be(payload[0:4]) / 10_000_000,
        "longitude":      _i32be(payload[4:8]) / 10_000_000,
        "groundspeedKmh": _u16be(payload[8:10]) / 10.0,
        "headingDeg":     _u16be(payload[10:12]) / 100.0,
        "altitudeM":      _u16be(payload[12:14]) - 1000,
        "satellites":     payload[14],
    }


def decode_attitude(payload: bytes) -> dict[str, object] | None:
    """Frame type 0x1E — pitch, roll, yaw in degrees."""
    if len(payload) < 6:
        return None
    scale = 0.0001 * 180.0 / math.pi
    return {
        "pitchDeg": _i16be(payload[0:2]) * scale,
        "rollDeg":  _i16be(payload[2:4]) * scale,
        "yawDeg":   _i16be(payload[4:6]) * scale,
    }


def decode_flight_mode(payload: bytes) -> str | None:
    """Frame type 0x21 — null-terminated flight mode string."""
    if not payload:
        return None
    text = payload.split(b"\x00", 1)[0].decode("utf-8", errors="replace").strip()
    return text or None


def decode_remote_related(payload: bytes) -> dict[str, object] | None:
    """Frame type 0x3A — timing synchronisation or generic remote frame."""
    if len(payload) < 3:
        return None
    destination = payload[0]
    origin = payload[1]
    subtype = payload[2]

    if subtype != 0x10 or len(payload) < 11:
        return {
            "destination": f"0x{destination:02X}",
            "origin":      f"0x{origin:02X}",
            "subtype":     f"0x{subtype:02X}",
            "raw":         payload[3:].hex(" "),
        }

    update_interval_ms = int.from_bytes(payload[3:7], byteorder="big", signed=False) * 1e-4
    offset_us = int.from_bytes(payload[7:11], byteorder="big", signed=True) * 0.1
    return {
        "destination":      f"0x{destination:02X}",
        "origin":           f"0x{origin:02X}",
        "subtype":          "timing",
        "updateIntervalMs": update_interval_ms,
        "offsetUs":         offset_us,
    }
