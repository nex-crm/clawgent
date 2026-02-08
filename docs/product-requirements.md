# Clawgent Product Requirements: Localhost to Online Platform

> Last updated: 2026-02-08
> Status: PRD v1 -- ready for review
> Author: Product Agent

---

## 0. Context and Starting Point

Clawgent today is a localhost-only Next.js app. Users visit `localhost:3001`, click "Deploy New Instance," and the backend spins up a Docker container running an OpenClaw gateway on a unique port (19000+). Each instance gets a raw URL like `http://127.0.0.1:19000/?token=abc`. There is no auth, no persistence, no cloud deployment, and instances are tracked in an in-memory Map that resets on hot reload.

The goal: **anyone can deploy OpenClaw on the web and access their instance from a unique link online.**

This PRD defines what it takes to get from the current localhost Docker prototype to a publicly accessible platform with unique instance URLs.

---

## 1. User Journey

### 1.1 First-Time User (No Account)

```
1. Lands on clawgent.com
2. Sees hero: "Deploy OpenClaw under 1 minute"
3. Clicks "Deploy Now" (no auth required for MVP)
4. System provisions a container on our cloud infrastructure
5. Progress bar shows deployment stages (15-45 seconds)
6. Gets a unique link: https://i-abc123.clawgent.com
7. Clicks link --> lands on their OpenClaw dashboard
8. Receives a "bookmark this link" prompt + option to save access token
9. Starts using OpenClaw immediately
```

**Key decision: No auth for MVP.** The value prop is "one click to a running instance." Adding Google OAuth before the deploy button adds friction that kills the magic. Instead, we use the instance URL + access token as the authentication mechanism. Whoever has the link can access the instance.

This is the same model as Replit, Glitch, and early Heroku: anonymous deploys with shareable links. Auth comes in V2 when users need to manage multiple instances, billing, or team access.

### 1.2 Returning User

```
1. Opens their bookmarked link: https://i-abc123.clawgent.com
2. If instance is running: lands directly on dashboard
3. If instance expired: sees "Instance expired" page with option to deploy a new one
4. If instance was destroyed: sees 404
```

### 1.3 Power User (V2, with auth)

```
1. Signs in with Google
2. Sees dashboard with all their instances
3. Can deploy new, pause/resume, destroy existing
4. Manages API keys and channel connections per instance
5. Views usage metrics and estimated costs
```

---

## 2. Instance Lifecycle

### 2.1 Lifecycle States

```
deploy_requested --> provisioning --> running --> expired/destroyed
                                        |
                                        +--> paused (V2)
                                        |
                                        +--> error
```

### 2.2 Ephemeral by Default (MVP)

**Decision: Instances auto-expire after 2 hours for anonymous deploys.**

Rationale:
- We cannot sustain unlimited free instances on cloud infrastructure.
- 2 hours is enough time to try OpenClaw, decide if it is useful, and deploy a "real" instance later.
- This is the same model as CodeSandbox, StackBlitz, and Gitpod free tier.
- It prevents resource abuse without requiring auth or payment.

**Lifecycle rules (MVP):**
- Max concurrent anonymous instances per IP: 3 (prevents abuse)
- Auto-expiry: 2 hours from deploy
- Warning at 90 minutes: "Your instance expires in 30 minutes"
- Grace period: 15 minutes after expiry before container destruction
- No pause/resume in MVP

**Lifecycle rules (V2, with auth):**
- Authenticated users: instances persist until explicitly destroyed or billing lapses
- Pause/resume: stops the container, releases compute, retains data volume
- Billing: hourly while running, storage-only while paused

### 2.3 What Happens to Data

- **MVP**: Instance data lives in a Docker volume. When the instance expires, both container and volume are destroyed. Users are warned upfront: "This is a temporary instance. Data will be deleted after 2 hours."
- **V2**: Persistent volumes backed up to object storage. Users can export their OpenClaw config and conversation history before destroying.

