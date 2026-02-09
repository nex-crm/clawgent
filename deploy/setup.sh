#!/bin/bash
# Clawgent — EC2 Instance Setup Script
# Run this once on a fresh Ubuntu 24.04 LTS EC2 instance
# Usage: sudo bash setup.sh
# Safe to re-run (idempotent)

set -euo pipefail

echo "=== Clawgent EC2 Setup ==="

# 1. System updates
echo "[1/9] Updating system packages..."
apt-get update && apt-get upgrade -y

# 2. Install build tools (needed for better-sqlite3 native addon)
echo "[2/9] Installing build tools..."
apt-get install -y build-essential python3 lsof

# 3. Install Docker
echo "[3/9] Installing Docker..."
if ! command -v docker &>/dev/null; then
  apt-get install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
  echo "  Docker already installed, skipping."
fi

# Allow the deploy user to use Docker without sudo
usermod -aG docker ubuntu

# 4. Install Node.js 22 LTS (ARM64 compatible)
echo "[4/9] Installing Node.js 22 LTS..."
if ! command -v node &>/dev/null || ! node -v | grep -q "v22"; then
  # NodeSource automatically detects ARM64 architecture
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
else
  echo "  Node.js 22 already installed, skipping."
fi

# 5. Install Nginx
echo "[5/9] Installing Nginx..."
apt-get install -y nginx

# 6. Install Certbot for Let's Encrypt SSL
echo "[6/9] Installing Certbot..."
apt-get install -y certbot python3-certbot-nginx

# 7. Install PM2 and tsx globally
echo "[7/9] Installing PM2 and tsx..."
npm install -g pm2 tsx

# 8. Configure PM2 to start on boot
echo "[8/9] Configuring PM2 startup..."
pm2 startup systemd -u ubuntu --hp /home/ubuntu 2>/dev/null || true

# 9. Create app directory structure
echo "[9/9] Creating app directories..."
mkdir -p /opt/clawgent/app
mkdir -p /opt/clawgent/data
mkdir -p /opt/clawgent/logs
chown -R ubuntu:ubuntu /opt/clawgent

# Enable unattended security updates
echo "Enabling unattended-upgrades..."
apt-get install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades 2>/dev/null || true

# Create certbot webroot directory
mkdir -p /var/www/certbot

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "  1. Copy nginx.conf to /etc/nginx/sites-available/clawgent"
echo "  2. ln -sf /etc/nginx/sites-available/clawgent /etc/nginx/sites-enabled/"
echo "  3. rm -f /etc/nginx/sites-enabled/default"
echo "  4. Point DNS A record for clawgent.ai to this instance's Elastic IP"
echo "  5. Run: sudo certbot --nginx -d clawgent.ai -d www.clawgent.ai"
echo "  6. Deploy the app with deploy.sh"
echo ""
echo "Note: Log out and back in for Docker group membership to take effect."
