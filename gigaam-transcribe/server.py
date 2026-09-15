"""HTTP API для локальной транскрибации GigaAM.

POST /v1/transcribe — multipart file=… или JSON {url}
GET  /health
"""

from __future__ import annotations

import hmac
import json
import os
import tempfile
import threading
from pathlib import Path
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.datastructures import UploadFile as StarletteUploadFile

from transcribe import MODEL_NAME, transcribe_file

SECRET = os.environ.get("GIGAAM_TRANSCRIBE_SECRET", "").strip()
MAX_AUDIO_BYTES = int(os.environ.get("MAX_AUDIO_BYTES", str(20 * 1024 * 1024)))
DOWNLOAD_TIMEOUT_MS = int(os.environ.get("DOWNLOAD_TIMEOUT_MS", "120000"))
GIGAAM_MODEL = os.environ.get("GIGAAM_MODEL", MODEL_NAME).strip() or MODEL_NAME

_model = None
_lock = threading.Lock()

app = FastAPI(title="gigaam-transcribe", docs_url=None, redoc_url=None)


def _secret_ok(authorization: str | None) -> bool:
    if not SECRET:
        return True
    raw = authorization or ""
    token = raw[7:].strip() if raw.startswith("Bearer ") else ""
    if not token or len(token) != len(SECRET):
        return False
    return hmac.compare_digest(token, SECRET)


def _authorize(authorization: str | None) -> None:
    if not _secret_ok(authorization):
        raise HTTPException(status_code=401, detail="unauthorized")


def _get_model():
    global _model
    if _model is None:
        import gigaam

        _model = gigaam.load_model(GIGAAM_MODEL)
    return _model


@app.on_event("startup")
def _startup() -> None:
    _get_model()


def _suffix_from_name(name: str, fallback: str = ".mp3") -> str:
    suffix = Path(name).suffix.lower()
    if suffix in {".mp3", ".wav", ".ogg", ".opus", ".m4a", ".aac", ".flac", ".webm"}:
        return suffix
    return fallback


def _write_temp(body: bytes, suffix: str) -> Path:
    fd, raw = tempfile.mkstemp(prefix="gigaam-up-", suffix=suffix)
    os.close(fd)
    path = Path(raw)
    path.write_bytes(body)
    return path


def _run_file(path: Path) -> dict:
    with _lock:
        return transcribe_file(path, GIGAAM_MODEL, model=_get_model())


@app.get("/health")
def health():
    return {
        "ok": True,
        "model": GIGAAM_MODEL,
        "auth": bool(SECRET),
        "ready": _model is not None,
    }


@app.post("/v1/transcribe")
async def transcribe(request: Request, authorization: str | None = Header(default=None)):
    _authorize(authorization)

    content_type = (request.headers.get("content-type") or "").lower()
    tmp_path: Path | None = None
    mime_type = "application/octet-stream"
    nbytes = 0

    try:
        if content_type.startswith("multipart/form-data"):
            form = await request.form()
            upload = form.get("file")
            if not isinstance(upload, StarletteUploadFile):
                raise HTTPException(status_code=400, detail="file required")
            body = await upload.read()
            nbytes = len(body)
            if nbytes > MAX_AUDIO_BYTES:
                raise HTTPException(status_code=413, detail="payload too large")
            if nbytes == 0:
                raise HTTPException(status_code=400, detail="empty file")
            mime_type = upload.content_type or mime_type
            tmp_path = _write_temp(body, _suffix_from_name(upload.filename or "audio.mp3"))
        else:
            try:
                payload = json.loads((await request.body()).decode("utf-8") or "{}")
            except json.JSONDecodeError:
                raise HTTPException(status_code=400, detail="invalid json") from None
            audio_url = str(payload.get("url") or "").strip()
            if not audio_url:
                raise HTTPException(status_code=400, detail="file or url required")
            try:
                parsed = urlparse(audio_url)
                if parsed.scheme not in {"http", "https"}:
                    raise ValueError("scheme")
            except Exception:
                raise HTTPException(status_code=400, detail="invalid url") from None
            timeout = httpx.Timeout(DOWNLOAD_TIMEOUT_MS / 1000)
            try:
                async with httpx.AsyncClient(follow_redirects=True, timeout=timeout) as client:
                    resp = await client.get(audio_url)
                    resp.raise_for_status()
                    body = resp.content
            except httpx.HTTPError as err:
                raise HTTPException(status_code=502, detail=f"download failed: {err}") from err
            nbytes = len(body)
            if nbytes > MAX_AUDIO_BYTES:
                raise HTTPException(status_code=413, detail="payload too large")
            mime_type = (resp.headers.get("content-type") or mime_type).split(";")[0].strip()
            tmp_path = _write_temp(body, _suffix_from_name(parsed.path, ".mp3"))

        try:
            result = _run_file(tmp_path)
        except HTTPException:
            raise
        except Exception as err:
            raise HTTPException(status_code=500, detail=str(err)[:400]) from err

        return JSONResponse(
            {
                "text": result["text"],
                "model": result["model"],
                "mimeType": mime_type,
                "bytes": nbytes,
                "stereo": result["stereo"],
                "durationSec": result["durationSec"],
            }
        )
    finally:
        if tmp_path is not None:
            tmp_path.unlink(missing_ok=True)
