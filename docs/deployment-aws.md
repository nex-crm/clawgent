# AWS Deployment — clawgent.ai

## Architecture Decision: EC2

**Recommended: Single EC2 instance** with Docker, Nginx, and Let's Encrypt.

### Why EC2, not ECS/Fargate or Lightsail

| Option | Verdict | Reason |
|--------|---------|--------|
| **EC2** | **Winner** | Full Docker access, raw TCP WebSocket proxy, SQLite on local disk, simple to reason about |
| ECS/Fargate | Rejected | Docker-in-Docker is complex/unsupported on Fargate. The app spawns sibling Docker containers — it needs access to the host Docker daemon |
| Lightsail | Possible but limiting | Fewer instance types, less networking flexibility, harder to scale later |

The app has a hard requirement: it spawns Docker containers on the host. This rules out any serverless or containerized platform where you don't control the Docker daemon.

---

## Architecture Diagram

```
                    Internet
                       │
                       ▼
              ┌─────────────────┐
              │   Route 53      │
              │  clawgent.ai    │
              │  A → EC2 EIP    │
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │   EC2 Instance  │
              │  t3.medium      │
              │  Ubuntu 24.04   │
              │                 │
              │  ┌───────────┐  │
              │  │   Nginx   │  │  :443 (SSL) → :3001
              │  │  SSL/TLS  │  │
              │  └─────┬─────┘  │
              │        │        │
              │  ┌─────▼─────┐  │
              │  │  Node.js  │  │  :3001 (custom server.ts)
              │  │  Clawgent │  │
              │  │   + PM2   │  │
              │  └─────┬─────┘  │
              │        │        │
              │  ┌─────▼─────┐  │
              │  │  Docker   │  │  OpenClaw containers
              │  │ Containers│  │  :19000, :19001, ...
              │  │ (OpenClaw)│  │
              │  └───────────┘  │
              │                 │
              │  /opt/clawgent/ │
              │  └─ data/       │  SQLite DB
              │     clawgent.db │
              └─────────────────┘
```

---

## Instance Sizing

| Component | Requirement |
|-----------|-------------|
| **vCPUs** | 2+ (Node.js + Docker containers) |
| **RAM** | 4 GB minimum (each OpenClaw container uses ~200-400 MB) |
| **Storage** | 30 GB gp3 EBS (Docker images + SQLite + logs) |
| **Instance type** | `t3.medium` (2 vCPU, 4 GB) for MVP. Scale to `t3.large` (8 GB) if needed |

For ~10 concurrent users with OpenClaw instances: t3.medium is sufficient.
For ~50+ concurrent users: upgrade to t3.large or m6i.large.

---

## Step-by-Step Setup

### 1. Launch EC2 Instance