---

## 3. Unique Links

### 3.1 URL Structure

**Decision: `https://{instance-id}.clawgent.com`**

Format: `https://i-{nanoid8}.clawgent.com`

Examples:
- `https://i-k7x2m9p4.clawgent.com`
- `https://i-w3bq8n1r.clawgent.com`

### 3.2 Why This Structure

| Option | Example | Verdict |
|--------|---------|---------|
| Path-based: `clawgent.com/i/abc123` | Simple, no DNS setup | Rejected: requires reverse proxy path rewriting, breaks OpenClaw's assumption it runs at root `/` |
| Subdomain: `abc123.clawgent.com` | Clean, each instance is isolated | **Selected**: works with wildcard DNS + reverse proxy, OpenClaw runs at root naturally |
| Custom domain: `my-agent.clawgent.com` | Memorable | V2 feature: requires DNS verification, adds complexity |
| Random UUID: `a7f3b2c1-...clawgent.com` | Secure, unguessable | Rejected: too long, not bookmarkable, hostile UX |

### 3.3 Instance ID Design

Use **NanoID** with 8 characters, lowercase alphanumeric only (`a-z0-9`). This gives:

- 36^8 = ~2.8 trillion possible IDs
- Collision probability: negligible for our scale
- Short enough to remember, type, and share
- Prefix `i-` distinguishes instance subdomains from other subdomains (e.g., `api.clawgent.com`, `www.clawgent.com`)

### 3.4 Security

Instance URLs are **not secret**. They are guessable in theory (8-char alphanumeric) but infeasible to enumerate at scale. However, the OpenClaw dashboard behind each URL is protected by a **gateway token**.

Access model:
- The URL resolves to the instance's reverse proxy
- The reverse proxy injects the gateway auth token automatically (stored server-side, not in the URL)
- No `?token=` in the URL -- this is a security improvement over the current localhost approach where tokens are exposed in URLs
- The reverse proxy terminates TLS and forwards to the container's port 18789

This means: knowing the URL lets you reach the instance. The reverse proxy authenticates on behalf of the user. If you want to restrict access further (V2), add password protection or require login.

---

## 4. Multi-User Isolation

### 4.1 Infrastructure Isolation (MVP)

Each instance runs in its own Docker container with:
- Isolated network namespace
- Own port mapping (not exposed to host network, only via reverse proxy)
- Own data volume
- Own gateway auth token
- CPU and memory limits (`--memory=2g --cpus=1`)

Containers cannot communicate with each other. The reverse proxy is the only ingress path.

### 4.2 Network Isolation

```
Internet
   |
   v
Nginx/Caddy (reverse proxy, wildcard TLS)
   |
   +--> Container A (i-k7x2m9p4) on port 19000
   +--> Container B (i-w3bq8n1r) on port 19001
   +--> Container C (i-j5t6y2d8) on port 19002
```

- Containers are on a Docker bridge network with `--internal` flag (no outbound internet except through proxy)
- Wait -- OpenClaw needs outbound internet to reach AI model APIs (Anthropic, OpenAI, Google). So containers need outbound access but should NOT be able to reach each other.
- Solution: each container on its own Docker network, with outbound NAT but no inter-container routing.

### 4.3 Auth Model

**MVP (no login):**
- Instance access is controlled by knowing the subdomain URL
- The reverse proxy handles gateway token injection -- users never see or manage tokens
- Rate limiting per IP: 3 active instances, 10 deploys per hour

**V2 (with login):**
- Google OAuth via NextAuth.js
- Each instance is owned by a user account
- Dashboard lists user's instances
- Instance URLs become private by default (require login to access)
- Share links generate time-limited access tokens

---

## 5. Technical Architecture: From Localhost to Online

