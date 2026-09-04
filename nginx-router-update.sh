#!/bin/bash

# Host nginx-router для проекта promo (конструктор).
# Читает DOMAIN и PROMO_PORT из .env в каталоге скрипта.
# Маршрутизация: $DOMAIN и *.$DOMAIN → http://127.0.0.1:$PROMO_PORT (контейнер promo-web)
#
# Гостевые ссылки: https://djinal.2wel.ru/xxxx
# DNS один раз: A-запись * → IP сервера (wildcard *.2wel.ru).
# SSL без wildcard-сертификата: агент guest-ssl дописывает SAN при создании ссылки.
# Затем: sudo ./nginx-router-update.sh  (после первого сертификата)

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "${PROJECT_DIR}/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "${PROJECT_DIR}/.env"
  set +a
fi

DOMAIN="${DOMAIN:-2wel.ru}"
PROMO_PORT="${PROMO_PORT:-8086}"
# Кабинет на apex, гости на {code}.2wel.ru (wildcard).
SERVER_NAMES="${DOMAIN} *.${DOMAIN}"

NGINX_CONF_DIR="/etc/nginx"
ROUTER_CONF="${NGINX_CONF_DIR}/conf.d/promo-router.conf"
CERT_LIVE="/var/lib/docker/volumes/certbot-data/_data/live/${DOMAIN}"
CERT_FULLCHAIN="${CERT_LIVE}/fullchain.pem"
CERT_KEY="${CERT_LIVE}/privkey.pem"

if [ "$EUID" -ne 0 ]; then
  echo "Запусти скрипт от root: sudo $0"
  exit 1
fi

write_http_only() {
  cat > "${ROUTER_CONF}" <<EOF
##
## ${DOMAIN} — HTTP + ACME (сертификатов ещё нет)
## После init-letsencrypt.sh снова: sudo ./nginx-router-update.sh
##

server {
    listen 80;
    server_name ${SERVER_NAMES};

    access_log /var/log/nginx/promo.access.log;
    error_log  /var/log/nginx/promo.error.log;

    location ^~ /.well-known/acme-challenge/ {
      root /var/lib/docker/volumes/certbot-www/_data;
      default_type "text/plain";
    }

    location / {
        proxy_pass http://127.0.0.1:${PROMO_PORT};

        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        proxy_connect_timeout 60s;
        proxy_send_timeout    180s;
        proxy_read_timeout    180s;

        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_buffering off;
        client_max_body_size 300m;
    }
}
EOF
}

write_https() {
  cat > "${ROUTER_CONF}" <<EOF
##
## ${DOMAIN} через внешний nginx-router
##

# HTTP → редирект на HTTPS
server {
    listen 80;
    server_name ${SERVER_NAMES};

    access_log /var/log/nginx/promo.access.log;
    error_log  /var/log/nginx/promo.error.log;

    location ^~ /.well-known/acme-challenge/ {
      root /var/lib/docker/volumes/certbot-www/_data;
      default_type "text/plain";
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

# HTTPS с терминацией TLS и прокси на контейнер promo-web
server {
    listen 443 ssl http2;
    server_name ${SERVER_NAMES};

    ssl_certificate     /var/lib/docker/volumes/certbot-data/_data/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /var/lib/docker/volumes/certbot-data/_data/live/${DOMAIN}/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384';
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    access_log /var/log/nginx/promo.access.log;
    error_log  /var/log/nginx/promo.error.log;

    client_max_body_size 300m;

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    location / {
        proxy_pass http://127.0.0.1:${PROMO_PORT};

        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        proxy_connect_timeout 60s;
        proxy_send_timeout    180s;
        proxy_read_timeout    180s;

        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_buffering off;
        client_max_body_size 300m;
    }
}
EOF
}

if [ -f "${CERT_FULLCHAIN}" ] && [ -f "${CERT_KEY}" ]; then
  echo "Сертификаты найдены. Пишу HTTPS-конфиг в ${ROUTER_CONF}..."
  write_https
  HTTPS=1
else
  echo "Сертификатов нет: ${CERT_FULLCHAIN}"
  echo "Пишу временный HTTP-конфиг (ACME + прокси на :${PROMO_PORT}) в ${ROUTER_CONF}..."
  echo "Сначала выпустите сертификат:"
  echo "  ./init-letsencrypt.sh vitaliy@djinal.ru ${DOMAIN}"
  echo "затем снова: sudo ./nginx-router-update.sh"
  write_http_only
  HTTPS=0
fi

# www-data должен проходить в docker volume webroot (иначе ACME → 403).
if [ -d /var/lib/docker ]; then
  chmod 711 /var/lib/docker /var/lib/docker/volumes 2>/dev/null || true
fi
if [ -d /var/lib/docker/volumes/certbot-www/_data ]; then
  mkdir -p /var/lib/docker/volumes/certbot-www/_data/.well-known/acme-challenge
  chmod -R a+rX /var/lib/docker/volumes/certbot-www/_data
fi

echo "Проверяю конфиг nginx..."
nginx -t

echo "Перезагружаю nginx..."
systemctl reload nginx || nginx -s reload

if [ "$HTTPS" = "1" ]; then
  echo "Готово. https://${DOMAIN} → http://127.0.0.1:${PROMO_PORT} (promo-web)."
else
  echo "Готово (пока HTTP). После сертификатов повторите: sudo ./nginx-router-update.sh"
fi
