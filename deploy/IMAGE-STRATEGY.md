# OpenClaw Docker Image Strategy

> Research findings and recommendation for keeping the OpenClaw Docker image up to date on Clawgent's EC2 infrastructure.

---

## 1. Current State

- **Image name**: `clawgent-openclaw` (local tag, built on EC2)
- **Dockerfile**: `deploy/Dockerfile.openclaw` — uses `node:22-bookworm-slim`, runs `npm install -g openclaw@latest`
- **Build trigger**: Rebuilt on every CD deploy (push to main) via `.github/workflows/cd.yml`
- **Server**: t4g.micro (ARM64, 1GB RAM + 2GB swap)
- **Image reference in code**: `app/src/app/api/deploy/route.ts:8` — `const OPENCLAW_IMAGE = "clawgent-openclaw"`

## 2. OpenClaw Release Cadence

| Metric | Value |
|--------|-------|
| Latest version | 2026.2.9 (Feb 9, 2026) |
| First release | 2026.1.29 (Jan 30, 2026) |
| Release frequency | **Every 1-2 days** (very active) |
| Total releases | ~21 (including betas/patches) |
| npm package | `openclaw` |
| Source repo | `github.com/openclaw/openclaw` |

## 3. Official Docker Images

**OpenClaw publishes official multi-arch images on GitHub Container Registry (ghcr.io).**

| Registry | Image | ARM64 Support | Status |
|----------|-------|---------------|--------|
| **ghcr.io** | `ghcr.io/openclaw/openclaw` | Yes (multi-arch manifests + `-arm64` tags) | **Official, actively updated** |
| Docker Hub | `alpine/openclaw`, `1panel/openclaw`, etc. | Varies | Community/third-party |

### ghcr.io Tags

- `latest` — multi-arch manifest (auto-selects arm64 on ARM hosts)
- `main` — tracks main branch, multi-arch
- `2026.2.9` — version-pinned, multi-arch
- `2026.2.9-arm64` / `2026.2.9-amd64` — architecture-specific
- `main-arm64` / `main-amd64` — branch + architecture-specific
- 22 tagged releases, 1,660+ untagged (SHA-based)

### Key Details

- **Base image**: `node:22-bookworm` (full, not slim — includes build tools)
- **Build process**: pnpm monorepo build from source (multi-stage)
- **CMD**: `node openclaw.mjs gateway --allow-unconfigured`
- **Runs as**: `node` user (uid 1000)
- **Port**: 18789 (gateway)
- **Updated**: Within minutes of each release (automated CI)
- **Total downloads**: 140K+

## 4. Strategy Evaluation

### A. Current: `npm install -g openclaw@latest` in our Dockerfile (rebuild on CD deploy)

| Aspect | Assessment |
|--------|------------|
| Freshness | Only updated when we push to main. Between deploys, image can be days behind. |
| Build time | ~2-3 min on t4g.micro. Lightweight (npm install only, slim base). |
| ARM64 | Works — npm compiles native deps on the host. |
| Maintenance | Low — automated in CD. |
| Reliability | Depends on npm availability during build. |
| Customization | Full control over base image, installed packages, user setup. |

**Verdict**: Acceptable but stale between deploys. No way to pick up critical OpenClaw security patches without a Clawgent deploy.

### B. Pull official ghcr.io image directly

| Aspect | Assessment |
|--------|------------|
| Freshness | Always latest. Updated within minutes of each OpenClaw release. |
| Build time | **Zero build time** — just `docker pull`. ~30s on EC2. |
| ARM64 | **Supported** — multi-arch manifest auto-selects arm64. |
| Maintenance | **Minimal** — no Dockerfile to maintain. |
| Reliability | Depends on ghcr.io availability (very reliable). |
| Customization | None — must use OpenClaw's base image as-is. |

**Concerns**:
- Our containers currently depend on `clawgent-openclaw` image name. Would need to either:
  - (a) Re-tag: `docker pull ghcr.io/openclaw/openclaw:latest && docker tag ghcr.io/openclaw/openclaw:latest clawgent-openclaw`
  - (b) Change `OPENCLAW_IMAGE` in deploy route to `ghcr.io/openclaw/openclaw:latest`
- Official image uses `node:22-bookworm` (full) vs our `node:22-bookworm-slim` — larger image but includes all build tools.
- Official image CMD is `gateway --allow-unconfigured` which is what we want.
- Our Dockerfile installs extra packages (`ca-certificates curl bash git`) — the official full image already includes all of these.

**Verdict**: Best option. Eliminates build entirely. Always fresh. ARM64 native.

### C. Cron job on EC2 to rebuild nightly