### 5.1 Infrastructure Requirements

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Compute | Single VPS (4-8 vCPU, 16-32 GB RAM) | Runs multiple Docker containers |
| Reverse proxy | Caddy | Wildcard TLS, subdomain routing, auto-HTTPS |
| DNS | Cloudflare | Wildcard DNS `*.clawgent.com` |
| Domain | `clawgent.com` (or similar) | Base domain |
| Container registry | Docker Hub or GitHub Packages | `clawgent-openclaw` image |
| State persistence | PostgreSQL (or SQLite for single-node) | Instance registry, not in-memory |
| Web app | Next.js on same VPS or Vercel | Landing page + API |

### 5.2 Why Single VPS, Not Cloud VMs per Instance

The current spec discusses provisioning a separate DigitalOcean droplet per instance ($12/month each). This is the wrong architecture for the MVP:

**Problem with VM-per-instance:**
- 45-90 second provisioning time (VM boot + OS init + Node install + OpenClaw install)
- $12/month minimum per user -- unsustainable for free/trial instances
- Each VM needs individual security patching
- Scaling means linear VM management complexity

**Single VPS with Docker containers:**
- 5-15 second provisioning time (container from pre-built image)
- One VPS ($48-96/month) supports 10-20 concurrent instances
- One machine to patch and monitor
- Simpler networking (all containers on same host)
- Scales vertically until you need a second node

**When to graduate to multi-node:** When you consistently have 15+ concurrent instances on a single VPS. At that point, add a second VPS and implement a scheduler (or use Docker Swarm / Kubernetes). This is a V2 concern.

### 5.3 Reverse Proxy Configuration (Caddy)

Caddy handles wildcard TLS automatically via Let's Encrypt / ZeroSSL.

```
*.clawgent.com {
    # Extract instance ID from subdomain
    @instance header_regexp Host ^i-([a-z0-9]+)\.clawgent\.com$

    # Look up container port from instance registry API
    reverse_proxy @instance {
        dynamic a]  # Resolved at request time via internal API
    }
}

clawgent.com {
    reverse_proxy localhost:3001  # Next.js app
}
```

The reverse proxy needs a way to resolve `i-{id}` to a container port. Options:
1. **Internal API call**: Caddy calls `localhost:3001/api/internal/resolve?id={id}` to get the port. Simple, but adds latency per request.
2. **Config file reload**: API writes an Nginx/Caddy config snippet when instances are created/destroyed, then signals a reload. More complex but zero per-request overhead.
3. **Dynamic upstream module**: Caddy has `caddy-dynamic-upstreams` that can query a backend. Best of both worlds.

**Decision: Option 1 for MVP** (internal API resolve). It adds ~5ms per request, which is negligible. Switch to config reload if this becomes a bottleneck.

### 5.4 Deployment Flow (Updated)

```
1. User clicks "Deploy Now" on clawgent.com
2. POST /api/deploy
3. Backend:
   a. Generate instance ID (nanoid, 8 chars)
   b. Assign next available port (19000+)
   c. Generate gateway auth token
   d. docker run -d --name clawgent-{id} \
        -p {port}:18789 \
        -e OPENCLAW_GATEWAY_TOKEN={token} \
        -v clawgent-data-{id}:/home/node/.openclaw \
        --memory=2g --cpus=1 \
        clawgent-openclaw \
        openclaw gateway --port 18789 --verbose --allow-unconfigured --bind lan
   e. Store instance record in PostgreSQL:
      { id, port, token, status, created_at, expires_at, client_ip }
   f. Return { id, url: "https://i-{id}.clawgent.com", status: "provisioning" }
4. Frontend polls GET /api/instances/{id} every 2 seconds
5. Backend health-checks http://localhost:{port}/ until HTTP 200
6. When healthy: update status to "running", return URL to frontend
7. Frontend shows "Your instance is live" with link
```

### 5.5 Database Schema (MVP)

Replace the in-memory Map with PostgreSQL (or SQLite on single node):

