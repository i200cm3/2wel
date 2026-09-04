#!/bin/bash
# На VDS (sudo): sing-box split-tunnel — ElevenLabs через WARP, остальное direct.
# Локальный SOCKS: 127.0.0.1:38182 (весь SOCKS-трафик тоже через WARP).
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WARP_DIR="/etc/sing-box/warp"

sudo mkdir -p /etc/sing-box "$WARP_DIR"
sudo cp -a /etc/sing-box/config.json "/etc/sing-box/config.json.bak.$(date +%Y%m%d-%H%M%S)" 2>/dev/null || true

if [ ! -f "$WARP_DIR/wgcf-profile.conf" ] || [ ! -f "$WARP_DIR/reserved.json" ]; then
  echo "Нет WARP-профиля в $WARP_DIR (wgcf-profile.conf + reserved.json)" >&2
  exit 1
fi

TMP="$(mktemp)"
sudo python3 "$DIR/render-config.py" \
  "$DIR/config.template.json" \
  "$WARP_DIR/wgcf-profile.conf" \
  "$WARP_DIR/reserved.json" \
  "$TMP"
sudo mv "$TMP" /etc/sing-box/config.json
sudo chmod 600 /etc/sing-box/config.json

sudo cp "$DIR/update-elevenlabs-ips.sh" /usr/local/bin/update-elevenlabs-ips.sh
sudo chmod +x /usr/local/bin/update-elevenlabs-ips.sh
sudo /usr/local/bin/update-elevenlabs-ips.sh /etc/sing-box/config.json
sudo sing-box check -c /etc/sing-box/config.json
sudo systemctl enable sing-box 2>/dev/null || true
sudo systemctl restart sing-box
systemctl is-active sing-box
echo "sing-box: *.elevenlabs.io → WARP, SOCKS 127.0.0.1:38182 → WARP, остальное direct"