| Aspect | Assessment |
|--------|------------|
| Freshness | At most ~24h behind. |
| Build time | Same 2-3 min, runs during off-hours. |
| ARM64 | Works (same as current). |
| Maintenance | Cron needs monitoring. Silent failures possible. |
| Reliability | Build can fail silently if npm is down or OOM on t4g.micro. |
| Customization | Full control. |

**Verdict**: Moderate improvement over current approach but adds operational complexity (cron monitoring, failure alerting).

### D. GitHub Action on schedule (e.g., daily)

| Aspect | Assessment |
|--------|------------|
| Freshness | Up to ~24h behind (configurable). |
| Build time | Runs on GitHub runner (fast, not constrained by EC2). But must SSH to EC2 to build ARM64 image — can't cross-compile easily. |
| ARM64 | Tricky — GitHub `ubuntu-latest` is x86_64. Would need `runs-on: ubuntu-latest` + SSH to EC2 for ARM build, OR use QEMU emulation (slow). |
| Maintenance | Medium — another workflow to maintain. |
| Reliability | Good (GitHub Actions is reliable) but SSH to EC2 adds fragility. |

**Verdict**: Overcomplicated. If using the official image, a scheduled `docker pull` on EC2 is simpler.

### E. Watch for new releases (GitHub webhook/RSS)

| Aspect | Assessment |
|--------|------------|
| Freshness | Near real-time (minutes after release). |
| Build time | Triggered on-demand. |
| ARM64 | Depends on implementation. |
| Maintenance | **High** — webhook endpoint, failure handling, retry logic. |
| Reliability | Webhook delivery is not guaranteed. Needs fallback. |

**Verdict**: Over-engineered for our scale. The 1-2 day release cadence doesn't warrant real-time tracking.

## 5. Recommendation

### Primary: Pull official ghcr.io image + scheduled refresh

**Use `ghcr.io/openclaw/openclaw:latest`** instead of building our own image.

#### Implementation plan

1. **CD pipeline** (on every deploy to main):
   ```bash
   docker pull ghcr.io/openclaw/openclaw:latest
   docker tag ghcr.io/openclaw/openclaw:latest clawgent-openclaw
   ```
   Replaces the current `docker build` step. Faster (~30s pull vs ~2-3 min build).

2. **Scheduled cron on EC2** (daily, e.g., 3am UTC):
   ```bash
   # /etc/cron.d/openclaw-image-refresh
   0 3 * * * root docker pull ghcr.io/openclaw/openclaw:latest && docker tag ghcr.io/openclaw/openclaw:latest clawgent-openclaw && logger "OpenClaw image refreshed"
   ```
   Ensures image stays fresh between deploys.

3. **Code change**: None required if we re-tag to `clawgent-openclaw`. The `OPENCLAW_IMAGE` constant stays the same.

4. **Remove**: `deploy/Dockerfile.openclaw` (no longer needed).

#### Why this is best

| Factor | Score |
|--------|-------|
| Freshness | Daily at worst, immediate on deploy |
| Build time | ~30s pull vs ~2-3 min build |
| ARM64 | Native multi-arch support |
| Maintenance | Near-zero — no Dockerfile to maintain |
| Reliability | ghcr.io is highly available; pull is idempotent |
| Disk usage | Slightly larger (full vs slim base) but negligible |
| Customization | We don't customize the image beyond installing openclaw — official image is a superset |

### Fallback

If ghcr.io is ever unreachable, the previously pulled `clawgent-openclaw` tag remains on disk and containers continue to work. New deploys would just use the last-pulled version.

### Version pinning (optional, not recommended now)

For production stability, we could pin to a specific version tag (e.g., `ghcr.io/openclaw/openclaw:2026.2.9`) instead of `latest`. However, given that:
- OpenClaw is rapidly iterating (every 1-2 days)
- We want the latest features and fixes automatically
- Clawgent is not yet at a scale where version pinning is critical

Using `latest` is appropriate for now. Revisit when stability becomes more important than freshness.

---

## 6. Summary

| Strategy | Freshness | Build Time | Maintenance | ARM64 | Recommended |
|----------|-----------|------------|-------------|-------|-------------|
| A. npm install in Dockerfile | On deploy only | 2-3 min | Low | Yes | No |
| **B. Pull ghcr.io official** | **Always latest** | **~30s** | **Minimal** | **Yes** | **Yes** |
| C. Nightly cron rebuild | ~24h | 2-3 min | Medium | Yes | No |
| D. Scheduled GitHub Action | ~24h | Complex | Medium | Tricky | No |
| E. Release webhook | Real-time | Varies | High | Varies | No |

**Recommendation: Strategy B (pull official ghcr.io image) + daily cron refresh.**

This eliminates the custom Dockerfile, reduces build time by ~90%, ensures ARM64 compatibility, and keeps the image fresh with near-zero maintenance.
