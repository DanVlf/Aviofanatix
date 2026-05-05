"""
Serial port discovery — lists, scores, and auto-selects the most likely
Radiomaster / EdgeTX USB port.
"""

from __future__ import annotations

from typing import Any

try:
    import serial
    from serial.tools import list_ports
except ImportError as exc:
    raise SystemExit("Missing dependency: pyserial") from exc


LIKELY_PORT_PREFIXES: tuple[str, ...] = (
    "/dev/cu.usbmodem",
    "/dev/tty.usbmodem",
    "/dev/cu.usbserial",
    "/dev/tty.usbserial",
)

LIKELY_KEYWORDS: tuple[str, ...] = (
    "radiomaster",
    "boxer",
    "stm",
    "usb serial",
    "usb modem",
    "edgetx",
    "opentx",
)

# STMicroelectronics VID / Virtual COM port PID
_STM_VID = 0x0483
_STM_PID = 0x5740


def score_port(port: serial.tools.list_ports_common.ListPortInfo) -> int:
    text = " ".join(
        filter(None, [port.device, port.description, port.manufacturer, port.product, port.interface])
    ).lower()
    score = 0
    if any(port.device.startswith(prefix) for prefix in LIKELY_PORT_PREFIXES):
        score += 5
    score += sum(3 for keyword in LIKELY_KEYWORDS if keyword in text)
    if port.vid == _STM_VID:
        score += 4
    if port.pid == _STM_PID:
        score += 4
    return score


def list_candidate_ports() -> list[serial.tools.list_ports_common.ListPortInfo]:
    ports = list(list_ports.comports())
    ports.sort(key=lambda p: p.device)
    return ports


def auto_select_port(
    ports: list[serial.tools.list_ports_common.ListPortInfo],
) -> serial.tools.list_ports_common.ListPortInfo | None:
    if not ports:
        return None
    ranked = sorted(ports, key=score_port, reverse=True)
    best = ranked[0]
    return best if score_port(best) > 0 else None


def describe_port(port: serial.tools.list_ports_common.ListPortInfo) -> str:
    details = [port.device]
    if port.description and port.description != "n/a":
        details.append(port.description)
    if port.manufacturer:
        details.append(f"manufacturer={port.manufacturer}")
    if port.vid is not None and port.pid is not None:
        details.append(f"vid=0x{port.vid:04x} pid=0x{port.pid:04x}")
    return " | ".join(details)


def serialize_port(
    port: serial.tools.list_ports_common.ListPortInfo,
    selected: bool = False,
) -> dict[str, Any]:
    return {
        "device":       port.device,
        "description":  port.description,
        "manufacturer": port.manufacturer,
        "product":      port.product,
        "interface":    port.interface,
        "vid":          port.vid,
        "pid":          port.pid,
        "selected":     selected,
        "score":        score_port(port),
        "label":        describe_port(port),
    }


def list_serial_ports_snapshot() -> dict[str, Any]:
    ports = list_candidate_ports()
    selected = auto_select_port(ports)
    return {
        "ports": [
            serialize_port(port, selected=bool(selected and port.device == selected.device))
            for port in ports
        ],
        "suggestedPort": selected.device if selected else None,
    }