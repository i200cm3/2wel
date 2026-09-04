# sing-box на VDS: только ElevenLabs через WARP

Мёртвый SOCKS `69.55.49.177:38182` заменён на Cloudflare WARP.
Локальный рабочий SOCKS слушает `127.0.0.1:38182` (не снаружи).

```
Обычный трафик (google.com, pclip, …)  →  direct
*.elevenlabs.io / IP ElevenLabs        →  WARP  →  api.elevenlabs.io
*.googleapis.com (Gemini API)          →  WARP  →  generativelanguage.googleapis.com
SOCKS 127.0.0.1:38182                  →  WARP
```

## Установка / обновление на VDS

Нужны файлы (только на сервере, не в git):

- `/etc/sing-box/warp/wgcf-profile.conf`
- `/etc/sing-box/warp/reserved.json` — `[b1, b2, b3]`

```bash
cd ~/elevenlabs-proxy/sing-box
sudo bash install-on-vds.sh
```

Скрипт собирает `/etc/sing-box/config.json` из `config.template.json` + WARP-ключи, обновляет IP ElevenLabs и перезапускает `sing-box`.

## Проверка

```bash
# Обычный сайт — direct
curl -4 -o /dev/null -w '%{http_code}\n' https://google.com

# ElevenLabs с хоста (TUN → WARP). 401 = API доступен (ключ тестовый)
curl -4 -o /dev/null -w '%{http_code}\n' https://api.elevenlabs.io/v1/user -H 'xi-api-key: x'

# Тот же путь через локальный SOCKS
curl -4 -o /dev/null -w '%{http_code}\n' --socks5-hostname 127.0.0.1:38182 \
  https://api.elevenlabs.io/v1/user -H 'xi-api-key: x'

sudo journalctl -u sing-box -n 20 --no-pager
```

Прямой доступ к ElevenLabs с IP VDS даёт 302 (геоблок ASN). Без WARP синтез не работает.

## elevenlabs-proxy (Docker)

Контейнер `:3099` должен быть с `network_mode: host`, чтобы исходящие к ElevenLabs попадали в TUN sing-box:

```bash
cd ~/elevenlabs-proxy && ./deploy.sh
```
