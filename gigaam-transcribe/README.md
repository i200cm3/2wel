# GigaAM transcribe (локальный STT)

Транскрибация звонков на CPU, без облака. Стерео АТС: **L=Клиент, R=Оператор**.

Контракт для 2wel: `POST /v1/transcribe` → `{ text, model, mimeType, bytes, stereo, durationSec }`.

Сейчас работает на `192.168.2.6:3200`. Весь сервис — один Docker Compose; перенос на другой хост = sync + build.

## Перенос на другой сервер

С ноутбука (из корня `video/`):

```bash
# только файлы
./sync-gigaam-transcribe.sh user@NEW_HOST /home/user/gigaam-transcribe

# файлы + сборка контейнера
./deploy-gigaam-transcribe.sh user@NEW_HOST /home/user/gigaam-transcribe
```

По умолчанию: `vitaliy@192.168.2.6:/home/vitaliy/gigaam-transcribe`.

На целевом сервере нужен Docker:

```bash
# Ubuntu
sudo apt update && sudo apt install -y docker.io docker-compose-v2
sudo usermod -aG docker "$USER"   # затем перелогиниться
```

Порт **3200** должен быть доступен с сервера 2wel (LAN или firewall).

После переноса в `.env` 2wel:

```env
GIGAAM_TRANSCRIBE_URL=http://NEW_HOST:3200
GIGAAM_TRANSCRIBE_SECRET=тот_же_секрет
```

## Локально / на сервере вручную

```bash
cd gigaam-transcribe
cp .env.example .env
# опционально: GIGAAM_TRANSCRIBE_SECRET=$(openssl rand -hex 32)
./deploy.sh
# или: docker compose up -d --build
curl -s http://127.0.0.1:3200/health
```

Первый старт качает веса модели (~430 МБ) в `./cache`. При следующем деплое `cache/` и `.env` **не** затираются sync-скриптом.

### Файл

```bash
curl -sS -X POST "http://HOST:3200/v1/transcribe" \
  -H "Authorization: Bearer СЕКРЕТ" \
  -F "file=@recording.mp3"
```

### URL записи (Sipuni и т.п.)

```bash
curl -sS -X POST "http://HOST:3200/v1/transcribe" \
  -H "Authorization: Bearer СЕКРЕТ" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/recording.mp3"}'
```

Если `GIGAAM_TRANSCRIBE_SECRET` пустой, заголовок Authorization не нужен (только закрытая LAN).

## CLI без Docker

```bash
python transcribe.py recording.mp3
```

Нужны `ffmpeg`, зависимости из `requirements.txt` и CPU-сборки torch (см. `Dockerfile`).
