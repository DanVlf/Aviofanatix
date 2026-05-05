"""
TelemetryState — the single source of truth for every value collected from
the USB serial stream.

All fields are documented inline so this file serves as the canonical
reference for what the system actually measures.
"""

from __future__ import annotations

import time
from collections import Counter
from dataclasses import dataclass, field
from typing import Any

from crsf.frames import CrsfFrame
from crsf.decoders import (
    decode_attitude,
    decode_battery,
    decode_flight_mode,
    decode_gps,
    decode_link_statistics,
    decode_remote_related,
)

BATTERY_FULL_VOLTAGE = 12.6
BATTERY_EMPTY_VOLTAGE = 9.9
BATTERY_MAX_CAPACITY_MAH = 850
GPS_TRACK_LIMIT = 1_200


def _clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(value, upper))


def _normalize_battery(decoded: dict[str, object]) -> dict[str, object]:
    voltage = decoded.get("voltageV")
    reported_remaining = decoded.get("remainingPct")
    remaining_pct: int | None = None
    if isinstance(voltage, (int, float)):
        ratio = (float(voltage) - BATTERY_EMPTY_VOLTAGE) / (BATTERY_FULL_VOLTAGE - BATTERY_EMPTY_VOLTAGE)
        remaining_pct = int(round(_clamp(ratio, 0.0, 1.0) * 100))

    used_capacity = decoded.get("capacityMah")
    remaining_capacity: int | None = None
    if isinstance(used_capacity, (int, float)):
        remaining_capacity = max(0, int(round(BATTERY_MAX_CAPACITY_MAH - float(used_capacity))))

    return {
        **decoded,
        "reportedRemainingPct": reported_remaining,
        "remainingPct": remaining_pct,
        "capacityMaxMah": BATTERY_MAX_CAPACITY_MAH,
        "remainingCapacityMah": remaining_capacity,
    }


def _update_vertical_speed(state: "TelemetryState", gps: dict[str, object], sample_time: float) -> None:
    altitude = gps.get("altitudeM")
    if not isinstance(altitude, (int, float)):
        gps["verticalSpeedMps"] = None
        return

    state.altitude_samples.append((sample_time, float(altitude)))
    state.altitude_samples = state.altitude_samples[-5:]
    if len(state.altitude_samples) < 2:
        gps["verticalSpeedMps"] = None
        return

    oldest_time, oldest_altitude = state.altitude_samples[0]
    delta_time = sample_time - oldest_time
    if delta_time <= 0:
        gps["verticalSpeedMps"] = None
        return

    gps["verticalSpeedMps"] = round((float(altitude) - oldest_altitude) / delta_time, 2)


def _append_gps_track(state: "TelemetryState", gps: dict[str, object]) -> None:
    latitude = gps.get("latitude")
    longitude = gps.get("longitude")
    altitude = gps.get("altitudeM")
    if not isinstance(latitude, (int, float)) or not isinstance(longitude, (int, float)):
        return

    point: dict[str, float] = {
        "latitude": float(latitude),
        "longitude": float(longitude),
    }
    if isinstance(altitude, (int, float)):
        point["altitudeM"] = float(altitude)

    previous = state.gps_track[-1] if state.gps_track else None
    if previous is not None:
        previous_altitude = previous.get("altitudeM")
        same_altitude = (
            isinstance(previous_altitude, (int, float))
            and isinstance(point.get("altitudeM"), (int, float))
            and abs(float(previous_altitude) - float(point["altitudeM"])) < 0.5
        )
        if (
            abs(previous["latitude"] - point["latitude"]) < 1e-7
            and abs(previous["longitude"] - point["longitude"]) < 1e-7
            and (same_altitude or ("altitudeM" not in previous and "altitudeM" not in point))
        ):
            return

    state.gps_track.append(point)
    state.gps_track = state.gps_track[-GPS_TRACK_LIMIT:]


