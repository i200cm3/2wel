# ElevenLabs proxy (VDS-прослойка)

2wel.ru → **этот сервер** → api.elevenlabs.io → MP3 обратно на 2wel.

Рядом на том же VDS: **gemini-transcribe** (`:3100`) — транскрибация звонков через Gemini (googleapis.com тоже через WARP).

Домены и nginx **не нужны**: 2wel стучится на `http://156.229.27.67:3099` и `:3100`.

```
2wel (promo-api)  --POST /v1/synthesize + Bearer secret-->
156.229.27.67:3099  --host network-->  sing-box TUN
  *.elevenlabs.io → WARP (локальный SOCKS 127.0.0.1:38182)
  остальное → direct
ElevenLabs  -->  audio/mpeg
```

Исходящий SOCKS `69.55.49.177:38182` мёртв. На VDS слушает **локальный** SOCKS `127.0.0.1:38182` (WARP). Подробности: [`sing-box/README.md`](sing-box/README.md).

## С ноутбука (как 2wel: sync + deploy)

Из корня проекта:

```bash
./deploy-elevenlabs-proxy.sh
```

Или из папки прокси:

```bash
cd elevenlabs-proxy
./deploy-to-vds.sh          # копирование + docker на 156.229.27.67
./sync-to-vds.sh            # только копирование
```

По умолчанию: `vitaliy@156.229.27.67:/home/vitaliy/elevenlabs-proxy`

SSH-ключ (чтобы не вводить пароль каждый раз):

```bash
ssh-copy-id vitaliy@156.229.27.67
```

## На VDS (если Docker ещё нет)

```bash
# Ubuntu
sudo apt update && sudo apt install -y docker.io docker-compose-v2
sudo usermod -aG docker vitaliy
# перелогиниться
```

Открыть порт **3099** в firewall (если включён):

```bash
sudo ufw allow 3099/tcp
```

## 2wel.ru (.env основного проекта)

```env
ELEVENLABS_PROXY_URL=http://156.229.27.67:3099
ELEVENLABS_PROXY_SECRET=тот_же_секрет
# ELEVENLABS_API_KEY=  ← можно убрать с 2wel, ключ только на VDS
```

Перезапуск 2wel: `./deploy-to-server.sh …`

## Проверка

На VDS:

```bash
curl -s http://127.0.0.1:3099/health
```

Баланс подписки (символы):

```bash
curl -sS "http://156.229.27.67:3099/v1/subscription" \
  -H "Authorization: Bearer ВАШ_СЕКРЕТ"
```

С сервера 2wel:

```bash
curl -sS -X POST "http://156.229.27.67:3099/v1/synthesize" \
  -H "Authorization: Bearer ВАШ_СЕКРЕТ" \
  -H "Content-Type: application/json" \
  -d '{"text":"Тест","voice":"ymDCYd8puC7gYjxIamPt"}' \
  -o /tmp/t.mp3 && file /tmp/t.mp3
```
