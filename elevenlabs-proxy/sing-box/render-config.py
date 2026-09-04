#!/usr/bin/env python3
"""Fill WARP keys into config.template.json. Secrets stay on the VDS."""
import json
import pathlib
import re
import sys

def parse_profile(path: pathlib.Path) -> dict:
    text = path.read_text(encoding="utf-8")
    priv = re.search(r"PrivateKey\s*=\s*(\S+)", text)
    pub = re.search(r"PublicKey\s*=\s*(\S+)", text)
    addr = re.search(r"Address\s*=\s*(.+)", text)
    endpoint = re.search(r"Endpoint\s*=\s*(\S+)", text)
    if not (priv and pub and addr and endpoint):
        raise SystemExit(f"incomplete WireGuard profile: {path}")
    addresses = [item.strip() for item in addr.group(1).split(",") if item.strip()]
    host, port_s = endpoint.group(1).rsplit(":", 1)
    return {
        "private_key": priv.group(1),
        "peer_public_key": pub.group(1),
        "address": addresses,
        "peer_host": host,
        "peer_port": int(port_s),
    }


def reserved_bytes(path: pathlib.Path) -> list:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(raw, dict):
        raw = raw.get("reserved") or raw.get("bytes")
    if not isinstance(raw, list) or len(raw) != 3:
        raise SystemExit(f"reserved must be 3 bytes: {path}")
    return [int(x) for x in raw]


def main() -> None:
    if len(sys.argv) != 5:
        raise SystemExit(
            "usage: render-config.py TEMPLATE PROFILE RESERVED.json OUT.json"
        )
    template, profile, reserved_path, out = map(pathlib.Path, sys.argv[1:])
    cfg = json.loads(template.read_text(encoding="utf-8"))
    warp = parse_profile(profile)
    reserved = reserved_bytes(reserved_path)
    endpoint = None
    for item in cfg.get("endpoints", []):
        if item.get("tag") == "eleven-proxy" and item.get("type") == "wireguard":
            endpoint = item
            break
    if endpoint is None:
        raise SystemExit("template missing wireguard endpoint tag=eleven-proxy")
    endpoint["private_key"] = warp["private_key"]
    endpoint["address"] = warp["address"]
    peer = endpoint["peers"][0]
    peer["public_key"] = warp["peer_public_key"]
    peer["address"] = warp["peer_host"]
    peer["port"] = warp["peer_port"]
    peer["reserved"] = reserved
    out.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {out} (WARP endpoint, SOCKS 127.0.0.1:38182)")


if __name__ == "__main__":
    main()
