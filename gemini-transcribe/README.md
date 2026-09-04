# Gemini proxy (VDS-прослойка для 2wel)

Транскрибация аудио и текстовый generate через Gemini API.

2wel.ru → **этот сервер** → generativelanguage.googleapis.com.

Домены и nginx **не нужны**: 2wel стучится на `http://156.229.27.67:3100`.

## Локальный пробный запуск

```bash
cd gemini-transcribe
cp .env.example .env
# Заполните GEMINI_API_KEY и (для HTTP) GEMINI_TRANSCRIBE_SECRET
```

CLI (без HTTP):

```bash
node cli.mjs "https://example.com/recording.mp3"
```

HTTP-сервер:

```bash
npm start
curl -s http://127.0.0.1:3100/health
```

### Транскрибация

```bash
curl -sS -X POST "http://127.0.0.1:3100/v1/transcribe" \
  -H "Authorization: Bearer ВАШ_СЕКРЕТ" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/recording.mp3"}'
```

Ответ:

```json
{
  "text": "…расшифровка…",
  "model": "gemini-3.6-flash",
  "mimeType": "audio/mpeg",
  "bytes": 123456
}
```

Опционально в body: `language` (подсказка языка), `prompt` (кастомный промпт).

Лимит файла по умолчанию: 20 МБ (`MAX_AUDIO_BYTES`).

### Текстовый generate (extract summary и т.п.)

```bash
curl -sS -X POST "http://127.0.0.1:3100/v1/generate" \
  -H "Authorization: Bearer ВАШ_СЕКРЕТ" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Скажи коротко: ок","temperature":0.1}'
```

Ответ:

```json
{
  "text": "ок",
  "model": "gemini-3.6-flash"
}
```

Лимит тела запроса по умолчанию: 512 КБ (`MAX_GENERATE_BYTES`).

### Sipuni (звонки)

Ссылки вида `https://sipuni.com/api/crm/record?id=…&hash=…&user=…` отдают `audio/mpeg` напрямую — передавайте URL как есть в `url`, без доп. настроек.

```bash
node cli.mjs "https://sipuni.com/api/crm/record?id=1787824581.436923&hash=…&user=094270"
```

## С ноутбука (deploy на VDS)

```bash
cd gemini-transcribe
./deploy-to-vds.sh
```

По умолчанию: `vitaliy@156.229.27.67:/home/vitaliy/gemini-transcribe`

Открыть порт **3100** на VDS (если firewall):

```bash
sudo ufw allow 3100/tcp
```

## 2wel.ru (.env основного проекта)

```env
GEMINI_TRANSCRIBE_URL=http://156.229.27.67:3100
GEMINI_TRANSCRIBE_SECRET=тот_же_секрет
# GEMINI_API_KEY=  ← только на VDS, не на 2wel
```

## Проверка на VDS

```bash
curl -s http://127.0.0.1:3100/health
```
