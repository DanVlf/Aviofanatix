#!/usr/bin/env python3
"""
Telemetry reader and terminal dashboard for Radiomaster/EdgeTX USB telemetry.

This module powers both:
- a local CLI dashboard, and
- the Flask backend service which streams snapshots to the frontend.
"""

from __future__ import annotations

import argparse
import math
import sys
import threading
import time
from collections import Counter
from dataclasses import dataclass, field
from typing import Any

try:
    import serial
    from serial.tools import list_ports
except ImportError as exc:  # pragma: no cover - depends on local environment
    print("Missing dependency: pyserial", file=sys.stderr)
    print("Install it with: python3 -m pip install -r backend/requirements.txt", file=sys.stderr)
    raise SystemExit(1) from exc


DEFAULT_BAUD = 420000
DEFAULT_BAUD_CANDIDATES = (420000, 400000, 115200, 921600, 460800, 416666)
DEFAULT_TIMEOUT = 0.02
DEFAULT_CHUNK_SIZE = 4096
DEFAULT_LISTEN_WINDOW = 0.05
DEFAULT_POLL_INTERVAL = 0.005
DEFAULT_BURST_GRACE = 0.015
LIKELY_PORT_PREFIXES = (
    "/dev/cu.usbmodem",
    "/dev/tty.usbmodem",
    "/dev/cu.usbserial",
    "/dev/tty.usbserial",
)
LIKELY_KEYWORDS = (
    "radiomaster",
    "boxer",
    "stm",
    "usb serial",
    "usb modem",
    "edgetx",
    "opentx",
)
TEXT_PROBES = (
    b"\r",
    b"\n",
    b"\r\n",
    b"help\r\n",
    b"?\r\n",
    b"version\r\n",
    b"status\r\n",
)
CRSF_SYNC_BYTES = {0xC8, 0xEA, 0xEE, 0xEC, 0x10, 0x12, 0x14}
CRSF_FRAME_TYPE_NAMES = {
    0x02: "GPS",
    0x07: "Vario",
    0x08: "Battery Sensor",
    0x14: "Link Statistics",
    0x16: "RC Channels Packed",
    0x1C: "Attitude",
    0x1E: "Attitude",
    0x21: "Flight Mode",
    0x28: "Device Ping",
    0x29: "Device Info",
    0x2B: "Parameter Read",
    0x2C: "Parameter Write",
    0x32: "Command",
    0x3A: "Remote Related",
}

