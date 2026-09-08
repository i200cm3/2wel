# 2wel

Персональные презентации для санаториев, отелей и спа.

Гостю — своя страница (9:16) с именем и контентом объекта. Объекту — кабинет, конструктор, CRM API, amoCRM, озвучка и аналитика.

Продакшен: **https://2wel.ru** (кабинет). Гостевые ссылки: **https://`{code}`.2wel.ru/`{id}`** (пример: [djinal.2wel.ru](https://djinal.2wel.ru) — санаторий «Джинал»).

Репозиторий: https://github.com/i200cm3/2wel · подробная модель данных и API — [`SPEC.md`](SPEC.md).

## Деплой на сервер

Перед первым разом:

- DNS `2wel.ru` → IP сервера
- DNS `*.2wel.ru` → тот же IP (**один раз**, не на каждый отель)

С локальной машины:

```bash
./sync-to-server.sh vitaliy@192.168.2.8 /home/vitaliy/promo
```

На сервере (первый раз):

```bash
cd /home/vitaliy/promo
[ -f .env ] || cp .env.example .env
# в .env: DOMAIN=2wel.ru, GUEST_BASE_DOMAIN=2wel.ru, PUBLIC_ORIGIN=https://2wel.ru
#         ENSURE_GUEST_SSL=1, LETSENCRYPT_EMAIL=…
chmod +x init-letsencrypt.sh deploy.sh nginx-router-update.sh
sudo ./nginx-router-update.sh
./init-letsencrypt.sh <email> 2wel.ru
sudo ./nginx-router-update.sh
./deploy.sh
```

Обновление после правок кода:

```bash
./deploy-to-server.sh vitaliy@192.168.2.8 /home/vitaliy/promo
```

Только залить файлы, без пересборки контейнеров:

```bash
./sync-to-server.sh vitaliy@192.168.2.8 /home/vitaliy/promo
```

| Скрипт | Назначение |
|--------|------------|
| `sync-to-server.sh` | rsync проекта на сервер |
| `deploy-to-server.sh` | rsync + `./deploy.sh` на сервере по тому же SSH |
| `init-letsencrypt.sh` | выпуск SSL в Docker volumes `certbot-data` / `certbot-www` |
| `nginx-router-update.sh` | `/etc/nginx/conf.d/promo-router.conf` → `:8086` |
| `deploy.sh` | `docker compose build && up` + health-check |

Сертификаты обновляет контейнер `promo-certbot` (`certbot renew` каждые 12 ч). ACME challenge отдаёт host nginx из volume `certbot-www`.

Rsync копирует код, **`.env`** и статику (`starter`, `music`, TTS demos/starter). Локальные загрузки проектов (`media/projects/*`), сгенерированный TTS и короткие ссылки (`s/`) на сервер **не заливаются** — они живут только на проде. После sync скрипт удаляет на сервере legacy-папки (`media/library`, `media/intro|about|…`, корневые `media/tts/*.mp3`).

## Docker (локально)

Тома Let's Encrypt общие с другими проектами на сервере; локально создайте пустые:

```bash
docker volume create certbot-data
docker volume create certbot-www
[ -f .env ] || cp .env.example .env
docker compose up --build -d
```

Откройте http://localhost:8086 — на проде кабинет: `https://2wel.ru`, гость: `https://{code}.2wel.ru/<shareId>`.

Поддомены тарифа «Старт» (`{code}.2wel.ru`) не требуют правок nginx. Нужна одна wildcard-запись DNS `*.2wel.ru`. SSL для нового кода дописывается при создании объекта или ссылки.

- **web** — лендинг, React-плеер, кабинет `/app`, конструкторы (v1/v2 по тарифу), nginx (прокси `/api` → API)
- **api** — проекты, шаблоны, ссылки, ключ API, медиа, TTS, amo, аналитика; при старте — миграции Postgres и seed демо-объекта
- **db** — Postgres (пользователи, проекты, шаблоны, ссылки, события)

## Локальная разработка без Docker

```bash
cd web && npm install && npm run dev
```