```sql
CREATE TABLE instances (
  id            TEXT PRIMARY KEY,           -- nanoid, e.g. "k7x2m9p4"
  container_name TEXT NOT NULL UNIQUE,       -- "clawgent-k7x2m9p4"
  port          INTEGER NOT NULL,
  token         TEXT NOT NULL,               -- gateway auth token
  status        TEXT NOT NULL DEFAULT 'starting',
  url           TEXT NOT NULL,               -- "https://i-k7x2m9p4.clawgent.com"
  client_ip     TEXT,                        -- deployer's IP (for rate limiting)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL,        -- created_at + 2 hours
  destroyed_at  TIMESTAMPTZ,
  error_message TEXT
);

CREATE INDEX idx_instances_status ON instances(status);
CREATE INDEX idx_instances_client_ip ON instances(client_ip);
CREATE INDEX idx_instances_expires_at ON instances(expires_at);
```

### 5.6 Instance Cleanup

A cron job (or `setInterval` in the Next.js process) runs every 60 seconds:

```
1. SELECT id, container_name FROM instances
   WHERE status = 'running' AND expires_at < NOW()
2. For each expired instance:
   a. docker stop {container_name}
   b. docker rm {container_name}
   c. docker volume rm clawgent-data-{id}
   d. UPDATE instances SET status = 'expired', destroyed_at = NOW()
```

---

## 6. Key Metrics

### 6.1 North Star Metric

**Instances that receive at least one user interaction within 10 minutes of deploy.** This measures whether people actually use the thing they deployed, not just whether they clicked a button.

### 6.2 Activation Funnel

| Step | Metric | Target |
|------|--------|--------|
| Land on site | Unique visitors | Track |
| Click "Deploy Now" | Deploy click rate | > 30% of visitors |
| Instance becomes running | Deploy success rate | > 95% |
| User visits instance URL | Dashboard visit rate | > 80% of successful deploys |
| User interacts with OpenClaw | Activation rate | > 50% of dashboard visits |

### 6.3 Performance Metrics

| Metric | Target | Rationale |
|--------|--------|-----------|
| Time to deploy (click to running) | < 30 seconds | Docker containers start faster than VMs |
| Time to first dashboard load | < 3 seconds after running | Reverse proxy + TLS handshake |
| Instance uptime (while active) | > 99% | Docker restart policy handles crashes |
| Concurrent instances supported | 15-20 per VPS | Based on 2GB RAM per container on 32GB host |

### 6.4 Business Metrics (V2)

| Metric | Target |
|--------|--------|
| Free-to-paid conversion | > 5% |
| Monthly recurring revenue | Track |
| Churn rate | < 10% monthly |
| Customer acquisition cost | < $15 |

---

## 7. MVP vs V2 Scope

### 7.1 MVP: "Works Online with Unique Links"

The absolute minimum to go from "works on my machine" to "works online with unique links":

| Feature | Details |
|---------|---------|
| Public landing page | Hosted on VPS or Vercel, accessible at `clawgent.com` |
| One-click deploy | No auth required, click button, get instance |
| Docker container provisioning | Same `clawgent-openclaw` image, same command |
| Unique subdomain per instance | `i-{nanoid}.clawgent.com` with wildcard DNS + TLS |
| Reverse proxy with auto-TLS | Caddy with wildcard cert, routes subdomains to container ports |
| Gateway token injection | Proxy injects auth token, user never sees raw token |
| Instance status polling | Frontend polls until running, shows link |
| Auto-expiry (2 hours) | Cron destroys expired containers |
| Rate limiting | 3 active instances per IP, 10 deploys per hour |
| Persistent instance registry | PostgreSQL or SQLite, not in-memory |
| Basic monitoring | Health checks, auto-restart on crash |

**What MVP does NOT include:**
- No user accounts or login
- No persistent instances (all expire after 2 hours)
- No API key management (instances run with `--allow-unconfigured`)
- No channel integration (Telegram, Discord)
- No model selection
- No billing/payment
- No custom domains
- No pause/resume
- No usage metrics dashboard

