# VM deployment (Oracle Cloud / Hetzner)

Deploy Atlas on a small Linux VM with a **reserved public IP** for Flattrade OAuth and scheduled paper trading.

## Prerequisites

- Ubuntu 22.04+ or similar (amd64)
- Reserved **static public IP** on the VM
- Flattrade Wall account with API key + secret (created once)
- Domain not required; OAuth uses `http://<IP>:8080/callback`

## 1. Create the VM

### Oracle Cloud (example)

1. Create a VM.Standard.E2.1.Micro (or larger) in your home region.
2. Attach a **reserved public IP** (Networking → Reserved public IPs).
3. Security list / NSG: allow inbound **TCP 8080** from `0.0.0.0/0` (or your IP for OAuth).
4. **Do not** expose Redis (6379) to the internet.

### Hetzner (example)

1. Create a CX22 (or similar) with a static IPv4.
2. Firewall: allow **8080/tcp** inbound; block 6379 from public.

SSH in as root or sudo user.

## 2. Install dependencies

### Option A — Docker (recommended)

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"
# re-login
```

### Option B — Bare binary + Redis

```bash
sudo apt update
sudo apt install -y redis-server golang make git curl
sudo systemctl enable --now redis-server
```

## 3. Clone and configure

```bash
git clone <your-repo> atlas
cd atlas
cp .env.example .env
```

Edit `.env`:

```bash
FLATTRADE_API_KEY=...
FLATTRADE_API_SECRET=...
FLATTRADE_CLIENT_ID=...
REDIS_ADDR=localhost:6379   # or redis:6379 in Docker
ATLAS_CONFIG=configs/atlas.paper.yaml
```

Edit `configs/atlas.paper.yaml` if needed:

- `flattrade.redirect_url`: `http://<VM_PUBLIC_IP>:8080/callback`
- `execution.mode`: `PAPER` (default in this file)

## 4. Register IP in Flattrade Wall

1. Log in to Flattrade Wall.
2. Whitelist the VM **public IP** (required for Pi API).
3. Set OAuth **redirect URL** to `http://<VM_PUBLIC_IP>:8080/callback`.
4. Note API key and secret (static; not the daily jKey).

See [flattrade-api.md](flattrade-api.md) for details.

## 5. Install Atlas

### Docker

```bash
make deploy-docker-vm
# or
docker compose -f deployments/docker-compose.vm.yml up -d --build
```

### Bare metal

```bash
chmod +x scripts/deploy-vm.sh
sudo INSTALL_DIR=/opt/atlas ./scripts/deploy-vm.sh
sudo cp .env /opt/atlas/.env
sudo chown atlas:atlas /opt/atlas/.env
```

If using **systemd timer** for daily tokens, disable the in-process job to avoid duplicates:

```yaml
# configs/atlas.paper.yaml
session_token_job:
  enabled: false
```

## 6. First run — session token (PAPER)

Flattrade jKey expires daily (~cleared 5–6 AM IST). Exchange it **before** starting `-serve`.

**Stop** Atlas if it is already running (it binds port 8080 for `/healthz`).

```bash
# bare metal
sudo -u atlas /opt/atlas/bin/atlas -config /opt/atlas/configs/atlas.paper.yaml -listen-auth

# from repo (dev)
make listen-auth
```

1. Open the printed Flattrade auth URL in a browser.
2. Complete login; browser redirects to `http://<IP>:8080/callback?request_code=...`
3. Confirm “session token stored”.

Verify Redis:

```bash
redis-cli GET atlas:broker:flattrade:token
```

## 7. Start Atlas in serve mode

### Docker

```bash
docker compose -f deployments/docker-compose.vm.yml up -d
```

### systemd

```bash
sudo systemctl enable --now atlas.service
sudo systemctl status atlas
```

Health check:

```bash
curl -s http://localhost:8080/healthz
# {"status":"ok","redis":"ok","mode":"PAPER","has_session_token":true}
```

## 8. Daily token refresh

### systemd timer (bare metal)

Installed by `deploy-vm.sh`:

```bash
sudo systemctl enable --now atlas-token.timer
sudo systemctl list-timers atlas-token.timer
```

Runs `scripts/daily-session-token.sh` at **08:15 IST** on trading days.

### Makefile / manual

```bash
make token-job
```

### In-process scheduler (Docker / default config)

With `session_token_job.enabled: true`, `-serve` schedules the same job at 08:15 IST. Use **either** the timer **or** the in-process job, not both.

## 9. Firewall summary

| Port | Exposure | Purpose |
|------|----------|---------|
| 8080 | Public (restricted if possible) | OAuth callback, `/healthz` |
| 6379 | **localhost / Docker network only** | Redis — never public |

```bash
# ufw example
sudo ufw allow 8080/tcp
sudo ufw enable
```

## 10. Switching to LIVE mode

**Caution:** LIVE sends real orders to the broker.

1. Ensure paper trading is stable for several sessions.
2. Edit `configs/atlas.paper.yaml` (or copy to `atlas.live.yaml`):
   ```yaml
   execution:
     mode: LIVE
   ```
3. Re-run `-listen-auth` if jKey is missing.
4. Restart Atlas.
5. Monitor logs and Flattrade order book closely.

There is no separate `live_orders` flag yet — `execution.mode: LIVE` is the switch. Treat any future order-enable flags with the same caution.

## Operations

| Task | Command |
|------|---------|
| Logs (systemd) | `journalctl -u atlas -f` |
| Logs (Docker) | `docker compose -f deployments/docker-compose.vm.yml logs -f atlas` |
| Restart | `sudo systemctl restart atlas` |
| Update binary | re-run `deploy-vm.sh` or rebuild image |

## Troubleshooting

- **`has_session_token: false`** — run `-listen-auth` or `make token-job`.
- **`redis: fail`** — check Redis is running and `REDIS_ADDR` is correct.
- **OAuth callback fails** — confirm Flattrade redirect URL matches `http://<IP>:8080/callback` and port 8080 is open.
- **Port in use** — stop `-serve` before `-listen-auth` (both use 8080).