CRC8_DVB_S2_TABLE = (
    0x00, 0xD5, 0x7F, 0xAA, 0xFE, 0x2B, 0x81, 0x54, 0x29, 0xFC, 0x56, 0x83, 0xD7, 0x02, 0xA8, 0x7D,
    0x52, 0x87, 0x2D, 0xF8, 0xAC, 0x79, 0xD3, 0x06, 0x7B, 0xAE, 0x04, 0xD1, 0x85, 0x50, 0xFA, 0x2F,
    0xA4, 0x71, 0xDB, 0x0E, 0x5A, 0x8F, 0x25, 0xF0, 0x8D, 0x58, 0xF2, 0x27, 0x73, 0xA6, 0x0C, 0xD9,
    0xF6, 0x23, 0x89, 0x5C, 0x08, 0xDD, 0x77, 0xA2, 0xDF, 0x0A, 0xA0, 0x75, 0x21, 0xF4, 0x5E, 0x8B,
    0x9D, 0x48, 0xE2, 0x37, 0x63, 0xB6, 0x1C, 0xC9, 0xB4, 0x61, 0xCB, 0x1E, 0x4A, 0x9F, 0x35, 0xE0,
    0xCF, 0x1A, 0xB0, 0x65, 0x31, 0xE4, 0x4E, 0x9B, 0xE6, 0x33, 0x99, 0x4C, 0x18, 0xCD, 0x67, 0xB2,
    0x39, 0xEC, 0x46, 0x93, 0xC7, 0x12, 0xB8, 0x6D, 0x10, 0xC5, 0x6F, 0xBA, 0xEE, 0x3B, 0x91, 0x44,
    0x6B, 0xBE, 0x14, 0xC1, 0x95, 0x40, 0xEA, 0x3F, 0x42, 0x97, 0x3D, 0xE8, 0xBC, 0x69, 0xC3, 0x16,
    0xEF, 0x3A, 0x90, 0x45, 0x11, 0xC4, 0x6E, 0xBB, 0xC6, 0x13, 0xB9, 0x6C, 0x38, 0xED, 0x47, 0x92,
    0xBD, 0x68, 0xC2, 0x17, 0x43, 0x96, 0x3C, 0xE9, 0x94, 0x41, 0xEB, 0x3E, 0x6A, 0xBF, 0x15, 0xC0,
    0x4B, 0x9E, 0x34, 0xE1, 0xB5, 0x60, 0xCA, 0x1F, 0x62, 0xB7, 0x1D, 0xC8, 0x9C, 0x49, 0xE3, 0x36,
    0x19, 0xCC, 0x66, 0xB3, 0xE7, 0x32, 0x98, 0x4D, 0x30, 0xE5, 0x4F, 0x9A, 0xCE, 0x1B, 0xB1, 0x64,
    0x72, 0xA7, 0x0D, 0xD8, 0x8C, 0x59, 0xF3, 0x26, 0x5B, 0x8E, 0x24, 0xF1, 0xA5, 0x70, 0xDA, 0x0F,
    0x20, 0xF5, 0x5F, 0x8A, 0xDE, 0x0B, 0xA1, 0x74, 0x09, 0xDC, 0x76, 0xA3, 0xF7, 0x22, 0x88, 0x5D,
    0xD6, 0x03, 0xA9, 0x7C, 0x28, 0xFD, 0x57, 0x82, 0xFF, 0x2A, 0x80, 0x55, 0x01, 0xD4, 0x7E, 0xAB,
    0x84, 0x51, 0xFB, 0x2E, 0x7A, 0xAF, 0x05, 0xD0, 0xAD, 0x78, 0xD2, 0x07, 0x53, 0x86, 0x2C, 0xF9,
)


@dataclass
class ProbeResult:
    baud: int
    passive_bytes: bytes
    text_responses: list[tuple[bytes, bytes]]
    crsf_responses: list[tuple[str, bytes, list["CrsfFrame"]]]


@dataclass
class CrsfFrame:
    sync: int
    length: int
    frame_type: int
    payload: bytes
    crc: int
    raw: bytes

    @property
    def type_name(self) -> str:
        return CRSF_FRAME_TYPE_NAMES.get(self.frame_type, f"0x{self.frame_type:02X}")


@dataclass
class TelemetryState:
    started_at: float = field(default_factory=time.monotonic)
    last_frame_at: float | None = None
    total_frames: int = 0
    frame_counts: Counter[str] = field(default_factory=Counter)
    link_stats: dict[str, object] = field(default_factory=dict)
    battery: dict[str, object] = field(default_factory=dict)
    gps: dict[str, object] = field(default_factory=dict)
    attitude: dict[str, object] = field(default_factory=dict)
    flight_mode: str | None = None
    timing: dict[str, object] = field(default_factory=dict)
    unknown_frames: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        now = time.monotonic()
        uptime = now - self.started_at
        last_frame_ago = None if self.last_frame_at is None else now - self.last_frame_at
        return {
            "uptimeSeconds": uptime,
            "lastFrameAgoSeconds": last_frame_ago,
            "totalFrames": self.total_frames,
            "framesPerSecond": (self.total_frames / uptime) if uptime > 0 else 0.0,
            "frameCounts": dict(self.frame_counts.most_common()),
            "linkStats": self.link_stats,
            "battery": self.battery,
            "gps": self.gps,
            "attitude": self.attitude,
            "flightMode": self.flight_mode,
            "timing": self.timing,
            "unknownFrames": list(self.unknown_frames),
        }


def format_ascii(chunk: bytes) -> str:
    return "".join(chr(byte) if 32 <= byte <= 126 else "." for byte in chunk)