### 7.2 V2: "A Real Product"

| Feature | Priority | Notes |
|---------|----------|-------|
| Google OAuth login | High | Users need accounts to manage persistent instances |
| Persistent instances | High | Pay to keep instances running beyond 2 hours |
| API key configuration | High | Let users provide Anthropic/OpenAI/Google keys |
| Channel integration | High | Telegram and Discord bot token input |
| Model selection | Medium | Choose Claude/GPT/Gemini at deploy time |
| Instance dashboard | Medium | Status, logs, restart, destroy from web UI |
| Billing (Stripe) | Medium | Hourly or monthly pricing |
| Pause/resume | Medium | Stop paying while not using |
| Custom subdomains | Low | `my-agent.clawgent.com` |
| Multi-node scaling | Low | Docker Swarm or K8s when single VPS is not enough |
| Team sharing | Low | Multiple users accessing one instance |
| Data export | Low | Export OpenClaw config and conversations |
| Usage metrics | Low | CPU, RAM, API call estimates |

---

## 8. Competitive Positioning

### 8.1 Value Prop (One Sentence)

**"Get a running OpenClaw instance with a shareable link in 30 seconds -- no server, no SSH, no configuration."**

### 8.2 Why Not Just `npm i -g openclaw`?

| Factor | `npm i -g openclaw` | Clawgent |
|--------|---------------------|------------|
| Time to running | 30-60 min (technical user) | 30 seconds |
| Technical skill required | Node.js, CLI, networking | Click a button |
| Accessible from anywhere | Only from your machine | Any browser, any device |
| Shareable | Not without port forwarding + dynamic DNS | Share the link |
| Always on | Only while your machine is on | Runs on cloud 24/7 (V2) |
| Security config | Manual hardening needed | Pre-hardened by us |
| Cost | Free (your hardware + electricity) | Free trial, paid for persistent |

### 8.3 Why Not DigitalOcean 1-Click or Cloudflare MoltWorker?

DigitalOcean requires: create account, add payment method, choose droplet size, wait for provisioning, SSH in for initial setup, configure firewall. Minimum 10 minutes, assumes comfort with cloud infrastructure concepts.

Cloudflare MoltWorker requires: Cloudflare account, Workers subscription, Wrangler CLI knowledge, R2 bucket setup, environment variable configuration. Developer-only.

Clawgent requires: click a button. That is the entire product.

**We trade power and control for speed and simplicity.** Power users should use DO or Cloudflare. People who want to try OpenClaw in 30 seconds should use Clawgent.

---

## 9. Risks and Mitigations

### 9.1 Security

**Risk**: OpenClaw has known vulnerabilities (CVE-2026-25253) and default-insecure configuration.

**Mitigation**:
- Containers run with `--allow-unconfigured` (no user API keys in MVP = no keys to steal)
- Gateway bound to `127.0.0.1` inside container, only accessible via reverse proxy
- Reverse proxy handles TLS termination
- Containers are isolated: own network, memory limits, no inter-container access
- 2-hour auto-expiry limits blast radius
- No sensitive user data stored in MVP (no API keys, no auth tokens, no conversation history worth stealing)

### 9.2 Abuse

**Risk**: People deploy instances for crypto mining, spam, or other abuse.

**Mitigation**:
- `--cpus=1 --memory=2g` resource limits
- 2-hour auto-expiry
- 3 instances per IP limit
- Outbound network monitoring (V2)
- Abuse reporting mechanism (V2)

### 9.3 Cost

**Risk**: Free instances consume infrastructure without revenue.

**Mitigation**:
- Single VPS ($48-96/month) supports ~15-20 concurrent instances
- 2-hour expiry means high turnover, not accumulation
- At 15 concurrent instances average, cost per instance-hour: ~$0.004
- V2 introduces paid persistent instances to cover costs

### 9.4 OpenClaw Upstream Changes

