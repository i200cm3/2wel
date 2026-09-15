FROM python:3.12-slim-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg git libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir torch==2.8.0 torchaudio==2.8.0 \
        --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt

COPY transcribe.py server.py ./

ENV PORT=3200 \
    GIGAAM_MODEL=v3_e2e_rnnt \
    PYTHONUNBUFFERED=1 \
    HF_HUB_OFFLINE=0

EXPOSE 3200

HEALTHCHECK --interval=20s --timeout=8s --retries=5 --start-period=90s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:3200/health')"

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "3200", "--timeout-keep-alive", "120"]