def format_value(value: object, suffix: str = "", default: str = "--") -> str:
    if value is None:
        return default
    if isinstance(value, float):
        text = f"{value:.2f}".rstrip("0").rstrip(".")
    else:
        text = str(value)
    return f"{text}{suffix}"


def big_endian_uint16(data: bytes) -> int:
    return int.from_bytes(data[:2], byteorder="big", signed=False)


def big_endian_int16(data: bytes) -> int:
    return int.from_bytes(data[:2], byteorder="big", signed=True)


def big_endian_int32(data: bytes) -> int:
    return int.from_bytes(data[:4], byteorder="big", signed=True)


def big_endian_uint24(data: bytes) -> int:
    return int.from_bytes(data[:3], byteorder="big", signed=False)


def crc8_dvb_s2(data: bytes) -> int:
    crc = 0
    for byte in data:
        crc = CRC8_DVB_S2_TABLE[crc ^ byte]
    return crc


def build_crsf_extended_frame(frame_type: int, destination: int, origin: int, payload: bytes = b"") -> bytes:
    body = bytes([frame_type, destination, origin]) + payload
    return bytes([0xC8, len(body) + 1]) + body + bytes([crc8_dvb_s2(body)])


def build_crsf_ping_frames() -> dict[str, bytes]:
    return {
        "broadcast_ping": build_crsf_extended_frame(0x28, 0x00, 0x10),
        "tx_ping": build_crsf_extended_frame(0x28, 0xEE, 0x10),
        "rx_ping": build_crsf_extended_frame(0x28, 0xEC, 0x10),
        "fc_ping": build_crsf_extended_frame(0x28, 0xC8, 0x10),
    }


def describe_port(port: serial.tools.list_ports_common.ListPortInfo) -> str:
    details = [port.device]
    if port.description and port.description != "n/a":
        details.append(port.description)
    if port.manufacturer:
        details.append(f"manufacturer={port.manufacturer}")
    if port.vid is not None and port.pid is not None:
        details.append(f"vid=0x{port.vid:04x} pid=0x{port.pid:04x}")
    return " | ".join(details)


def serialize_port(port: serial.tools.list_ports_common.ListPortInfo, selected: bool = False) -> dict[str, Any]:
    return {
        "device": port.device,
        "description": port.description,
        "manufacturer": port.manufacturer,
        "product": port.product,
        "interface": port.interface,
        "vid": port.vid,
        "pid": port.pid,
        "selected": selected,
        "score": score_port(port),
        "label": describe_port(port),
    }


def list_candidate_ports() -> list[serial.tools.list_ports_common.ListPortInfo]:
    ports = list(list_ports.comports())
    ports.sort(key=lambda item: item.device)
    return ports


def score_port(port: serial.tools.list_ports_common.ListPortInfo) -> int:
    text = " ".join(
        filter(
            None,
            [port.device, port.description, port.manufacturer, port.product, port.interface],
        )
    ).lower()
    score = 0
    if any(port.device.startswith(prefix) for prefix in LIKELY_PORT_PREFIXES):
        score += 5
    score += sum(3 for keyword in LIKELY_KEYWORDS if keyword in text)
    if port.vid == 0x0483:
        score += 4
    if port.pid == 0x5740:
        score += 4
    return score


def auto_select_port(ports: list[serial.tools.list_ports_common.ListPortInfo]) -> serial.tools.list_ports_common.ListPortInfo | None:
    if not ports:
        return None
    ranked = sorted(ports, key=score_port, reverse=True)
    best = ranked[0]
    if score_port(best) <= 0:
        return None
    return best


def list_serial_ports_snapshot() -> dict[str, Any]:
    ports = list_candidate_ports()
    selected = auto_select_port(ports)
    return {
        "ports": [serialize_port(port, selected=bool(selected and port.device == selected.device)) for port in ports],
        "suggestedPort": selected.device if selected else None,
    }


def print_probe(ports: list[serial.tools.list_ports_common.ListPortInfo], selected: str | None) -> int:
    if not ports:
        print("No serial ports found.")
        return 1

    print("Detected serial ports:")
    for port in ports:
        marker = "* " if selected and port.device == selected else "  "
        print(f"{marker}{describe_port(port)}")
    return 0