@dataclass
class TelemetryState:
    # ------------------------------------------------------------------
    # Bookkeeping
    # ------------------------------------------------------------------
    started_at: float = field(default_factory=time.monotonic)
    """Monotonic timestamp of when this session began."""

    last_frame_at: float | None = None
    """Monotonic timestamp of the last successfully decoded frame."""

    total_frames: int = 0
    """Total number of valid CRSF frames received this session."""

    frame_counts: Counter[str] = field(default_factory=Counter)
    """Per-type frame counters, keyed by CRSF type name string."""

    # ------------------------------------------------------------------
    # Link Statistics  (frame type 0x14)
    # ------------------------------------------------------------------
    link_stats: dict[str, object] = field(default_factory=dict)
    """
    Keys (all ints unless noted):
      uplinkRssi1     – RSSI antenna 1 in dBm (negative)
      uplinkRssi2     – RSSI antenna 2 in dBm (negative)
      uplinkLq        – Uplink link quality 0–100 %
      uplinkSnr       – Uplink SNR in dB (signed)
      activeAntenna   – Active antenna index (0 or 1)
      rfProfile       – str: "4fps" | "50fps" | "150fps"
      rfPower         – str: "0mW" | "10mW" | "25mW" | "100mW" | …
      downlinkRssi    – RSSI downlink in dBm (negative)
      downlinkLq      – Downlink link quality 0–100 %
      downlinkSnr     – Downlink SNR in dB (signed)
    """

    # ------------------------------------------------------------------
    # Battery Sensor  (frame type 0x08)
    # ------------------------------------------------------------------
    battery: dict[str, object] = field(default_factory=dict)
    """
    Keys:
      voltageV        – Battery voltage in V (float, 0.1 V resolution)
      currentA        – Current draw in A (float, 0.1 A resolution)
      capacityMah     – Used capacity in mAh (int)
      capacityMaxMah  – Configured full capacity in mAh (int)
      remainingCapacityMah – Estimated remaining capacity in mAh (int)
      remainingPct    – Derived remaining capacity in % from battery voltage (int, 0–100)
      reportedRemainingPct – Raw transmitter-reported remaining % (int, 0–100)
    """

    # ------------------------------------------------------------------
    # GPS  (frame type 0x02)
    # ------------------------------------------------------------------
    gps: dict[str, object] = field(default_factory=dict)
    """
    Keys:
      latitude        – Decimal degrees (float, 1e-7 resolution)
      longitude       – Decimal degrees (float, 1e-7 resolution)
      groundspeedKmh  – Ground speed in km/h (float, 0.1 resolution)
      headingDeg      – True heading in degrees (float, 0.01 resolution)
      altitudeM       – Altitude in metres above sea level (int, offset -1000)
      satellites      – Number of locked GPS satellites (int)
      verticalSpeedMps – Derived climb/sink rate in m/s (float)
    """

    gps_track: list[dict[str, float]] = field(default_factory=list)
    """Bounded flight path history of distinct GPS points for map rendering."""

    altitude_samples: list[tuple[float, float]] = field(default_factory=list)
    """Recent monotonic-time altitude samples used to derive vertical speed."""

    # ------------------------------------------------------------------
    # Attitude  (frame type 0x1E)
    # ------------------------------------------------------------------
    attitude: dict[str, object] = field(default_factory=dict)
    """
    Keys:
      pitchDeg  – Pitch angle in degrees (float)
      rollDeg   – Roll angle in degrees (float)
      yawDeg    – Yaw angle in degrees (float)
    """

    # ------------------------------------------------------------------
    # Flight Mode  (frame type 0x21)
    # ------------------------------------------------------------------
    flight_mode: str | None = None
    """
    Human-readable flight mode string from the FC (e.g. "ACRO", "ANGLE").
    None when not yet received.
    """

    # ------------------------------------------------------------------
    # Timing / Remote Related  (frame type 0x3A, subtype 0x10)
    # ------------------------------------------------------------------
    timing: dict[str, object] = field(default_factory=dict)
    """
    Keys (timing subtype):
      destination      – str hex address e.g. "0xEE"
      origin           – str hex address e.g. "0xC8"
      subtype          – "timing" | hex string for unknown subtypes
      updateIntervalMs – Update interval in ms (float)
      offsetUs         – Clock offset in µs (float, signed)
    """

    # ------------------------------------------------------------------
    # Unknown / unhandled frame types
    # ------------------------------------------------------------------
    unknown_frames: list[str] = field(default_factory=list)
    """
    Ring buffer (last 6) of unrecognised frame descriptions,
    formatted as "<TypeName> (<hex bytes>)".
    """

    # ------------------------------------------------------------------
    # Serialisation
    # ------------------------------------------------------------------
    def to_dict(self) -> dict[str, Any]:
        now = time.monotonic()
        uptime = now - self.started_at
        last_frame_ago = None if self.last_frame_at is None else now - self.last_frame_at
        return {
            "uptimeSeconds":     uptime,
            "lastFrameAgoSeconds": last_frame_ago,
            "totalFrames":       self.total_frames,
            "framesPerSecond":   (self.total_frames / uptime) if uptime > 0 else 0.0,
            "frameCounts":       dict(self.frame_counts.most_common()),
            "linkStats":         self.link_stats,
            "battery":           self.battery,
            "gps":               self.gps,
            "gpsTrack":          list(self.gps_track),
            "attitude":          self.attitude,
            "flightMode":        self.flight_mode,
            "timing":            self.timing,
            "unknownFrames":     list(self.unknown_frames),
        }


def update_telemetry_state(state: TelemetryState, frames: list[CrsfFrame]) -> None:
    """Apply a batch of freshly decoded CRSF frames to *state* in-place."""
    for frame in frames:
        state.total_frames += 1
        state.last_frame_at = time.monotonic()
        state.frame_counts[frame.type_name] += 1

        if frame.frame_type == 0x14:
            decoded = decode_link_statistics(frame.payload)
            if decoded:
                state.link_stats = decoded

        elif frame.frame_type == 0x08:
            decoded = decode_battery(frame.payload)
            if decoded:
                state.battery = _normalize_battery(decoded)

        elif frame.frame_type == 0x02:
            decoded = decode_gps(frame.payload)
            if decoded:
                sample_time = state.last_frame_at if state.last_frame_at is not None else time.monotonic()
                _update_vertical_speed(state, decoded, sample_time)
                state.gps = decoded
                _append_gps_track(state, decoded)

        elif frame.frame_type == 0x1E:
            decoded = decode_attitude(frame.payload)
            if decoded:
                state.attitude = decoded

        elif frame.frame_type == 0x21:
            decoded = decode_flight_mode(frame.payload)
            if decoded is not None:
                state.flight_mode = decoded

        elif frame.frame_type == 0x3A:
            decoded = decode_remote_related(frame.payload)
            if decoded:
                state.timing = decoded

        else:
            label = f"{frame.type_name} ({frame.raw.hex(' ')})"
            if label not in state.unknown_frames:
                state.unknown_frames.append(label)
                state.unknown_frames = state.unknown_frames[-6:]
