# Deploying on TrueNAS SCALE + Cloudflare Tunnel

## 1. The container

The `Release image` workflow publishes `ghcr.io/jigle/couchpotato:latest` on every push to `main`.

1. TrueNAS → **Apps → Discover Apps → Custom App → Install via YAML**.
2. Paste `docker-compose.yml` from this repo.
3. If the repo is private, make the package public in GitHub (*Packages → couchpotato → Package settings → Change visibility*) or add GHCR credentials in TrueNAS.
4. Check `http://<truenas-ip>:3000/healthz` returns `{"ok":true}`.

Updating: TrueNAS → the app → **Update / Pull image**. Roll back by pinning a sha or `v*` tag.

## 2. The tunnel

In the Cloudflare Zero Trust dashboard → **Networks → Tunnels → your tunnel → Public hostnames**:

| Field | Value |
| --- | --- |
| Subdomain | `cp` (short is easier to type on a TV) |
| Service | `HTTP` → `<truenas-ip>:3000` |

WebSockets are on by default for tunnels. If phones keep reconnecting, check
**Network → WebSockets** is enabled for the zone.

The app pings every 20 s, well inside Cloudflare's idle timeout.

## 3. Protecting admin (from Phase 3)

Optional extra layer: a Cloudflare **Access** application on `cp.<your-domain>/admin*` and `/host*`
with your e-mail as the only allowed identity. Leave `/`, `/tv` and `/ws` open so guests can join.

## 4. Smoke test (Phase 0)

- TV / laptop: open `https://cp.<your-domain>/tv`
- Two phones: open `https://cp.<your-domain>/`, enter a name, tap
- The TV count goes up instantly; lock a phone for a minute, unlock it, tap again.
