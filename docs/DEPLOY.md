# Deploying on TrueNAS SCALE + Cloudflare Tunnel

## 1. The container

The `Release image` workflow publishes `ghcr.io/jigle/couchpotato:latest` on every push to `main`.

1. TrueNAS → **Apps → Discover Apps → Custom App → Install via YAML**.
2. Paste `docker-compose.yml` from this repo.
3. If the repo is private, make the package public in GitHub (*Packages → couchpotato → Package settings → Change visibility*) or add GHCR credentials in TrueNAS.
4. Check `http://<truenas-ip>:3000/healthz` returns `{"ok":true,"version":"…","storage":true}`.

### Saved data (`/data`)

Hosts, invites and settings live in one SQLite file, `couchpotato.db`, in the `couchpotato-data` volume
mounted at `/data`. Updating the image keeps it; the schema upgrades itself on start.

- **`"storage":false` in `/healthz`** means the server could not write to `/data` (games still work, sign-in
  will not). Usually the volume was created before the image owned `/data`. Fix it once from
  **System → Shell**, then Stop → Start the app:
  ```
  sudo docker run --rm -v couchpotato-data:/data alpine chown -R 1000:1000 /data
  ```
  (If TrueNAS prefixed the volume name, find it with `sudo docker volume ls | grep couchpotato`.)
- **Back up** by copying `couchpotato.db` while the app is stopped, or include the volume in a TrueNAS snapshot.
- **Rolling back** to an image older than the database is refused (the log says
  `database is at version …`); restore the backup that matches that image instead.

### Updating (no reinstall)

TrueNAS keeps using the image it already has unless told to look again. The compose file sets
`pull_policy: always`, so:

1. Merge to `main` and wait for **Actions → Release image** to go green (~3 min).
2. TrueNAS → **Apps** → couchpotato → **Stop**, then **Start**.
3. Open `/healthz`: `version` should match the first characters of the merged commit on GitHub.

If the app was installed before `pull_policy` was added, do this once: **Apps → couchpotato → Edit**,
replace the YAML with the current `docker-compose.yml`, **Save**. Editing keeps the app and its data.

Roll back by changing `:latest` to a commit sha or `v*` tag in the YAML (Edit → Save).

### App icon in TrueNAS (optional)

TrueNAS has no setting for a custom app's icon, so it shows a grey box. The community workaround is to
point the app's metadata at an image. TrueNAS can reset it when you **Edit** the app's YAML; just repeat it.

1. TrueNAS → **System → Shell**.
2. Run (one line). It adds an `icon:` line right after the app's `home:` line:
   ```
   sudo sed -i "/^couchpotato:/,/^[^ ]/ s#^    home: ''#    home: ''\n    icon: https://raw.githubusercontent.com/JIGLE/couchpotato/main/apps/web/public/icon-512.png#" /mnt/.ix-apps/metadata.yaml
   ```
3. Check: `sudo grep -A15 '^couchpotato:' /mnt/.ix-apps/metadata.yaml | grep icon` prints the line.
   Hard-refresh the TrueNAS Apps page (browsers cache icons).

If the icon disappears after editing the app's YAML, run step 2 again. If `grep` shows two `icon:`
lines, open the file with `sudo nano /mnt/.ix-apps/metadata.yaml` and delete one.

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
