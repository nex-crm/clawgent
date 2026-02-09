# AWS Deployment — clawgent.ai

## Architecture Decision: EC2

**Recommended: Single EC2 instance** with Docker, Nginx, and Let's Encrypt.

### Why EC2, not ECS/Fargate or Lightsail

| Option | Verdict | Reason |
|--------|---------|--------|
| **EC2** | **Winner** | Full Docker access, raw TCP WebSocket proxy, SQLite on local disk, simple to reason about |
| ECS/Fargate | Rejected | Docker-in-Docker is complex/unsupported on Fargate. The app spawns sibling Docker containers -- it needs access to the host Docker daemon |
| Lightsail | Possible but limiting | Fewer instance types, less networking flexibility, harder to scale later |

The app has a hard requirement: it spawns Docker containers on the host. This rules out any serverless or containerized platform where you don't control the Docker daemon.

---

## Architecture Diagram

```
                    Internet
                       |
                       v
              +-------------------+
              |   Route 53        |
              |  clawgent.ai      |
              |  A -> EC2 EIP     |
              +--------+----------+
                       |
                       v
              +-------------------+
              |   EC2 Instance    |
              |  t4g.micro        |
              |  Ubuntu 24.04 ARM |
              |                   |
              |  +-----------+    |
              |  |   Nginx   |    |  :443 (SSL) -> :3001
              |  |  SSL/TLS  |    |
              |  +-----+-----+    |
              |        |          |
              |  +-----v-----+    |
              |  |  Node.js  |    |  :3001 (custom server.ts)
              |  |  Clawgent |    |  Raw TCP WebSocket proxy
              |  |   + PM2   |    |  for /i/{id}/ paths
              |  +-----+-----+    |
              |        |          |
              |  +-----v-----+    |
              |  |  Docker   |    |  OpenClaw containers
              |  | Containers|    |  :19000-19099 (host ports)
              |  | (OpenClaw)|    |
              |  +-----------+    |
              |                   |
              |  /opt/clawgent/   |
              |  +-- app/         |  Next.js app + server.ts
              |  +-- data/        |  SQLite DB (clawgent.db)
              |  +-- logs/        |  PM2 log files
              +-------------------+
```

---

## Instance Sizing

| Component | Requirement |
|-----------|-------------|
| **vCPUs** | 2+ (Node.js + Docker containers) |
| **RAM** | 1 GB minimum (each OpenClaw container uses ~200-400 MB) |
| **Storage** | 8 GB gp3 EBS (Docker images + SQLite + logs) |
| **Instance type** | `t4g.micro` (2 vCPU, 1 GB, ARM64) for MVP. Scale to `t4g.small` (2 GB) or `t4g.medium` (4 GB) if needed |

For ~5 concurrent users with OpenClaw instances: t4g.micro is sufficient.
For ~10+ concurrent users: upgrade to t4g.small or t4g.medium.

---

## Step-by-Step Setup

### 1. Launch EC2 Instance

