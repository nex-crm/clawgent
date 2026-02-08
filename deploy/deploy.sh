#!/bin/bash
# Clawgent — Deployment Script
# Run from your LOCAL machine to deploy to the EC2 instance
# Usage: bash deploy/deploy.sh [user@host]

set -euo pipefail

HOST="${1:-ubuntu@clawgent.ai}"
APP_DIR="/opt/clawgent"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Deploying Clawgent to ${HOST} ==="

# 1. Build locally (or on server — doing it on server for simplicity)
echo "[1/5] Syncing files to server..."
rsync -avz --delete \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='.env.local' \
  --exclude='data/' \
  --exclude='.DS_Store' \
  "${REPO_DIR}/app/" "${HOST}:${APP_DIR}/app/"

# 2. Copy .env.production to server (must exist locally)
if [ -f "${REPO_DIR}/app/.env.production" ]; then
  echo "[2/5] Copying production env..."
  scp "${REPO_DIR}/app/.env.production" "${HOST}:${APP_DIR}/app/.env.local"
else
  echo "[2/5] WARNING: No .env.production found locally. Skipping."
  echo "       Create app/.env.production with production WorkOS credentials."
fi

# 3. Install dependencies and build on server
echo "[3/5] Installing dependencies and building..."
ssh "${HOST}" "cd ${APP_DIR}/app && npm ci && npm run build"

# 4. Pull the OpenClaw Docker image on server
echo "[4/5] Pulling OpenClaw image..."
ssh "${HOST}" "docker pull clawgent-openclaw 2>/dev/null || echo 'OpenClaw image not available on registry — build manually on server'"

# 5. Restart the app with PM2
echo "[5/5] Restarting app with PM2..."
ssh "${HOST}" "cd ${APP_DIR}/app && pm2 delete clawgent 2>/dev/null || true && PORT=3001 NODE_ENV=production pm2 start 'npx tsx server.ts' --name clawgent && pm2 save"

echo ""
echo "=== Deployment complete ==="
echo "App running at https://clawgent.ai"
echo ""
echo "Useful commands on server:"
echo "  pm2 logs clawgent        # View logs"
echo "  pm2 restart clawgent     # Restart app"
echo "  pm2 monit                # Monitor CPU/memory"
