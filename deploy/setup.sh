#!/bin/bash
# Clawgent — EC2 Instance Setup Script
# Run this once on a fresh Ubuntu 24.04 LTS EC2 instance
# Usage: sudo bash setup.sh

set -euo pipefail

echo "=== Clawgent EC2 Setup ==="

# 1. System updates
echo "[1/7] Updating system packages..."
apt-get update && apt-get upgrade -y

# 2. Install Docker
echo "[2/7] Installing Docker..."
apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Allow the deploy user to use Docker without sudo
usermod -aG docker ubuntu

# 3. Install Node.js 22 LTS
echo "[3/7] Installing Node.js 22 LTS..."
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# 4. Install Nginx
echo "[4/7] Installing Nginx..."
apt-get install -y nginx

# 5. Install Certbot for Let's Encrypt SSL
echo "[5/7] Installing Certbot..."
apt-get install -y certbot python3-certbot-nginx

# 6. Install PM2 for process management
echo "[6/7] Installing PM2..."
npm install -g pm2 tsx

# 7. Create app directory structure
echo "[7/7] Creating app directory..."
mkdir -p /opt/clawgent/data
chown -R ubuntu:ubuntu /opt/clawgent

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "  1. Copy nginx.conf to /etc/nginx/sites-available/clawgent"
echo "  2. ln -s /etc/nginx/sites-available/clawgent /etc/nginx/sites-enabled/"
echo "  3. rm /etc/nginx/sites-enabled/default"
echo "  4. Point DNS A record for clawgent.ai to this instance's public IP"
echo "  5. Run: certbot --nginx -d clawgent.ai -d www.clawgent.ai"
echo "  6. Deploy the app with deploy.sh"
