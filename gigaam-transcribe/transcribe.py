#!/usr/bin/env python3
"""Транскрибация аудио через локальный GigaAM-v3 (CPU).

Стерео (АТС): L=Клиент, R=Оператор. Реплики по времени, как в gemini-transcribe.
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import gigaam

MODEL_NAME = os.environ.get("GIGAAM_MODEL", "v3_e2e_rnnt").strip() or "v3_e2e_rnnt"
LABEL_LEFT = "Клиент"
LABEL_RIGHT = "Оператор"
MAX_SHORT_SEC = 24.0
MAX_TURN_SEC = 22.0
MIN_SPEECH_SEC = 0.5
MERGE_GAP_SEC = 1.25
SLICE_PAD_SEC = 0.3
SILENCE_FILTER = "silencedetect=noise=-32dB:d=0.45"
AUDIO_AF = "highpass=f=80,lowpass=f=3800,dynaudnorm=f=150:g=15"


def run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=True)


def probe_channels(path: Path) -> int:
    out = subprocess.check_output(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=channels",
            "-of",
            "csv=p=0",
            str(path),
        ],
        text=True,
    )
    try:
        n = int(out.strip().splitlines()[0].split(",")[0])
    except (ValueError, IndexError):
        return 1
    return n if n > 0 else 1


def probe_duration(path: Path) -> float:
    out = subprocess.check_output(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "csv=p=0",
            str(path),
        ],
        text=True,
    )
    try:
        sec = float(out.strip())
    except ValueError:
        return 0.0
    return sec if sec > 0 else 0.0


def as_text(result) -> str:
    if hasattr(result, "text"):
        return str(result.text or "").strip()
    return str(result).strip()


def speech_regions_from_silence_log(stderr: str, duration_sec: float) -> list[dict]:
    starts: list[float] = []
    ends: list[float] = []
    for line in stderr.splitlines():
        m = re.search(r"silence_start:\s*([0-9]+(?:\.[0-9]+)?)", line)
        if m:
            starts.append(float(m.group(1)))
        m = re.search(r"silence_end:\s*([0-9]+(?:\.[0-9]+)?)", line)
        if m:
            ends.append(float(m.group(1)))
    events = [{"t": t, "kind": "s"} for t in starts] + [{"t": t, "kind": "e"} for t in ends]
    events.sort(key=lambda ev: (ev["t"], 0 if ev["kind"] == "e" else 1))

    silence_ranges: list[tuple[float, float]] = []
    open_at = None
    for ev in events:
        if ev["kind"] == "s" and open_at is None:
            open_at = ev["t"]
        elif ev["kind"] == "e" and open_at is not None:
            silence_ranges.append((open_at, ev["t"]))
            open_at = None

    total = duration_sec if duration_sec > 0 else (silence_ranges[-1][1] if silence_ranges else 0.0)
    speech: list[dict] = []
    pos = 0.0
    for s, e in silence_ranges:
        if s > pos + MIN_SPEECH_SEC:
            speech.append({"start": pos, "end": s})
        pos = max(pos, e)
    if total > pos + MIN_SPEECH_SEC:
        speech.append({"start": pos, "end": total})
    return speech


def detect_speech_regions(wav_path: Path, duration_sec: float) -> list[dict]:
    proc = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-nostats",
            "-i",
            str(wav_path),
            "-af",
            SILENCE_FILTER,
            "-f",
            "null",
            "-",
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    return speech_regions_from_silence_log(proc.stderr or "", duration_sec)


def split_long_region(region: dict, max_sec: float = MAX_TURN_SEC) -> list[dict]:
    out = []
    t = region["start"]
    while t < region["end"] - 0.15:
        end = min(region["end"], t + max_sec)
        out.append({"start": t, "end": end, "channel": region.get("channel")})
        t = end
    return out or [dict(region)]


def merge_close_same_channel(regions: list[dict], max_gap: float = MERGE_GAP_SEC) -> list[dict]:
    ordered = sorted(regions, key=lambda r: (r["channel"], r["start"]))
    out: list[dict] = []
    for r in ordered:
        prev = out[-1] if out else None
        if prev and prev["channel"] == r["channel"] and r["start"] - prev["end"] <= max_gap:
            prev["end"] = max(prev["end"], r["end"])
        else:
            out.append({"channel": r["channel"], "start": r["start"], "end": r["end"]})
    return sorted(out, key=lambda r: (r["start"], 0 if r["channel"] == "left" else 1))


def merge_turns(turns: list[dict]) -> str:
    lines: list[str] = []
    for turn in turns:
        text = str(turn.get("text") or "").strip()
        if not text:
            continue
        speaker = LABEL_RIGHT if turn["channel"] == "right" else LABEL_LEFT
        if lines and lines[-1].startswith(f"{speaker}:"):
            lines[-1] = f"{lines[-1]} {text}"
        else:
            lines.append(f"{speaker}: {text}")
    return "\n".join(lines).strip()


def split_channels(src: Path, left: Path, right: Path) -> None:
    filt = (
        "channelsplit=channel_layout=stereo[L][R];"
        f"[L]{AUDIO_AF},aresample=16000[Lout];"
        f"[R]{AUDIO_AF},aresample=16000[Rout]"
    )
    run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-i",
            str(src),
            "-filter_complex",
            filt,
            "-map",
            "[Lout]",
            "-ac",
            "1",
            str(left),
            "-map",
            "[Rout]",
            "-ac",
            "1",
            str(right),
        ]
    )


def to_mono_wav(src: Path, dst: Path) -> None:
    run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-i",
            str(src),
            "-ac",
            "1",
            "-ar",
            "16000",
            "-vn",
            "-af",
            AUDIO_AF,
            str(dst),
        ]
    )


def extract_slice(src: Path, dst: Path, start: float, end: float, duration: float) -> None:
    sliced_start = max(0.0, start - SLICE_PAD_SEC)
    sliced_end = min(duration, end + SLICE_PAD_SEC) if duration else end + SLICE_PAD_SEC
    dur = max(0.35, sliced_end - sliced_start)
    run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-ss",
            f"{sliced_start:.3f}",
            "-t",
            f"{dur:.3f}",
            "-i",
            str(src),
            "-ac",
            "1",
            "-c:a",
            "pcm_s16le",
            str(dst),
        ]
    )


def transcribe_path(model, path: Path) -> str:
    return as_text(model.transcribe(str(path)))


def transcribe_mono(model, wav: Path, duration: float, tmp: Path) -> str:
    if duration <= MAX_SHORT_SEC:
        return transcribe_path(model, wav)
    parts: list[str] = []
    start = 0.0
    idx = 0
    while start < duration - 0.05:
        chunk = tmp / f"mono-{idx:03d}.wav"
        extract_slice(wav, chunk, start, min(duration, start + MAX_TURN_SEC), duration)
        text = transcribe_path(model, chunk)
        if text:
            parts.append(text)
        start += MAX_TURN_SEC
        idx += 1
    return " ".join(parts)


def transcribe_stereo(model, src: Path, tmp: Path) -> str:
    left = tmp / "left.wav"
    right = tmp / "right.wav"
    split_channels(src, left, right)
    duration = probe_duration(left) or probe_duration(src)
    regions = [
        {**x, "channel": "left"}
        for r in detect_speech_regions(left, duration)
        for x in split_long_region(r)
    ]
    regions += [
        {**x, "channel": "right"}
        for r in detect_speech_regions(right, duration)
        for x in split_long_region(r)
    ]
    regions = merge_close_same_channel(regions)
    regions = [x for r in regions for x in split_long_region(r)]

    if len(regions) < 2:
        lines: list[str] = []
        start = 0.0
        idx = 0
        while start < duration - 0.05:
            end = min(duration, start + MAX_TURN_SEC)
            for channel, wav, label in (
                ("left", left, LABEL_LEFT),
                ("right", right, LABEL_RIGHT),
            ):
                chunk = tmp / f"fb-{idx:03d}-{channel}.wav"
                extract_slice(wav, chunk, start, end, duration)
                text = transcribe_path(model, chunk)
                if text:
                    lines.append(f"{label}: {text}")
            start = end
            idx += 1
        return "\n".join(lines).strip()

    turns: list[dict] = []
    for i, region in enumerate(regions):
        wav = right if region["channel"] == "right" else left
        chunk = tmp / f"turn-{i:03d}-{region['channel']}.wav"
        extract_slice(wav, chunk, region["start"], region["end"], duration)
        text = transcribe_path(model, chunk)
        if not text:
            continue
        turns.append(
            {
                "channel": region["channel"],
                "start": region["start"],
                "end": region["end"],
                "text": text,
            }
        )
    turns.sort(key=lambda t: (t["start"], 0 if t["channel"] == "left" else 1))
    return merge_turns(turns)


def transcribe_file(src: Path, model_name: str = MODEL_NAME, model=None) -> dict:
    """Распознать файл. Возвращает text / model / stereo / durationSec."""
    src = Path(src)
    loaded = model if model is not None else gigaam.load_model(model_name)
    channels = probe_channels(src)
    stereo = channels >= 2
    with tempfile.TemporaryDirectory(prefix="gigaam-") as raw:
        tmp = Path(raw)
        if stereo:
            text = transcribe_stereo(loaded, src, tmp)
            duration = probe_duration(src)
        else:
            wav = tmp / "mono.wav"
            to_mono_wav(src, wav)
            duration = probe_duration(wav)
            text = transcribe_mono(loaded, wav, duration, tmp)
    return {
        "text": text,
        "model": model_name,
        "stereo": stereo,
        "channels": channels,
        "durationSec": duration,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Транскрибировать аудиофайл локально (GigaAM v3, CPU)."
    )
    parser.add_argument("file", help="Путь к аудио: mp3, wav, ogg, m4a")
    parser.add_argument("-m", "--model", default=MODEL_NAME, help="Имя модели GigaAM")
    parser.add_argument("-o", "--output", help="Записать текст в файл")
    args = parser.parse_args()

    src = Path(args.file).expanduser().resolve()
    if not src.exists():
        print(f"Файл не найден: {src}", file=sys.stderr)
        return 1

    try:
        result = transcribe_file(src, args.model)
    except subprocess.CalledProcessError as err:
        print(f"ffmpeg/ffprobe ошибка: {err}", file=sys.stderr)
        return 1

    text = result["text"]
    if args.output:
        Path(args.output).write_text(text + "\n", encoding="utf-8")
    sys.stdout.write(text + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