**Risk**: OpenClaw ships breaking changes, renames again, or changes licensing.

**Mitigation**:
- Pin to a specific OpenClaw version in the Docker image
- Test new versions before updating the image
- Maintain our own fork if upstream becomes unreliable (MIT license allows this)

---

## 10. Implementation Sequence

### Phase 1: Infrastructure (1-2 days)

1. Provision a VPS (DigitalOcean, Hetzner, or similar)
2. Set up wildcard DNS for `*.clawgent.com` on Cloudflare
3. Install Caddy with wildcard TLS
4. Install Docker on the VPS
5. Pull `clawgent-openclaw` image
6. Set up PostgreSQL (or SQLite)
7. Test: manually create a container, verify subdomain routing works

### Phase 2: API Changes (1-2 days)

1. Replace in-memory Map with database
2. Update deploy API to generate nanoid-based instance IDs
3. Add instance URL generation (`https://i-{id}.clawgent.com`)
4. Add reverse proxy resolution endpoint (internal API for Caddy)
5. Add auto-expiry cron job
6. Add rate limiting (per-IP)
7. Update health check to work via reverse proxy URL instead of localhost port

### Phase 3: Frontend Changes (1 day)

1. Update deploy flow to show subdomain URL instead of raw port URL
2. Add expiry countdown/warning
3. Add "Copy Link" button
4. Remove localhost-specific references
5. Deploy Next.js app to Vercel (or serve from VPS)

### Phase 4: Testing and Hardening (1-2 days)

1. End-to-end test: deploy from browser, verify subdomain works, verify expiry
2. Load test: deploy 10-15 concurrent instances, verify stability
3. Security audit: verify container isolation, test for port scanning, check TLS
4. Monitor resource usage under load

**Total estimated timeline: 4-7 days for MVP.**

---

## 11. Open Decisions

| Decision | Options | Recommendation | Status |
|----------|---------|----------------|--------|
| VPS provider | DigitalOcean, Hetzner, AWS Lightsail | Hetzner (cheapest for specs needed) | Needs approval |
| Database | PostgreSQL, SQLite | SQLite for single-node MVP, migrate to PG later | Needs approval |
| Reverse proxy | Caddy, Nginx, Traefik | Caddy (simplest wildcard TLS) | Recommended |
| Domain | clawgent.com, clawgent-ai.com, other | Needs owner decision | Needs approval |
| Next.js hosting | Same VPS, Vercel | Vercel for reliability + CDN, API proxied to VPS | Needs approval |
| Auto-expiry duration | 1 hour, 2 hours, 4 hours | 2 hours (balance trial time vs cost) | Needs approval |
| Container image | `clawgent-openclaw`, custom Dockerfile | Current image if it works, custom if we need hardening | Needs investigation |

---

## Appendix: Rejected Alternatives

### A. Serverless Containers (AWS Fargate, Cloud Run)

Rejected because: cold start times of 10-30 seconds for each request to an idle instance. OpenClaw needs a persistent WebSocket connection, which is incompatible with request-based serverless pricing. Also significantly more complex to set up than Docker on a VPS.

### B. Kubernetes

Rejected for MVP because: massive operational overhead for managing 10-20 containers. K8s is the right answer at 100+ instances, not at 15. A single VPS with Docker and a cron job is the right level of complexity for this stage.

### C. Tunneling (Cloudflare Tunnel, ngrok)

Rejected because: adds a dependency and potential point of failure. Each instance would need its own tunnel. Cloudflare Tunnel is free but has rate limits. Direct reverse proxy on the VPS is simpler and faster.

### D. Path-Based Routing Instead of Subdomains

Rejected because: OpenClaw's web UI assumes it runs at the root path `/`. Path-based routing (`clawgent.com/i/abc123/`) would require rewriting all asset paths and WebSocket URLs inside OpenClaw's frontend. Subdomains avoid this entirely -- each instance thinks it owns the whole domain.