def open_serial(port: str, baud: int, timeout: float) -> serial.Serial:
    return serial.Serial(
        port=port,
        baudrate=baud,
        timeout=timeout,
        write_timeout=timeout,
        exclusive=True,
    )


def read_window(ser: serial.Serial, duration: float, chunk_size: int) -> bytes:
    deadline = time.monotonic() + duration
    buffer = bytearray()
    burst_deadline: float | None = None

    while time.monotonic() < deadline:
        if not buffer:
            # Wait briefly for the first byte so we stay responsive without busy-looping.
            first_byte = ser.read(1)
            if first_byte:
                buffer.extend(first_byte)
                burst_deadline = time.monotonic() + DEFAULT_BURST_GRACE
                continue
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


def parse_crsf_frames(data: bytes) -> list[CrsfFrame]:
    frames: list[CrsfFrame] = []
    index = 0
    while index + 2 <= len(data):
        sync = data[index]
        length = data[index + 1]
        if sync not in CRSF_SYNC_BYTES or length < 2:
            index += 1
            continue

        frame_end = index + 2 + length
        if frame_end > len(data):
            break

        raw = data[index:frame_end]
        body = raw[2:-1]
        crc = raw[-1]
        if body and crc8_dvb_s2(body) == crc:
            frames.append(
                CrsfFrame(
                    sync=sync,
                    length=length,
                    frame_type=body[0],
                    payload=body[1:],
                    crc=crc,
                    raw=raw,
                )
            )
            index = frame_end
            continue

        index += 1
    return frames


def extract_crsf_frames(data: bytes) -> tuple[list[CrsfFrame], bytes]:
    frames: list[CrsfFrame] = []
    index = 0
    data_length = len(data)

    while index + 2 <= data_length:
        sync = data[index]
        length = data[index + 1]
        if sync not in CRSF_SYNC_BYTES or length < 2 or length > 62:
            index += 1
            continue

        frame_end = index + 2 + length
        if frame_end > data_length:
            return frames, data[index:]

        raw = data[index:frame_end]
        body = raw[2:-1]
        crc = raw[-1]
        if body and crc8_dvb_s2(body) == crc:
            frames.append(
                CrsfFrame(
                    sync=sync,
                    length=length,
                    frame_type=body[0],
                    payload=body[1:],
                    crc=crc,
                    raw=raw,
                )
            )
            index = frame_end
            continue

        index += 1

    return frames, data[index:]


