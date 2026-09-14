#!/usr/bin/env bash
# Install Atlas on a Linux VM (Oracle Cloud, Hetzner, etc.).
# Usage: sudo INSTALL_DIR=/opt/atlas ./scripts/deploy-vm.sh [--docker]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL_DIR="${INSTALL_DIR:-/opt/atlas}"
USE_DOCKER=false

for arg in "$@"; do
  case "$arg" in
    --docker) USE_DOCKER=true ;;
    -h|--help)
      echo "Usage: sudo INSTALL_DIR=/opt/atlas $0 [--docker]"
      exit 0
      ;;
    *)
      echo "unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

if [[ "$(id -u)" -ne 0 ]]; then
  echo "run as root (sudo) so user/units can be installed" >&2
  exit 1
fi

echo "==> Installing Atlas to ${INSTALL_DIR}"

if ! id atlas &>/dev/null; then
  echo "==> Creating system user 'atlas'"
  useradd --system --home-dir "${INSTALL_DIR}" --shell /usr/sbin/nologin atlas
fi

mkdir -p "${INSTALL_DIR}/bin" "${INSTALL_DIR}/configs" "${INSTALL_DIR}/scripts"

if [[ "$USE_DOCKER" == true ]]; then
  echo "==> Docker mode: build image from ${ROOT}"
  if ! command -v docker &>/dev/null; then
    echo "docker not found; install Docker first" >&2
    exit 1
  fi
  docker compose -f "${ROOT}/deployments/docker-compose.vm.yml" build
  echo "Docker image built. Start with: docker compose -f deployments/docker-compose.vm.yml up -d"
else
  echo "==> Building atlas binary"
  make -C "${ROOT}" build
  install -m 0755 "${ROOT}/bin/atlas" "${INSTALL_DIR}/bin/atlas"
fi

echo "==> Copying configs and scripts"
cp -a "${ROOT}/configs/." "${INSTALL_DIR}/configs/"
cp -a "${ROOT}/scripts/." "${INSTALL_DIR}/scripts/"
chmod +x "${INSTALL_DIR}/scripts/"*.sh 2>/dev/null || true

if [[ ! -f "${INSTALL_DIR}/.env" ]]; then
  cp "${ROOT}/.env.example" "${INSTALL_DIR}/.env.example"
  echo "==> Wrote ${INSTALL_DIR}/.env.example (copy to .env and fill secrets)"
else
  cp "${ROOT}/.env.example" "${INSTALL_DIR}/.env.example"
fi

chown -R atlas:atlas "${INSTALL_DIR}"

if [[ "$USE_DOCKER" != true ]]; then
  echo "==> Installing systemd units"
  install -m 0644 "${ROOT}/deployments/atlas.service" /etc/systemd/system/atlas.service
  install -m 0644 "${ROOT}/deployments/atlas-token.service" /etc/systemd/system/atlas-token.service
  install -m 0644 "${ROOT}/deployments/atlas-token.timer" /etc/systemd/system/atlas-token.timer
  systemctl daemon-reload
fi

cat <<EOF

Atlas installed to ${INSTALL_DIR}

Next steps:
  1. Copy and edit secrets:
       cp ${INSTALL_DIR}/.env.example ${INSTALL_DIR}/.env
       # set FLATTRADE_API_KEY, FLATTRADE_API_SECRET, FLATTRADE_CLIENT_ID, REDIS_ADDR

  2. Open firewall for OAuth + health only (port 8080). Do NOT expose Redis (6379) publicly.

  3. Register this VM's reserved public IP in Flattrade Wall (static IP whitelist).

  4. Set Flattrade redirect URL to:
       http://<VM_PUBLIC_IP>:8080/callback

  5. Start Redis locally or via Docker (redis://localhost:6379).

  6. First-time session token (before -serve):
       sudo -u atlas ${INSTALL_DIR}/bin/atlas -config ${INSTALL_DIR}/configs/atlas.paper.yaml -listen-auth

  7. Enable daily token refresh timer (bare metal):
       sudo systemctl enable --now atlas-token.timer

  8. Start Atlas:
       sudo systemctl enable --now atlas.service
     Or Docker: docker compose -f deployments/docker-compose.vm.yml up -d

  9. Verify health:
       curl -s http://localhost:8080/healthz

See docs/vm-deploy.md for full walkthrough.

EOF