1. Go to AWS Console → EC2 → Launch Instance
2. Settings:
   - **AMI**: Ubuntu 24.04 LTS (x86_64)
   - **Instance type**: t3.medium
   - **Key pair**: Create or select an SSH key pair
   - **Security Group**: Create new with these inbound rules:
     - SSH (22) — your IP only
     - HTTP (80) — 0.0.0.0/0 (for Let's Encrypt + redirect)
     - HTTPS (443) — 0.0.0.0/0
   - **Storage**: 30 GB gp3
3. Launch and note the public IP

### 2. Allocate Elastic IP

1. EC2 → Elastic IPs → Allocate
2. Associate with your instance
3. Note the Elastic IP (this won't change on restart)

### 3. Configure DNS

1. Go to your domain registrar (or Route 53 if domain is there)
2. Create/update DNS records:
   - `clawgent.ai` → A record → Elastic IP
   - `www.clawgent.ai` → A record → Elastic IP (or CNAME → clawgent.ai)
3. Wait for DNS propagation (usually 5-30 minutes)

### 4. Run Server Setup

```bash
# SSH into the instance
ssh -i your-key.pem ubuntu@<elastic-ip>

# Download and run setup script
# (or copy deploy/setup.sh to the server first)
sudo bash setup.sh
```

This installs: Docker, Node.js 22, Nginx, Certbot, PM2, tsx.

### 5. Configure Nginx

```bash
# On the server
sudo cp /opt/clawgent/nginx.conf /etc/nginx/sites-available/clawgent
sudo ln -s /etc/nginx/sites-available/clawgent /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t  # Verify config
# Don't start nginx yet — SSL cert first needs DNS to resolve
```

### 6. Get SSL Certificate

```bash
# Make sure DNS is pointing to this server first!
# Temporarily comment out the SSL server block in nginx.conf,
# or use certbot standalone mode:
sudo certbot certonly --standalone -d clawgent.ai -d www.clawgent.ai

# Then restore full nginx.conf and restart
sudo systemctl restart nginx
```

### 7. Build the OpenClaw Docker Image

The app spawns Docker containers from a `clawgent-openclaw` image. This needs to be built on the server:

```bash
# On the server — pull or build the OpenClaw image
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
# Create production env file
cp app/.env.example app/.env.production
# Edit with production WorkOS credentials:
#   WORKOS_CLIENT_ID=client_xxx
#   WORKOS_API_KEY=sk_live_xxx
#   WORKOS_COOKIE_PASSWORD=<32+ char random string>
#   NEXT_PUBLIC_WORKOS_REDIRECT_URI=https://clawgent.ai/auth/callback

# Deploy
bash deploy/deploy.sh ubuntu@clawgent.ai
```

### 9. Verify

```bash
# Check app is running
curl -s https://clawgent.ai/api/status | jq

# Check PM2
ssh ubuntu@clawgent.ai "pm2 status"

# Check logs
ssh ubuntu@clawgent.ai "pm2 logs clawgent --lines 50"
```

---

## Production Environment Variables

Create `app/.env.production` locally (never commit this):

```bash
# WorkOS AuthKit — Production
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
ssh ubuntu@clawgent.ai "pm2 logs clawgent"
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
scp ubuntu@clawgent.ai:/opt/clawgent/data/clawgent.db ./backups/clawgent-$(date +%Y%m%d).db
```

### Docker Cleanup

OpenClaw containers accumulate. Clean up stopped containers periodically:

```bash
ssh ubuntu@clawgent.ai "docker container prune -f"
ssh ubuntu@clawgent.ai "docker image prune -f"
```

---

## Security Hardening Checklist

- [ ] SSH key-only access (disable password auth)
- [ ] Security group: SSH restricted to your IP
- [ ] UFW firewall enabled (allow 22, 80, 443 only)
- [ ] Automatic security updates (`unattended-upgrades`)
- [ ] WorkOS production credentials (not dev/test)
- [ ] HTTPS enforced (HTTP redirects to HTTPS)
- [ ] Docker daemon not exposed on network
- [ ] Regular SQLite backups
- [ ] PM2 log rotation configured

---

## Cost Estimate

| Resource | Monthly Cost (us-east-1) |
|----------|--------------------------|
| t3.medium (on-demand) | ~$30 |
| 30 GB gp3 EBS | ~$2.40 |
| Elastic IP (attached) | $0 (free when attached) |
| Data transfer (10 GB/mo) | ~$0.90 |
| **Total** | **~$34/month** |

Save ~60% with a 1-year Reserved Instance (~$13/month).

---

## Scaling Notes (Future)

When a single EC2 instance isn't enough:

1. **Vertical**: Upgrade to t3.large (8 GB) or m6i.large
2. **Multiple instances**: Use ALB + sticky sessions, move SQLite to RDS/PostgreSQL
3. **Container orchestration**: ECS with Docker socket mounting (requires EC2 launch type, not Fargate)
4. **Separate concerns**: Move OpenClaw containers to dedicated worker instances

For MVP with <50 concurrent users, a single t3.medium is more than sufficient.
