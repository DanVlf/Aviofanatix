"""
CRSF stream parser — extracts validated frames from a raw byte buffer.
"""

from __future__ import annotations

from .frames import CRSF_SYNC_BYTES, CrsfFrame, crc8_dvb_s2


def extract_crsf_frames(data: bytes) -> tuple[list[CrsfFrame], bytes]:
    """
    Parse as many complete, CRC-valid CRSF frames as possible from *data*.

    Returns (frames, remainder) where remainder is the trailing bytes that
    could not yet be completed (a partial frame in flight).
    """
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
            # Partial frame — keep from this sync byte onward.
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
        else:
            index += 1

    return frames, data[index:]