#!/bin/bash
# Clawgent — Deployment Script
# Run from your LOCAL machine to deploy to the EC2 instance
# Usage: bash deploy/deploy.sh [user@host]
# Safe to re-run (idempotent)

set -euo pipefail

HOST="${1:-ubuntu@clawgent.ai}"
APP_DIR="/opt/clawgent"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/clawgent-key.pem}"
SSH_OPTS="-i ${SSH_KEY}"

# Verify SSH key exists
if [ ! -f "${SSH_KEY}" ]; then
  echo "ERROR: SSH key not found at ${SSH_KEY}"
  echo "Set SSH_KEY env var or ensure ~/.ssh/clawgent-key.pem exists."
  exit 1
fi

echo "=== Deploying Clawgent to ${HOST} ==="

# 1. Sync app source to server
echo "[1/6] Syncing files to server..."
rsync -avz --delete \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='.env.local' \
  --exclude='.env.production' \
  --exclude='data/' \
  --exclude='.DS_Store' \
  -e "ssh ${SSH_OPTS}" \
  "${REPO_DIR}/app/" "${HOST}:${APP_DIR}/app/"

# 2. Sync PM2 ecosystem config
echo "[2/6] Syncing PM2 config..."
scp ${SSH_OPTS} "${REPO_DIR}/deploy/ecosystem.config.js" "${HOST}:${APP_DIR}/ecosystem.config.js"

# 3. Copy .env.production to server (must exist locally)
if [ -f "${REPO_DIR}/app/.env.production" ]; then
  echo "[3/6] Copying production env..."
  scp ${SSH_OPTS} "${REPO_DIR}/app/.env.production" "${HOST}:${APP_DIR}/app/.env.local"
else
  echo "[3/6] ERROR: No .env.production found locally."
  echo "       Create app/.env.production with production WorkOS credentials."
  echo "       (Copy app/.env.example and fill in production values.)"
  exit 1
fi

# 4. Install dependencies and build on server
echo "[4/6] Installing dependencies and building..."
ssh ${SSH_OPTS} "${HOST}" "cd ${APP_DIR}/app && npm ci && npm run build"

# 5. Check OpenClaw image exists on server
echo "[5/6] Checking OpenClaw Docker image..."
ssh ${SSH_OPTS} "${HOST}" "docker image inspect clawgent-openclaw >/dev/null 2>&1 && echo 'OpenClaw image found.' || echo 'WARNING: clawgent-openclaw image not found. Build it on the server before deploying instances.'"

# 6. Restart the app with PM2 using ecosystem config
echo "[6/6] Restarting app with PM2..."
ssh ${SSH_OPTS} "${HOST}" "cd ${APP_DIR} && pm2 delete clawgent 2>/dev/null || true && pm2 start ecosystem.config.js && pm2 save"

echo ""
echo "=== Deployment complete ==="
echo "App running at https://clawgent.ai"
echo ""
echo "Useful commands on server:"
echo "  pm2 logs clawgent        # View logs"
echo "  pm2 restart clawgent     # Restart app"
echo "  pm2 monit                # Monitor CPU/memory"
echo "  pm2 status               # Process status"