`npm run dev` поднимает Postgres (docker), API на `:3000` и Vite — кабинет не отвалится из‑за выключенного бэкенда.

Плеер по короткой ссылке: `http://localhost:5173/<shareId>`  
Кабинет: `http://localhost:5173/login` · логин `admin` / `changeme`  
Конструктор: `/app/projects/<code>/templates/<category>/edit` (Старт) или `…/edit-v2` (Про)

Только API вручную: `docker compose up db -d`, затем `cd api && npm start`.

Кабинет `/app`: шаблоны (код = category в CRM), ссылки с `externalId`, озвучка, ключ API, документация выдачи, аналитика, тариф.

Медиа проекта: `/media/projects/{code}/` (фото, TTS, музыка).

## Озвучка

Раздел кабинета «Озвучка» (`/app/projects/{code}/voice`) задаёт, кто читает титры. Выбор хранится у объекта (`projects.tts_provider`, `projects.tts_voice`) и применяется ко всем новым генерациям.

- **ElevenLabs (eleven_v3)** — основной сервис. Голоса в `ELEVENLABS_VOICES`. Если с 2wel.ru API ElevenLabs недоступен — прокси на VDS: [`elevenlabs-proxy/README.md`](elevenlabs-proxy/README.md), `ELEVENLABS_PROXY_URL` и `ELEVENLABS_PROXY_SECRET` (ключ API только на VDS).
- **Демо голосов в кабинете** — фраза в `elevenlabs-proxy/voice-demo.json`, MP3 в `web/public/media/tts/demos/elevenlabs/`. Перегенерация: `./scripts/generate-elevenlabs-demos-on-vds.sh`.
- **SaluteSpeech (Сбер)** — запасной вариант при `TTS_PROVIDER=sber` и ключах SaluteSpeech.

Готовые файлы **не отдаются на скачивание**: путь `/media/**/tts/**` закрыт в nginx, кабинет играет их через `/api/projects/:code/tts/file/:name` по сессии, а гостю в конфиге приходит подписанная ссылка `/api/public/tts/:token` со сроком `TTS_LINK_TTL_HOURS`. Генерация ограничена по частоте на объект и по длине текста — озвучка титров, а не студия синтеза.

## Регистрация и почта

`AUTH_REGISTRATION` в `.env`:

- `open` — любой может завести аккаунт
- `invite` — только по ссылке администратора (`EDITOR_LOGIN` / владелец). Приглашённый не может звать других.
- `closed` — только вручную: `cd api && npm run user -- --email a@b.c --password 'secret12'`

Команда объекта: владелец в кабинете → **Команда** приглашает сотрудника по почте — письмо со ссылкой `/join?invite=…` (14 дней). Сотрудник открывает ссылку, нажимает «Присоединиться»: аккаунт создаётся (или обновляется), пароль уходит на ту же почту, сессия открывается сразу. Сотрудник работает с шаблонами, ссылками и голосом, без прав администратора системы и без смены тарифа, интеграций и состава команды.

Сброс пароля: `/forgot`. На почту уходит **код из 4 цифр** с `support@2wel.ru` (SMTP SpaceWeb). Затем `/reset`. Регистрация тоже подтверждается кодом. Без пароля ящика код пишется в лог API.

## CI

На каждый push / PR в `main` GitHub Actions гоняет:

- `api`: `npm ci` → `npm test`
- `web`: `npm ci` → `npm test` → `tsc -b`

См. [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Секреты

- Боевые пароли и ключи — только в `.env` (и `*/.env` на VDS), никогда в `.env.example`.
- `sync-to-server.sh` копирует корневой `.env` на сервер 2wel, но **не** копирует `gemini-transcribe/.env` и `elevenlabs-proxy/.env` (ключи API остаются на VDS).
- API не стартует, если `SMTP_PASS` из списка ранее утёкших (был в example). После смены пароля в SpaceWeb обновите `.env` и перезапустите.
- VDS-прокси слушают HTTP: на VDS задайте `*_ALLOW_IPS` под IP сервера 2wel и длинный общий `*_SECRET`.