1. Go to AWS Console -> EC2 -> Launch Instance
2. Settings:
   - **AMI**: Ubuntu 24.04 LTS (ARM64/Graviton)
   - **Instance type**: t4g.micro
   - **Key pair**: clawgent-key (ed25519) — create if doesn't exist
   - **Security Group**: clawgent-sg (sg-0fe19ff0a2104c307) with these inbound rules:
     - SSH (22) -- your IP only
     - HTTP (80) -- 0.0.0.0/0 (for Let's Encrypt + redirect)
     - HTTPS (443) -- 0.0.0.0/0
   - **Storage**: 8 GB gp3
3. Launch and note the public IP

**Note on ports**: The OpenClaw containers use host ports 19000-19099, but these only need to be accessible from localhost (the Node.js server proxies all traffic). Do NOT open these ports in the security group.

### 2. Allocate Elastic IP

1. EC2 -> Elastic IPs -> Allocate
2. Associate with your instance
3. Note the Elastic IP (this won't change on restart)

**Cost note**: As of Feb 2024, AWS charges $3.65/month for Elastic IPs, even when attached to a running instance.

### 3. Configure DNS

1. Go to your domain registrar (or Route 53 if domain is there)
2. Create/update DNS records:
   - `clawgent.ai` -> A record -> Elastic IP
   - `www.clawgent.ai` -> A record -> Elastic IP (or CNAME -> clawgent.ai)
3. Wait for DNS propagation (usually 5-30 minutes)

### 4. Run Server Setup

```bash
# SSH into the instance
ssh -i your-key.pem ubuntu@<elastic-ip>

# Option A: Copy setup.sh from your local machine first
# (from local machine)
scp deploy/setup.sh ubuntu@<elastic-ip>:~/setup.sh

# Option B: Clone the repo on the server
git clone <repo-url> /tmp/clawgent-setup

# Run the setup script (installs Docker, Node 22, Nginx, Certbot, PM2, build tools)
sudo bash setup.sh
# Log out and back in after this for Docker group membership to take effect
```

This installs: Docker, Node.js 22, Nginx, Certbot, PM2, tsx, build-essential (for better-sqlite3 native addon).

### 5. Configure Nginx

```bash
# On the server
sudo cp /opt/clawgent/nginx.conf /etc/nginx/sites-available/clawgent
# Or copy from the repo:
# sudo cp /tmp/clawgent-setup/deploy/nginx.conf /etc/nginx/sites-available/clawgent

sudo ln -sf /etc/nginx/sites-available/clawgent /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t  # Verify config -- will warn about missing SSL certs, that's expected
```

### 6. Get SSL Certificate

```bash
# Make sure DNS is pointing to this server first!
# Use certbot with nginx plugin (simpler than standalone):
sudo certbot --nginx -d clawgent.ai -d www.clawgent.ai

# Certbot will automatically configure Nginx and set up auto-renewal.
# Verify auto-renewal:
sudo certbot renew --dry-run
```

### 7. Build the OpenClaw Docker Image

The app spawns Docker containers from a `clawgent-openclaw` image. This needs to be built on the server:

```bash
# On the server -- pull or build the OpenClaw image
# Option A: If there's a public OpenClaw image
docker pull <openclaw-image> && docker tag <openclaw-image> clawgent-openclaw

# Option B: Build from OpenClaw source (more common for customization)
# Clone OpenClaw repo, build the image, tag as clawgent-openclaw
git clone <openclaw-repo-url> /tmp/openclaw
cd /tmp/openclaw
docker build -t clawgent-openclaw .
```

### 8. Deploy the App

From your **local machine**:

```bash
# Create production env file (NEVER commit this)
cp app/.env.example app/.env.production
# Edit with production WorkOS credentials:
#   WORKOS_CLIENT_ID=client_xxx
#   WORKOS_API_KEY=sk_live_xxx
#   WORKOS_COOKIE_PASSWORD=<32+ char random string>
#   NEXT_PUBLIC_WORKOS_REDIRECT_URI=https://clawgent.ai/auth/callback
#   NODE_ENV=production
#   PORT=3001

# Deploy
bash deploy/deploy.sh ubuntu@clawgent.ai
```

The deploy script will:
1. rsync app files to the server (excluding node_modules, .next, data/)
2. Copy the PM2 ecosystem config
3. Copy .env.production as .env.local on the server
4. Run `npm ci` and `npm run build` on the server
5. Restart the app with PM2 using the ecosystem config

### 9. Verify

```bash
# Check app is running
curl -s https://clawgent.ai/api/status | jq

# Check PM2
ssh ubuntu@clawgent.ai "pm2 status"

# Check logs
ssh ubuntu@clawgent.ai "pm2 logs clawgent --lines 50"

# Check Nginx
ssh ubuntu@clawgent.ai "sudo nginx -t"
```

---

## Important: Docker Socket Access

The Clawgent Node.js process spawns Docker containers on the host by calling the `docker` CLI directly. This requires:

1. The `ubuntu` user must be in the `docker` group (setup.sh handles this)
2. The Docker daemon must be running on the host
3. PM2 runs the Node.js process as the `ubuntu` user, which has Docker access

If you containerize the Clawgent app itself (using the Dockerfile), you must mount the host Docker socket:

```bash
docker run -v /var/run/docker.sock:/var/run/docker.sock ...
```

For the recommended PM2 deployment (not containerized), Docker access works automatically since the Node.js process runs as the `ubuntu` user.

---

## Important: SQLite Data Persistence

The SQLite database lives at `/opt/clawgent/app/data/clawgent.db`. This directory:

- Is created by setup.sh and owned by `ubuntu`
- Is excluded from rsync during deploys (`--exclude='data/'`) so it survives redeployments
- Uses WAL mode for concurrent read/write safety
- Should be backed up regularly (see Ongoing Operations below)

If the EC2 instance is terminated, this data is lost. Consider:
- Regular backups to S3 or local machine
- EBS snapshots for disaster recovery

---

## Production Environment Variables

Create `app/.env.production` locally (never commit this):

```bash
# WorkOS AuthKit -- Production
WORKOS_CLIENT_ID=client_XXXXXXXXXXXXX
WORKOS_API_KEY=sk_live_XXXXXXXXXXXXX
WORKOS_COOKIE_PASSWORD=<generate-random-32-char-string>
NEXT_PUBLIC_WORKOS_REDIRECT_URI=https://clawgent.ai/auth/callback

# App
NODE_ENV=production
PORT=3001
```

### WorkOS Dashboard Setup for Production

1. Log into WorkOS Dashboard
2. Switch to **Production** environment
3. Configure Google OAuth connection (same as dev, but production redirect URI)
4. Add redirect URI: `https://clawgent.ai/auth/callback`
5. Copy production Client ID and API Key

---

## Ongoing Operations

### Deploying Updates

```bash
# From local machine
bash deploy/deploy.sh ubuntu@clawgent.ai
```

### Viewing Logs

```bash
# PM2 logs (app stdout/stderr)
ssh ubuntu@clawgent.ai "pm2 logs clawgent"

# Or read log files directly
ssh ubuntu@clawgent.ai "tail -100 /opt/clawgent/logs/out.log"

# Nginx access/error logs
ssh ubuntu@clawgent.ai "sudo tail -100 /var/log/nginx/access.log"
ssh ubuntu@clawgent.ai "sudo tail -100 /var/log/nginx/error.log"
```

### Restarting the App

```bash
ssh ubuntu@clawgent.ai "pm2 restart clawgent"
```

### SSL Certificate Renewal

Certbot auto-renews via systemd timer. Verify it's working:

```bash
ssh ubuntu@clawgent.ai "sudo certbot renew --dry-run"
```

### Backup SQLite Database

```bash
# Download DB from server
scp ubuntu@clawgent.ai:/opt/clawgent/app/data/clawgent.db ./backups/clawgent-$(date +%Y%m%d).db
```

### Docker Cleanup

OpenClaw containers accumulate. Clean up stopped containers periodically:

```bash
ssh ubuntu@clawgent.ai "docker container prune -f"
ssh ubuntu@clawgent.ai "docker image prune -f"
```

### PM2 Log Rotation

Install pm2-logrotate to prevent logs from consuming disk space:

```bash
ssh ubuntu@clawgent.ai "pm2 install pm2-logrotate"
ssh ubuntu@clawgent.ai "pm2 set pm2-logrotate:max_size 50M"
ssh ubuntu@clawgent.ai "pm2 set pm2-logrotate:retain 7"
ssh ubuntu@clawgent.ai "pm2 set pm2-logrotate:compress true"
```

---

## Security Hardening Checklist

- [ ] SSH key-only access (disable password auth in `/etc/ssh/sshd_config`)
- [ ] Security group: SSH restricted to your IP
- [ ] Security group: Only ports 22, 80, 443 open (NOT 19000-19099)
- [ ] Automatic security updates (`unattended-upgrades` -- installed by setup.sh)
- [ ] WorkOS production credentials (not dev/test)
- [ ] HTTPS enforced (HTTP redirects to HTTPS via Nginx)
- [ ] Docker daemon not exposed on network (default: unix socket only)
- [ ] Nginx rate-limits the `/api/deploy` endpoint (2 req/min per IP)
- [ ] Regular SQLite backups
- [ ] PM2 log rotation configured
- [ ] TLS 1.2+ only (configured in nginx.conf)
- [ ] HSTS header enabled (configured in nginx.conf)

---

## Cost Estimate

| Resource | Monthly Cost (us-east-1) |
|----------|--------------------------|
| t4g.micro (on-demand) | ~$6.13 |
| 8 GB gp3 EBS | ~$0.64 |
| Elastic IP (attached) | ~$3.65 |
| Data transfer (10 GB/mo) | ~$0.90 |
| **Total** | **~$11.32/month** |

Save ~40% with a 1-year Reserved Instance (~$3.68/month for compute).

---

## Scaling Notes (Future)

When a single EC2 instance isn't enough:

1. **Vertical**: Upgrade to t4g.small (2 GB) or t4g.medium (4 GB)
2. **Multiple instances**: Use ALB + sticky sessions, move SQLite to RDS/PostgreSQL
3. **Container orchestration**: ECS with Docker socket mounting (requires EC2 launch type, not Fargate)
4. **Separate concerns**: Move OpenClaw containers to dedicated worker instances

For MVP with <5 concurrent users, a single t4g.micro is sufficient. For <10 users, upgrade to t4g.small.
