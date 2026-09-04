#!/bin/bash
# Обновляет IP ElevenLabs в /etc/sing-box/config.json (route_address + ip_cidr).
set -euo pipefail
CONFIG="${1:-/etc/sing-box/config.json}"
TMP="$(mktemp)"

collect_ips() {
  local ips=()
  # api.us — кабинет/API keys; без него TUN не ловит UI и CORS ломается на 302
  for host in api.elevenlabs.io api.us.elevenlabs.io elevenlabs.io www.elevenlabs.io; do
    while read -r ip; do
      [[ -n "$ip" ]] && ips+=("$ip")
    done < <(dig +short A "$host" | grep -E '^[0-9]+\.')
  done
  printf '%s\n' "${ips[@]}" | sort -u
}

IPS=($(collect_ips))
if [ ${#IPS[@]} -eq 0 ]; then
  echo "Не удалось резолвить elevenlabs.io"
  exit 1
fi

python3 - "$CONFIG" "$TMP" "${IPS[@]}" <<'PY'
import json, sys
config_path, out_path = sys.argv[1], sys.argv[2]
ips = sys.argv[3:]
cidrs = [f"{ip}/32" for ip in ips]
with open(config_path, encoding="utf-8") as f:
    cfg = json.load(f)
for inbound in cfg.get("inbounds", []):
    if inbound.get("type") == "tun":
        inbound["route_address"] = cidrs
rules = cfg.setdefault("route", {}).setdefault("rules", [])
for rule in rules:
    if "ip_cidr" in rule and rule.get("outbound") == "eleven-proxy":
        rule["ip_cidr"] = cidrs
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(cfg, f, indent=2, ensure_ascii=False)
    f.write("\n")
PY

sing-box check -c "$TMP"
mv "$TMP" "$CONFIG"
echo "Обновлено IP ElevenLabs: ${IPS[*]}"