def decode_link_statistics(payload: bytes) -> dict[str, object] | None:
    if len(payload) < 10:
        return None
    power_map = {
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
    profile_map = {
        0: "4fps",
        1: "50fps",
        2: "150fps",
    }
    return {
        "uplinkRssi1": -payload[0],
        "uplinkRssi2": -payload[1],
        "uplinkLq": payload[2],
        "uplinkSnr": int.from_bytes(payload[3:4], byteorder="big", signed=True),
        "activeAntenna": payload[4],
        "rfProfile": profile_map.get(payload[5], str(payload[5])),
        "rfPower": power_map.get(payload[6], str(payload[6])),
        "downlinkRssi": -payload[7],
        "downlinkLq": payload[8],
        "downlinkSnr": int.from_bytes(payload[9:10], byteorder="big", signed=True),
    }


def decode_battery(payload: bytes) -> dict[str, object] | None:
    if len(payload) < 8:
        return None
    return {
        "voltageV": big_endian_uint16(payload[0:2]) / 10.0,
        "currentA": big_endian_uint16(payload[2:4]) / 10.0,
        "capacityMah": big_endian_uint24(payload[4:7]),
        "remainingPct": payload[7],
    }


def decode_gps(payload: bytes) -> dict[str, object] | None:
    if len(payload) < 15:
        return None
    return {
        "latitude": big_endian_int32(payload[0:4]) / 10_000_000,
        "longitude": big_endian_int32(payload[4:8]) / 10_000_000,
        "groundspeedKmh": big_endian_uint16(payload[8:10]) / 100.0,
        "headingDeg": big_endian_uint16(payload[10:12]) / 100.0,
        "altitudeM": big_endian_uint16(payload[12:14]) - 1000,
        "satellites": payload[14],
    }


def decode_attitude(payload: bytes) -> dict[str, object] | None:
    if len(payload) < 6:
        return None
    scale = 0.0001 * 180.0 / math.pi
    return {
        "pitchDeg": big_endian_int16(payload[0:2]) * scale,
        "rollDeg": big_endian_int16(payload[2:4]) * scale,
        "yawDeg": big_endian_int16(payload[4:6]) * scale,
    }


def decode_flight_mode(payload: bytes) -> str | None:
    if not payload:
        return None
    text = payload.split(b"\x00", 1)[0].decode("utf-8", errors="replace").strip()
    return text or None


def decode_remote_related(payload: bytes) -> dict[str, object] | None:
    if len(payload) < 3:
        return None
    destination = payload[0]
    origin = payload[1]
    subtype = payload[2]
    if subtype != 0x10 or len(payload) < 11:
        return {
            "destination": f"0x{destination:02X}",
            "origin": f"0x{origin:02X}",
            "subtype": f"0x{subtype:02X}",
            "raw": payload[3:].hex(" "),
        }
    update_interval_ms = int.from_bytes(payload[3:7], byteorder="big", signed=False) * 1e-4
    offset_us = int.from_bytes(payload[7:11], byteorder="big", signed=True) * 0.1
    return {
        "destination": f"0x{destination:02X}",
        "origin": f"0x{origin:02X}",
        "subtype": "timing",
        "updateIntervalMs": update_interval_ms,
        "offsetUs": offset_us,
    }


def update_telemetry_state(state: TelemetryState, frames: list[CrsfFrame]) -> None:
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
                state.battery = decoded
        elif frame.frame_type == 0x02:
            decoded = decode_gps(frame.payload)
            if decoded:
                state.gps = decoded
        elif frame.frame_type == 0x1E:
            decoded = decode_attitude(frame.payload)
            if decoded:
                state.attitude = decoded
        elif frame.frame_type == 0x21:
            decoded = decode_flight_mode(frame.payload)
            if decoded:
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


def print_raw_bytes(chunk: bytes, show_ascii: bool) -> None:
    timestamp = time.strftime("%H:%M:%S")
    hex_part = chunk.hex(" ")
    if show_ascii:
        ascii_part = format_ascii(chunk)
        print(f"[{timestamp}] {len(chunk):4d} bytes | {hex_part} | {ascii_part}")
    else:
        print(f"[{timestamp}] {len(chunk):4d} bytes | {hex_part}")


def summarize_crsf_frames(frames: list[CrsfFrame]) -> None:
    if not frames:
        return
    print("Decoded CRSF frames:")
    for frame in frames:
        print(
            f"  sync=0x{frame.sync:02X} type={frame.type_name} "
            f"payload={len(frame.payload)} raw={frame.raw.hex(' ')}"
        )


def render_section(title: str, rows: list[tuple[str, str]]) -> list[str]:
    width = 78
    lines = [f"+{'-' * (width - 2)}+", f"| {title:<{width - 4}} |"]
    for label, value in rows:
        body = f"{label:<22} {value}"
        lines.append(f"| {body[: width - 4]:<{width - 4}} |")
    lines.append(f"+{'-' * (width - 2)}+")
    return lines


def render_dashboard(port: str, baud: int, state: TelemetryState) -> str:
    now = time.monotonic()
    uptime = now - state.started_at
    since_last = None if state.last_frame_at is None else now - state.last_frame_at
    fps = state.total_frames / uptime if uptime > 0 else 0.0
    link = state.link_stats
    battery = state.battery
    gps = state.gps
    attitude = state.attitude
    timing = state.timing
    recent_types = ", ".join(
        f"{name}:{count}" for name, count in state.frame_counts.most_common(6)
    ) or "--"

    sections: list[str] = []
    sections.extend(
        render_section(
            "FPV Radio Telemetry",
            [
                ("Port", port),
                ("Baud", str(baud)),
                ("Frames total", str(state.total_frames)),
                ("Frames/sec", format_value(fps)),
                ("Last frame", format_value(since_last, "s")),
                ("Recent types", recent_types),
            ],
        )
    )
    sections.extend(
        render_section(
            "Link Statistics",
            [
                ("Uplink RSSI", f"{format_value(link.get('uplinkRssi1'), ' dBm')} / {format_value(link.get('uplinkRssi2'), ' dBm')}"),
                ("Uplink LQ / SNR", f"{format_value(link.get('uplinkLq'), '%')} / {format_value(link.get('uplinkSnr'), ' dB')}"),
                ("Downlink RSSI", format_value(link.get("downlinkRssi"), " dBm")),
                ("Downlink LQ / SNR", f"{format_value(link.get('downlinkLq'), '%')} / {format_value(link.get('downlinkSnr'), ' dB')}"),
                ("RF profile / power", f"{format_value(link.get('rfProfile'))} / {format_value(link.get('rfPower'))}"),
                ("Active antenna", format_value(link.get("activeAntenna"))),
            ],
        )
    )
    sections.extend(
        render_section(
            "Telemetry",
            [
                ("Battery", f"{format_value(battery.get('voltageV'), ' V')} / {format_value(battery.get('currentA'), ' A')}"),
                ("Capacity / Remain", f"{format_value(battery.get('capacityMah'), ' mAh')} / {format_value(battery.get('remainingPct'), '%')}"),
                ("GPS Lat / Lon", f"{format_value(gps.get('latitude'))} / {format_value(gps.get('longitude'))}"),
                ("GPS Speed / Alt", f"{format_value(gps.get('groundspeedKmh'), ' km/h')} / {format_value(gps.get('altitudeM'), ' m')}"),
                ("GPS Heading / Sats", f"{format_value(gps.get('headingDeg'), ' deg')} / {format_value(gps.get('satellites'))}"),
                ("Flight mode", format_value(state.flight_mode)),
            ],
        )
    )
    sections.extend(
        render_section(
            "Attitude And Timing",
            [
                ("Pitch / Roll", f"{format_value(attitude.get('pitchDeg'), ' deg')} / {format_value(attitude.get('rollDeg'), ' deg')}"),
                ("Yaw", format_value(attitude.get("yawDeg"), " deg")),
                ("Timing subtype", format_value(timing.get("subtype"))),
                ("Timing interval", format_value(timing.get("updateIntervalMs"), " ms")),
                ("Timing offset", format_value(timing.get("offsetUs"), " us")),
                ("Timing route", f"{format_value(timing.get('origin'))} -> {format_value(timing.get('destination'))}"),
            ],
        )
    )
    if state.unknown_frames:
        sections.extend(
            render_section(
                "Other Frames",
                [(f"Seen {index + 1}", value) for index, value in enumerate(state.unknown_frames[-4:])],
            )
        )
    return "\x1b[2J\x1b[H" + "\n".join(sections)


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

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return self._snapshot_locked()

    def list_ports(self) -> dict[str, Any]:
        snapshot = list_serial_ports_snapshot()
        with self._lock:
            current_port = self._port
        for port in snapshot["ports"]:
            if current_port and port["device"] == current_port:
                port["selected"] = True
        return snapshot

    def auto_connect(self) -> dict[str, Any]:
        if self.is_busy():
            return self.snapshot()
        port_snapshot = self.list_ports()
        suggested_port = port_snapshot["suggestedPort"]
        if suggested_port is None:
            return self.snapshot()
        return self.connect(port=suggested_port, baud=self.default_baud)

    def is_busy(self) -> bool:
        with self._lock:
            return self._thread is not None and self._thread.is_alive()

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

    def wait_for_update(self, last_version: int, timeout: float = 2.0) -> tuple[bool, int, dict[str, Any]]:
        with self._condition:
            changed = self._condition.wait_for(lambda: self._version > last_version, timeout=timeout)
            return changed, self._version, self._snapshot_locked()

    def _snapshot_locked(self) -> dict[str, Any]:
        return {
            "connectionState": self._connection_state,
            "connected": self._connected,
            "port": self._port,
            "baud": self._baud,
            "lastError": self._last_error,
            "telemetry": self._state.to_dict(),
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


def passive_listen(port: str, baud: int, timeout: float, chunk_size: int, listen_for: float, show_ascii: bool) -> int:
    print(f"Opening {port} at {baud} baud")
    try:
        with open_serial(port, baud=baud, timeout=timeout) as ser:
            print(f"Listening passively for {listen_for:.1f}s. Press Ctrl+C to stop.")
            while True:
                chunk = read_window(ser, listen_for, chunk_size)
                if not chunk:
                    print(f"[{time.strftime('%H:%M:%S')}] no bytes received")
                    continue
                print_raw_bytes(chunk, show_ascii=show_ascii)
                summarize_crsf_frames(parse_crsf_frames(chunk))
    except serial.SerialException as exc:
        print(f"Serial error on {port}: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("\nStopped.")
        return 0


def dashboard_listen(port: str, baud: int, timeout: float, chunk_size: int, listen_for: float) -> int:
    print(f"Opening {port} at {baud} baud")
    state = TelemetryState()
    pending = bytearray()
    try:
        with open_serial(port, baud=baud, timeout=timeout) as ser:
            while True:
                chunk = read_window(ser, listen_for, chunk_size)
                if chunk:
                    pending.extend(chunk)
                    frames, remainder = extract_crsf_frames(bytes(pending))
                    pending = bytearray(remainder)
                    update_telemetry_state(state, frames)
                print(render_dashboard(port, baud, state), end="", flush=True)
    except serial.SerialException as exc:
        print(f"Serial error on {port}: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("\nStopped.")
        return 0


def run_text_probes(ser: serial.Serial, delay: float, chunk_size: int) -> list[tuple[bytes, bytes]]:
    responses: list[tuple[bytes, bytes]] = []
    for probe in TEXT_PROBES:
        ser.reset_input_buffer()
        ser.write(probe)
        ser.flush()
        time.sleep(delay)
        responses.append((probe, ser.read(chunk_size)))
    return responses


def run_crsf_probes(ser: serial.Serial, delay: float, chunk_size: int) -> list[tuple[str, bytes, list[CrsfFrame]]]:
    responses: list[tuple[str, bytes, list[CrsfFrame]]] = []
    for name, frame in build_crsf_ping_frames().items():
        ser.reset_input_buffer()
        ser.write(frame)
        ser.flush()
        time.sleep(delay)
        raw = ser.read(chunk_size)
        responses.append((name, raw, parse_crsf_frames(raw)))
    return responses


def diagnose_port(
    port: str,
    baud_candidates: list[int],
    timeout: float,
    chunk_size: int,
    passive_window: float,
    probe_delay: float,
) -> int:
    print(f"Diagnosing {port}")
    results: list[ProbeResult] = []

    for baud in baud_candidates:
        print(f"\n=== Baud {baud} ===")
        try:
            with open_serial(port, baud=baud, timeout=timeout) as ser:
                passive_bytes = read_window(ser, passive_window, chunk_size)
                if passive_bytes:
                    print(f"Passive bytes: {len(passive_bytes)}")
                    print_raw_bytes(passive_bytes, show_ascii=True)
                    summarize_crsf_frames(parse_crsf_frames(passive_bytes))
                else:
                    print("Passive listen: no bytes received")

                text_responses = run_text_probes(ser, delay=probe_delay, chunk_size=chunk_size)
                any_text = False
                for probe, response in text_responses:
                    if response:
                        any_text = True
                        print(f"Text probe {probe!r} => {response!r}")
                if not any_text:
                    print("Text probes: no response")

                crsf_responses = run_crsf_probes(ser, delay=probe_delay, chunk_size=chunk_size)
                any_crsf = False
                for name, raw, frames in crsf_responses:
                    if raw:
                        any_crsf = True
                        print(f"CRSF probe {name} => {raw.hex(' ')}")
                        summarize_crsf_frames(frames)
                if not any_crsf:
                    print("CRSF probes: no response")

                results.append(
                    ProbeResult(
                        baud=baud,
                        passive_bytes=passive_bytes,
                        text_responses=text_responses,
                        crsf_responses=crsf_responses,
                    )
                )
        except serial.SerialException as exc:
            print(f"Could not open at {baud}: {exc}")

    print("\n=== Summary ===")
    interesting = False
    for result in results:
        text_bytes = sum(len(response) for _, response in result.text_responses)
        crsf_bytes = sum(len(raw) for _, raw, _ in result.crsf_responses)
        passive = len(result.passive_bytes)
        if passive or text_bytes or crsf_bytes:
            interesting = True
            print(f"Baud {result.baud}: passive={passive} text={text_bytes} crsf={crsf_bytes}")

    if not interesting:
        print("The port opens, but it stayed silent for passive listen, text CLI probes, and CRSF pings.")
    return 0


def resolve_port(explicit_port: str | None) -> tuple[str | None, list[serial.tools.list_ports_common.ListPortInfo]]:
    ports = list_candidate_ports()
    if explicit_port:
        return explicit_port, ports

    selected = auto_select_port(ports)
    if selected is None:
        return None, ports
    return selected.device, ports


def parse_baud_candidates(raw: str) -> list[int]:
    values: list[int] = []
    for item in raw.split(","):
        item = item.strip()
        if not item:
            continue
        values.append(int(item))
    if not values:
        raise ValueError("No baud rates provided")
    return values


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Probe or actively diagnose a macOS USB serial FPV radio."
    )
    parser.add_argument("--probe", action="store_true", help="List detected serial ports and exit.")
    parser.add_argument("--diagnose", action="store_true", help="Try passive listen, text probes, and CRSF probes.")
    parser.add_argument("--raw", action="store_true", help="Use raw passive dump instead of the telemetry dashboard.")
    parser.add_argument("--port", help="Serial port path, for example /dev/cu.usbmodem1234.")
    parser.add_argument("--baud", type=int, default=DEFAULT_BAUD, help=f"Baud rate. Default: {DEFAULT_BAUD}.")
    parser.add_argument(
        "--baud-scan",
        default=",".join(str(value) for value in DEFAULT_BAUD_CANDIDATES),
        help="Comma-separated baud rates for --diagnose.",
    )
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT, help="Serial read timeout in seconds.")
    parser.add_argument("--chunk-size", type=int, default=DEFAULT_CHUNK_SIZE, help="Max bytes to read per poll.")
    parser.add_argument("--listen-for", type=float, default=1.0, help="Passive listen window per cycle in seconds.")
    parser.add_argument("--probe-delay", type=float, default=0.3, help="Pause after each active probe in seconds.")
    parser.add_argument("--no-ascii", action="store_true", help="Print hex only and omit the ASCII preview.")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    port, ports = resolve_port(args.port)

    if args.probe:
        return print_probe(ports, port)

    if port is None:
        print("No likely radio serial port found.", file=sys.stderr)
        print("Run with --probe to inspect ports or pass --port manually.", file=sys.stderr)
        return 1

    if args.diagnose:
        try:
            baud_candidates = parse_baud_candidates(args.baud_scan)
        except ValueError as exc:
            print(f"Invalid --baud-scan: {exc}", file=sys.stderr)
            return 1
        return diagnose_port(
            port=port,
            baud_candidates=baud_candidates,
            timeout=args.timeout,
            chunk_size=args.chunk_size,
            passive_window=args.listen_for,
            probe_delay=args.probe_delay,
        )

    if args.raw:
        return passive_listen(
            port=port,
            baud=args.baud,
            timeout=args.timeout,
            chunk_size=args.chunk_size,
            listen_for=args.listen_for,
            show_ascii=not args.no_ascii,
        )

    return dashboard_listen(
        port=port,
        baud=args.baud,
        timeout=args.timeout,
        chunk_size=args.chunk_size,
        listen_for=args.listen_for,
    )


if __name__ == "__main__":
    raise SystemExit(main())
