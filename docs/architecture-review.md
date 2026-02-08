# Architecture Review: Devil's Advocate Analysis

> Status: Complete
> Date: 2026-02-08
> Reviewer: Architecture Review Agent (Pessimistic Mode)
> Inputs: PRD v1, Routing Architecture, Spec v2, Critical Review, Source Code

This review assumes everything that can go wrong will go wrong. Each issue is rated by severity and includes a concrete mitigation.

---

## 1. Security Holes

### 1.1 Auth Token Exposed in URL (Severity: HIGH)

**Current state**: `http://127.0.0.1:19000/?token=abc123`

The gateway auth token is passed as a query parameter. This means:
- It appears in browser history, bookmarks, and the URL bar
- It is logged by web servers, proxies, CDNs, and analytics tools
- It is sent in the HTTP `Referer` header when the user clicks any external link from the OpenClaw dashboard
- It is visible to any screen-sharing, screenshot, or shoulder-surfer
- Copy-pasting the URL to chat/email shares full access

**Concrete scenario**: User screenshots their running instance to share on Twitter. Token is visible in the URL bar. Anyone who sees the screenshot can access that instance.

**PRD claims** (Section 3.4): "No `?token=` in the URL -- this is a security improvement." But the current code (`deploy/route.ts:95`) still constructs `dashboardUrl` with `?token=`. The PRD describes the future Caddy-based architecture where the proxy injects the token server-side. The gap between the code and the spec is a liability.

**Mitigation**: Implement token-to-cookie exchange. On first request with `?token=`, validate token, set an `HttpOnly` cookie, redirect to the URL without the token. All subsequent requests authenticate via cookie. This works in both localhost and production.

---

### 1.2 Docker Socket Exposure (Severity: CRITICAL)

The Next.js API server runs `spawn("docker", [...])` directly. This means the Next.js process has full Docker daemon access. If the Next.js app has any exploitable vulnerability (XSS leading to SSRF, prototype pollution, dependency supply chain attack), an attacker can:

1. `docker run --privileged -v /:/host alpine` -- mount the host filesystem
2. `docker exec` into any running container and read other users' tokens
3. `docker stop` all containers (denial of service)
4. `docker pull` arbitrary images and run crypto miners

**Concrete scenario**: A dependency in the Next.js app (any of hundreds of npm packages) gets compromised. The attacker's payload runs in the Node.js process, which can call `child_process.spawn("docker", ...)`. Full host compromise.

**In production**: The Next.js server must NOT have direct Docker socket access. Use a separate privileged orchestration service with a minimal API surface (deploy, destroy, status) that the Next.js app calls via HTTP. The orchestration service validates and sanitizes all inputs.

**Mitigation (MVP)**: Acceptable for localhost-only. For production, extract Docker operations to a separate process with an allowlisted command set. Never expose the Docker socket to a web-facing process.

---

### 1.3 Container Escape via OpenClaw (Severity: HIGH)

CVE-2026-25253 demonstrated a proven container escape chain through OpenClaw:
1. Steal auth token
2. Disable user confirmations
3. Set `tools.exec.host` to `gateway`
4. Execute arbitrary commands on the host

Each Clawgent container runs OpenClaw with `--allow-unconfigured`, which means the gateway accepts connections without API key validation. In the MVP (no user API keys), this limits the blast radius to the container itself. But the moment users bring their own API keys (V2), a compromised container holds their Anthropic/OpenAI credentials.

**Concrete scenario**: Attacker connects to a container's exposed port (19000+) on the host network, sends WebSocket commands to disable confirmations and escalate to host execution. The current `docker run` command does NOT use `--network` isolation -- containers are on the default bridge network with ports published to `0.0.0.0`.

**Mitigation**:
1. Bind port mappings to `127.0.0.1` only: `-p 127.0.0.1:${port}:18789` (prevents external access to container ports)
2. Create per-container Docker networks with `--internal` flag
3. Drop all Linux capabilities: `--cap-drop=ALL`
4. Read-only root filesystem: `--read-only` (with tmpfs for writable paths)
5. No new privileges: `--security-opt=no-new-privileges`
6. Pin OpenClaw version in the Docker image to a patched version

---

### 1.4 SSRF via Proxy Route (Severity: HIGH)

The planned proxy route (`/i/[id]/[...path]/route.ts`) forwards HTTP requests to `http://127.0.0.1:${instance.port}/${path}`. The path comes directly from the URL. If the proxy implementation does not strictly validate the target, an attacker could potentially craft requests that:

1. Access other services running on `127.0.0.1` (e.g., the Next.js API itself, causing request loops)
2. If combined with an open redirect in OpenClaw, reach internal network services
3. Exfiltrate data from the container via crafted URLs

The routing architecture doc shows the proxy uses `fetch()` to forward requests. The `fetch()` API in Node.js will follow redirects by default. If OpenClaw returns a 302 redirect to an internal URL (e.g., `http://169.254.169.254/latest/meta-data/` on AWS), the proxy will follow it and return the response to the attacker.

**Concrete scenario (on AWS)**: Attacker sends `GET /i/{id}/redirect-to-metadata`. If OpenClaw has any endpoint that issues a redirect based on user input, the proxy follows the redirect to the AWS metadata endpoint and returns IAM credentials to the attacker.

**Mitigation**:
1. Use `redirect: "manual"` in the `fetch()` options to prevent following redirects
2. Validate the proxy target is always `127.0.0.1:${port}` and nothing else
3. Strip any `Location` headers that point outside the expected container
4. On AWS, use IMDSv2 (requires a PUT token request that the proxy won't generate)

---

### 1.5 No Input Validation on Instance ID (Severity: MEDIUM)

In `deploy/route.ts:14`, the instance ID is generated with `randomBytes(4).toString("hex")`. This is 8 hex characters -- fine for uniqueness. But in `instances/[id]/route.ts`, the ID is taken directly from the URL path and used to look up the Map. The ID is not validated against a pattern.

In the proxy route, the ID is used in a Docker command (`docker exec`, `docker logs`). If an attacker crafts a URL with an ID containing shell metacharacters AND the code ever switches back to `shell: true`, this becomes a command injection vector.

**Current state**: `shell: false` prevents this. But it is a fragile defense -- one developer changing `shell: false` to `shell: true` to fix a different bug opens the injection.

**Mitigation**: Validate instance IDs against `/^[a-f0-9]{8}$/` at the API route level before any processing. Reject anything that does not match.

---

### 1.6 Auth Token Generation Entropy (Severity: LOW)

`randomBytes(16).toString("hex")` produces 32 hex characters (128 bits of entropy). This is sufficient for a cryptographic token. No issue here. However, the token is stored in the in-memory Map and exposed in the API response at `instances/[id]/route.ts:27` -- anyone who can call `GET /api/instances/{id}` gets the token. There is no authentication on this endpoint.

**Concrete scenario**: Attacker enumerates instance IDs (8 hex chars = 4.3 billion possibilities, but sequential allocation from `randomBytes(4)` is predictable enough for targeted brute-force). Once an ID is found, `GET /api/instances/{id}` returns the token, granting full access.

**Mitigation**: Do NOT return the token in the instance detail endpoint. The token should only be shown once at deploy time or behind authentication.

---

## 2. Scalability Limits

### 2.1 Port Range Exhaustion (Severity: HIGH)

`allocatePort()` scans ports 19000-19099 (100 ports). Maximum concurrent instances: 100. After that, deployments fail with "No available ports in range."

But the real limit is lower. Each OpenClaw container uses ~2GB RAM (per the PRD's `--memory=2g` limit, though the current code does NOT set memory limits). On a 32GB VPS:
- Theoretical max: 15-16 containers (32GB / 2GB)
- Practical max: 10-12 (OS + Next.js + Docker daemon overhead)

The port limit of 100 will never be reached before memory exhaustion.

**But**: The code currently does NOT set `--memory` or `--cpus` limits. The `docker run` command in `deploy/route.ts:75-86` has no resource constraints. A single container can consume all available host memory, causing OOM kills for other containers and the host itself.

**Concrete scenario**: User deploys an instance and runs a heavy browser automation task. OpenClaw spawns a Chromium instance inside the container, consuming 4-8GB RAM. Other containers get OOM-killed. The Docker daemon becomes unresponsive.

**Mitigation**:
1. Add `--memory=2g --cpus=1` to the `docker run` command immediately
2. Add `--memory-swap=2g` to prevent swap usage
3. Set a hard maximum concurrent instances (e.g., 10 on a 32GB host)
4. Reject new deploys when the host is above 80% memory usage
5. Expand port range to 19000-19999 (no cost, removes an artificial limit)

---

### 2.2 In-Memory Map Does Not Scale (Severity: HIGH)

The `instances` Map lives in Node.js heap memory. This is a single-process, single-node data structure. It cannot survive:
- Process crash
- Server restart
- Load balancing across multiple Node.js processes (Next.js in production can run multiple workers)
- PM2 cluster mode

The `globalThis` trick (`instances.ts:16-20`) survives Next.js hot reloads in development, but NOT:
- Full process restart
- Production `next build && next start` (module loaded once, but lost on restart)
- Turbopack watch mode sometimes clearing globalThis (documented in MEMORY.md as a known issue)

**PRD says**: "Replace the in-memory Map with PostgreSQL (or SQLite on single node)." This is correct but not yet implemented.

**Concrete scenario**: Server runs for 2 weeks. Next.js process crashes due to an unhandled promise rejection. Process restarts. Map is empty. 12 running Docker containers are now orphaned. `reconcileWithDocker()` recovers them on next API call, but:
- `createdAt` is wrong (set to reconciliation time, not actual creation)
- `logs` are empty
- `expires_at` is not tracked (no auto-expiry without DB)

**Mitigation**: Implement SQLite persistence before going to production. The reconciliation function is a safety net, not a primary data store.

---

### 2.3 reconcileWithDocker() Performance (Severity: MEDIUM)

This function is called on EVERY `GET /api/deploy`, `GET /api/instances/{id}` (on miss), and `GET /api/status` request. Each call runs:
1. `docker ps -a --filter name=clawgent-` (one shell command)
2. For each recovered container: `docker exec {name} env` (one shell command per container)

With 15 running containers and a cache miss, that is 16 shell commands per request. Each `docker exec` takes 100-500ms. Total: 1.5-8 seconds per request.

The `reconciling` flag prevents concurrent reconciliations, but it does NOT cache results. Every request to a non-existent instance triggers a full reconciliation.

**Concrete scenario**: An attacker sends 100 requests to `GET /api/instances/nonexistent`. Each triggers `reconcileWithDocker()`. The first one runs (takes 5 seconds), the rest return immediately (due to `reconciling` flag). But the attacker sends another batch 6 seconds later. The Next.js event loop is blocked by serial `spawn` calls.

**Mitigation**:
1. Cache reconciliation results with a TTL (e.g., 30 seconds)
2. Run reconciliation as a background task on startup, not per-request
3. Rate-limit the reconciliation function

---

### 2.4 Docker Daemon as Bottleneck (Severity: MEDIUM)

All Docker operations go through the Docker daemon's Unix socket. The daemon processes commands serially for container lifecycle operations. Under load:
- `docker run` takes 1-3 seconds (image pull + container create + start)
- `docker rm -f` takes 500ms-2s
- `docker ps` takes 100-500ms depending on container count

If 10 users click "Deploy" simultaneously, the Docker daemon processes 10 `docker run` commands serially. Total time: 10-30 seconds. The last user waits 30 seconds before their container even starts, plus the 60-second health check timeout.

**Mitigation**: Queue deployments and process them with bounded concurrency (e.g., max 3 simultaneous `docker run` calls). Show users their position in the queue.

---

## 3. Resource Exhaustion

### 3.1 No Rate Limiting Exists (Severity: CRITICAL)

The `POST /api/deploy` endpoint has zero rate limiting. No IP-based limits, no session limits, no global limits. Anyone can call it in a loop and spin up containers until the host runs out of ports, memory, or disk.

**Concrete scenario**: `for i in $(seq 1 100); do curl -X POST http://target:3001/api/deploy & done`. This fires 100 deploy requests. The code will try to allocate 100 ports, create 100 Docker containers, and consume all host resources.

The PRD specifies "3 active instances per IP, 10 deploys per hour" but this is not implemented.

**Mitigation**: Implement rate limiting before ANY public deployment. At minimum:
1. Per-IP concurrent instance limit (3)
2. Per-IP deploy rate limit (10/hour)
3. Global concurrent instance limit (matches host capacity)
4. Check limits BEFORE starting Docker operations

---

### 3.2 Disk Exhaustion via Volumes (Severity: HIGH)

Each instance creates a Docker volume: `clawgent-data-{id}`. The `DELETE` handler removes the container but does NOT remove the volume. From `instances/[id]/route.ts:45`:

```typescript
await runCommandSilent("docker", ["rm", "-f", instance.containerName]);
```

No `docker volume rm`. The MEMORY.md already notes "4 stale `clawgent-data-*` volumes" from previous test runs.

Each OpenClaw volume can grow to hundreds of MB (conversation history, cached models, browser screenshots). With no cleanup, after 1000 deploys over a few weeks, that is potentially 100GB+ of orphaned volumes.

**Concrete scenario**: VPS has 80GB disk. After 3 weeks of operation with ~50 deploys/day, 1050 orphaned volumes consume 50-100GB. Docker daemon cannot create new containers ("no space left on device"). All new deploys fail. Existing containers may crash if they try to write.

**Mitigation**:
1. Add `docker volume rm ${volumeName}` to the destroy handler
2. Add a cron job that removes volumes not attached to any container
3. Set volume size limits using Docker's `--storage-opt size=500m` (requires specific storage drivers)

---

### 3.3 Docker Image Layer Disk Usage (Severity: MEDIUM)

The `clawgent-openclaw` image is likely 500MB-2GB (Node.js + OpenClaw + dependencies). Docker stores image layers on disk. If the image is updated and re-pulled, old layers remain until pruned.

**Not an immediate risk** for a single image, but becomes one if:
- Multiple image versions are tested
- Other images are pulled (intentionally or via exploit)
- Build cache accumulates

**Mitigation**: Run `docker system prune -f` weekly via cron. Monitor disk usage with alerts at 80% capacity.

---

### 3.4 No Container Auto-Expiry (Severity: HIGH)

The PRD specifies "auto-expiry after 2 hours" but the code has no implementation of this. The `Instance` type has no `expiresAt` field. There is no cron job, no `setInterval`, no cleanup mechanism.

Containers run until manually destroyed or until the host is rebooted.

**Concrete scenario**: 100 users deploy instances over a week. Nobody destroys them. 100 containers running, consuming 200GB RAM (2GB each), 100 ports occupied. Host is completely saturated. No new deploys possible.

**Mitigation**: Add `expiresAt` to the Instance type. Run a cleanup loop every 60 seconds that stops and removes expired containers. Show expiry countdown in the UI.

---

## 4. Failure Modes

### 4.1 Race Condition in Port Allocation (Severity: HIGH)

`allocatePort()` in `deploy/route.ts:139-153` is NOT atomic. It:
1. Reads all used ports from the Map
2. Iterates from 19000 upward
3. Calls `lsof` to check if the port is free
4. Returns the port

If two `POST /api/deploy` requests arrive simultaneously:
1. Both read the Map (same state)
2. Both find port 19000 is free in the Map
3. Both call `lsof` -- port 19000 is free on the host
4. Both return port 19000
5. Both call `docker run` with `-p 19000:18789`
6. The second `docker run` fails: "port 19000 is already allocated"

**Concrete scenario**: User rapidly double-clicks "Deploy." Two POST requests fire. First deploys successfully on port 19000. Second fails with a Docker error. User sees "Deployment failed" with a confusing Docker error message.

**Mitigation**:
1. Use a mutex/lock around port allocation and container creation
2. Or: let Docker allocate the port (use `-p 0:18789` and read the assigned port from `docker port`)
3. Or: use a port allocation counter (atomic increment) instead of scanning

---

### 4.2 Hot Reload During Deploy (Severity: HIGH)

The `deployInstance()` function in `deploy/route.ts:68-117` is async and runs in the background (fire-and-forget from the POST handler). It modifies `instance.status` and `instance.dashboardUrl` directly on the Map object.

If Next.js hot-reloads during the 60-second health check loop:
1. The `globalThis.__clawgent_instances` Map may or may not survive (depends on what changed)
2. The `instance` reference held by `deployInstance()` may be stale
3. The function continues updating a detached object
4. Docker container is running, but the Map entry is lost
5. Frontend polls `GET /api/instances/{id}` -- returns 404
6. User sees "Instance not found" even though the container is running

The `reconcileWithDocker()` function can recover this, but only if someone hits an endpoint that triggers it.

**Mitigation**: Write instance state to disk (or SQLite) at each status transition. The reconciliation function should run on module load, not on-demand.

---

### 4.3 Docker Daemon Crash (Severity: HIGH)

If the Docker daemon crashes or is restarted (`systemctl restart docker`):
1. All containers stop (unless using `--live-restore` daemon option, which is not default)
2. Containers with `--restart=unless-stopped` will restart when the daemon comes back
3. But the health check loop in `deployInstance()` will see failures during the downtime and may mark instances as "error"
4. The `reconcileWithDocker()` function will fail with "Cannot connect to the Docker daemon"
5. The status endpoint returns `dockerAvailable: false`

**The good news**: Containers with `--restart=unless-stopped` (currently set in the code) will auto-restart. The reconciliation function will recover them once Docker is back.

**The bad news**: Any in-progress deployments during the crash will fail permanently. The frontend will show "error" status with no way to retry.

**Mitigation**: Add a "retry deployment" button. Add a "Docker daemon health" monitor that warns before deploying if Docker was recently restarted.

---

### 4.4 Container OOM Kill (Severity: MEDIUM)

Without `--memory` limits (current code), a container can consume unlimited host memory. The Linux OOM killer will terminate the most memory-hungry process, which may be:
- The offending container (best case)
- A different container (wrong victim)
- The Docker daemon itself (catastrophic)
- The Next.js process (service outage)

With `--memory=2g` limits (PRD specifies but code does not implement), Docker will OOM-kill only the container that exceeds its limit. But:
- The container restarts (due to `--restart=unless-stopped`)
- The restart resets OpenClaw state
- The user loses their in-progress work
- No notification is sent

**Mitigation**: Set memory limits. Monitor container restarts. Notify users if their container restarted unexpectedly.

---

### 4.5 Unhandled Promise Rejection in Deploy (Severity: MEDIUM)

`deploy/route.ts:33-36`:
```typescript
deployInstance(instance, volumeName).catch((err) => {
  instance.status = "error";
  addLog(instance, `Fatal error: ${err.message}`);
});
```

If `deployInstance` throws an error that is NOT an `Error` object (e.g., a string or undefined), `err.message` will be undefined and the log will say "Fatal error: undefined". More critically, if the `.catch()` handler itself throws (e.g., `instance` has been garbage collected), the error is silently swallowed.

**Mitigation**: Use `String(err)` instead of `err.message`. Add a global unhandled rejection handler.

---

### 4.6 lsof Dependency for Port Checking (Severity: LOW)

`isPortInUse()` uses `lsof -i :${port}`. This:
- Requires `lsof` to be installed (not present in all Docker images, Alpine, or minimal VPS setups)
- Is macOS-specific in its behavior (Linux `lsof` has different flags)
- Can be slow (100-500ms per call)
- Returns exit code 1 for "port not in use," which the code correctly treats as "not in use"

On a Linux production VPS, `lsof` may not be installed, or it may require `sudo`.

**Mitigation**: Use Node.js `net.createServer()` to test port availability (try to bind, close immediately). This is cross-platform, requires no external tools, and is faster.

---

## 5. The Proxy Approach

### 5.1 Path-Based Routing and OpenClaw Asset Paths (Severity: HIGH)

The routing architecture doc acknowledges this (Section 5): OpenClaw's dashboard may use absolute paths (`/js/app.js` instead of `./js/app.js`). Under path-based routing (`/i/{id}/`), these absolute paths resolve to `localhost:3001/js/app.js` (the Next.js app, not the container), resulting in 404s.

This is not a theoretical concern. Most web applications use absolute paths. If OpenClaw uses React/Vue/Svelte with a bundler, the bundler typically outputs absolute paths in the HTML:
```html
<script src="/assets/index-abc123.js"></script>
<link rel="stylesheet" href="/assets/style-def456.css">
```

The routing doc proposes `<base href="/i/{id}/">` injection, but this only works for relative paths. It does NOT fix paths that start with `/` -- those are absolute and ignore the `<base>` tag.

**The PRD contradicts the routing doc**: The PRD (Section 3.2) says path-based routing was "Rejected: requires reverse proxy path rewriting, breaks OpenClaw's assumption it runs at root `/`" and chose subdomain routing instead. But the routing architecture doc chooses path-based routing for localhost development.

This means: the localhost routing approach (path-based via Next.js proxy) is architecturally different from the production routing approach (subdomain via Caddy). You are building two routing systems. The development proxy is throwaway work.

**Concrete scenario**: You implement the path-based proxy. OpenClaw's dashboard loads at `/i/{id}/` but all CSS/JS assets 404 because they use absolute paths. You spend 2 days building HTML/CSS/JS rewriting logic. Then you move to production with subdomain routing and throw all that rewriting code away.

**Mitigation**: Skip the path-based proxy entirely for localhost. Use subdomain routing in development via `/etc/hosts` entries (works in Chrome). Or use `lvh.me` (resolves `*.lvh.me` to 127.0.0.1). Accept that Safari won't work in development -- Chrome is the stated test browser.

---

### 5.2 WebSocket Through Next.js Custom Server (Severity: HIGH)

The routing doc proposes a custom `server.ts` that wraps Next.js and intercepts HTTP upgrade events for WebSocket proxying. This has several problems:

1. **Next.js discourages custom servers**: The Next.js docs explicitly recommend against custom servers for production. Features like automatic static optimization, middleware, and Edge Runtime may not work correctly.

2. **HMR conflict**: Next.js uses WebSocket upgrades for Hot Module Replacement in development. The custom server must correctly differentiate HMR upgrades from proxy upgrades. The routing doc acknowledges this but the regex `^\/i\/([a-f0-9]+)(\/.*)?$` only matches `/i/{id}/` paths. If the regex fails or there is a path collision, HMR breaks and development becomes impossible.

3. **Turbopack incompatibility**: Next.js 16 uses Turbopack by default. Turbopack's dev server may handle upgrades differently than webpack's. The custom server approach may not be compatible with Turbopack.

4. **Production WebSocket is different**: In production, the PRD specifies Caddy as the reverse proxy, which handles WebSocket natively. The custom server's WebSocket handling is throwaway code.

5. **`require()` in ESM context**: The routing doc uses `require("./src/lib/instances")` in the upgrade handler. If the project uses ESM (which Next.js 16 with TypeScript likely does), `require()` may not work. Dynamic `import()` is async and cannot be used synchronously in the upgrade handler.

**Mitigation**: For MVP, test whether OpenClaw's dashboard actually requires WebSocket for initial rendering. If it works without WebSocket (showing a static "connecting..." screen), the HTTP-only proxy is sufficient for a demo. WebSocket can be deferred to the Caddy-based production setup.

---

### 5.3 Proxy Restart Kills WebSocket Connections (Severity: MEDIUM)

When the Next.js dev server restarts (code change, crash, manual restart), all WebSocket connections through the proxy are dropped. OpenClaw's dashboard may handle reconnection gracefully, or it may show an error and require a full page refresh.

In production with Caddy, a Caddy reload (e.g., after adding a new route) also drops WebSocket connections. If the cleanup cron removes an expired instance and triggers a Caddy config reload, all other instances' WebSocket connections are momentarily interrupted.

**Mitigation**: Use Caddy's zero-downtime reload feature. For development, accept that WebSocket drops happen on code changes.

---

## 6. Production Readiness Gaps

### 6.1 No HTTPS (Severity: CRITICAL for production)

The current code serves everything over HTTP. For production:
- Browsers will block mixed content (HTTP WebSocket from HTTPS page)
- Auth tokens in URL query strings are visible to network observers
- No certificate management

The PRD specifies Caddy with auto-TLS. This is the right answer but is not yet implemented.

---

### 6.2 No Health Monitoring (Severity: HIGH)

There is no:
- Process supervisor for the Next.js server (it crashes, nobody restarts it)
- Container health monitoring (a container could be running but OpenClaw inside it could be hung)
- Alerting when instances fail
- Dashboard for ops (how many containers, resource usage, error rates)

The `GET /api/status` endpoint returns Docker availability and instance count. That is not monitoring. That is a single data point.

**Mitigation**: Use `systemd` for the Next.js process, Docker health checks for containers (`HEALTHCHECK` in Dockerfile), and an external uptime monitor (UptimeRobot, Better Uptime) for the web app.

---

### 6.3 No Logging Infrastructure (Severity: HIGH)

Logs exist only in:
- `instance.logs[]` (in-memory array, lost on restart)
- Docker container logs (retained until container is removed)
- stdout/stderr of the Next.js process

There is no:
- Structured logging
- Log aggregation
- Log rotation (container logs can grow unbounded)
- Error tracking (Sentry, etc.)
- Request logging (who deployed what, when)

**Mitigation**: Add structured JSON logging. Use Docker's `--log-opt max-size=10m --log-opt max-file=3` to prevent container log growth. Ship logs to a service (even a simple file) for post-mortem analysis.

---

### 6.4 No Backup or Recovery (Severity: MEDIUM)

If the VPS dies:
- All containers are lost
- All volumes are lost
- All instance state (even if in SQLite) is lost
- No way to reconstruct what was running

For an ephemeral 2-hour trial service, this is acceptable. Data loss = session loss, not permanent data loss. But it means downtime until a new VPS is provisioned and configured.

**Mitigation**: Document the VPS setup as Infrastructure-as-Code (Ansible, Terraform) so a new VPS can be provisioned in 15 minutes.

---

### 6.5 No Graceful Shutdown (Severity: MEDIUM)

When the Next.js process receives SIGTERM:
- In-progress deployments are abandoned mid-health-check
- The instance Map is lost (if not persisted)
- No "draining" of active connections
- Docker containers keep running (good, they are independent processes)

**Mitigation**: Handle SIGTERM in the custom server to flush state to disk, wait for in-progress deploys to reach a checkpoint, and close cleanly.

---

## 7. Cost Realities

### 7.1 Single VPS Viability (Severity: MEDIUM)

The PRD models this:
- 4-8 vCPU, 16-32GB RAM VPS: $48-96/month
- Supports 10-20 concurrent instances
- Cost per instance-hour at 15 concurrent: $0.004

This math assumes:
- All instances use exactly 2GB RAM (in reality, usage varies wildly)
- No one runs browser automation (8GB+ per instance)
- Instance churn is high (2-hour expiry means ~12 cycles/day per slot)
- The VPS itself is reliable (cloud VPS SLA is typically 99.9% = 8.7 hours downtime/year)

**Real-world estimate**:
- 10 concurrent at 2GB each = 20GB container RAM + 4GB OS/app = 24GB minimum
- Need 32GB VPS = ~$96/month on DigitalOcean, ~$20-30/month on Hetzner
- With 8 concurrent (more realistic with safety margin): still need 32GB

At $30/month (Hetzner) with 8 concurrent instances and 2-hour expiry:
- ~96 instance-sessions/day
- ~2880 instance-sessions/month
- Cost: $0.01 per instance-session

If even 5% of those sessions convert to paying ($15/month):
- 144 conversions/month
- Revenue: $2160/month
- Infrastructure cost: $30/month
- Gross margin: 98.6%

**The single-VPS model is actually viable IF you keep it to one VPS.** The problem is when you need to scale to VPS #2 -- that requires a load balancer, shared state, and cross-node container management. That is a fundamentally different architecture.

**Mitigation**: Design the persistence layer (SQLite -> PostgreSQL) so it can move to a shared database when multi-node becomes necessary. But do not over-build for multi-node until you have 15+ concurrent regularly.

---

## 8. OpenClaw-Specific Risks

### 8.1 The `--allow-unconfigured` Flag (Severity: HIGH)

This flag allows OpenClaw to start without a configured AI model provider. The gateway runs, the dashboard loads, but the AI features do not work. Users land on a dashboard that looks live but cannot actually do anything meaningful.

**What users see**: A chat interface where sending a message results in "No model configured" or similar error. The "Deploy OpenClaw under 1 minute" promise technically delivers a running dashboard but not a functional AI agent.

**PRD acknowledges this**: "No API key management (instances run with `--allow-unconfigured`)" and "No persistent instances." The MVP is a demo, not a product.

**Risk**: Users click "Deploy," see a broken-looking dashboard, and conclude the product does not work. First impression is ruined. They do not come back when V2 ships.

**Mitigation**: The landing page must set expectations clearly: "This deploys a running OpenClaw gateway. To use AI features, you will need to configure your own API key inside the dashboard." Or: provide a limited free API key for trial use (expensive but high-conversion).

---

### 8.2 Version Pinning (Severity: HIGH)

The Docker image `clawgent-openclaw` is referenced by name, not by tag or SHA. If the image is rebuilt with a new OpenClaw version, all new deploys get the new version with no testing.

OpenClaw has had three name changes and multiple security patches in its first month. Upstream breaking changes are not hypothetical -- they are historical fact.

**Concrete scenario**: OpenClaw 2026.2.5 ships a config file format change. The existing Docker image is rebuilt. New deploys fail because the container entrypoint (`openclaw gateway`) crashes with "invalid config." All new deploys are broken until someone investigates and pins the image.

**Mitigation**: Tag the Docker image with a specific version (`clawgent-openclaw:2026.2.2`). Test new versions in a staging environment before updating the tag. Document the update process.

---

### 8.3 Upstream Licensing and Trademark (Severity: MEDIUM)

OpenClaw is MIT-licensed, so forking is allowed. But:
- "OpenClaw" is a trademark. Using it in your product name ("Clawgent - Deploy OpenClaw") is permissible as descriptive fair use, but a hostile trademark owner could challenge it.
- The project has already been forced to rename once (from a previous name). Anthropic is actively enforcing trademarks in this space.
- If OpenClaw changes licensing (unlikely with MIT, but possible via relicensing), existing forks are grandfathered but new features are not.

**Mitigation**: Do not use "OpenClaw" in the domain name or brand name. "Clawgent" is fine. "OpenClaw" in descriptions ("Deploy OpenClaw") is descriptive fair use. Monitor upstream licensing changes.

---

### 8.4 Container Image Provenance (Severity: MEDIUM)

The image `clawgent-openclaw` appears to be a custom build, not an official OpenClaw image. Questions:
- Who built it?
- What is in it beyond OpenClaw?
- Is it scanned for vulnerabilities?
- Is the Dockerfile source-controlled?
- Does it receive security updates?

If this image was built locally on the developer's machine, it may contain:
- Dev tools and debugging utilities
- A specific Node.js version that may have CVEs
- Non-minimal base image with unnecessary packages

**Mitigation**: Build a minimal Dockerfile from `node:22-alpine`, install only OpenClaw, and store the Dockerfile in the repo. Scan with `docker scout` or Trivy on every build.

---

## 9. Summary: Top 10 Issues by Priority

| # | Issue | Severity | Effort to Fix | Section |
|---|-------|----------|---------------|---------|
| 1 | No rate limiting on deploy endpoint | Critical | Low (1-2 hours) | 3.1 |
| 2 | No container resource limits (--memory, --cpus) | Critical | Trivial (add 2 args) | 2.1 |
| 3 | No auto-expiry for containers | High | Medium (half day) | 3.4 |
| 4 | Docker volumes not cleaned up on destroy | High | Trivial (add 1 line) | 3.2 |
| 5 | Token exposed in GET /api/instances/{id} | High | Low (1 hour) | 1.6 |
| 6 | Race condition in port allocation | High | Low (1-2 hours) | 4.1 |
| 7 | Container ports bound to 0.0.0.0, not 127.0.0.1 | High | Trivial (change 1 line) | 1.3 |
| 8 | In-memory state not persisted (known issue) | High | Medium (half day) | 2.2 |
| 9 | Path-based proxy vs subdomain routing mismatch | High | Design decision | 5.1 |
| 10 | Docker image not version-pinned | High | Trivial (add tag) | 8.2 |

The first 7 items are low-effort, high-impact fixes that should be done before any public deployment. Items 8-10 are design decisions that affect the development trajectory.

---

## 10. What I Would Do Differently

If I were building this from scratch with the knowledge above:

1. **Skip the path-based proxy**. Use `lvh.me` subdomains for local development (e.g., `abc123.lvh.me:3001`). This matches the production subdomain architecture and avoids building throwaway routing code.

2. **SQLite from day one**. The in-memory Map has caused enough bugs already. SQLite is a single file, zero-config, and survives restarts. Use `better-sqlite3` (synchronous, no async overhead).

3. **Let Docker allocate ports**. Use `-p 0:18789` and read the port from `docker port`. Eliminates the race condition, the `lsof` dependency, and the port scanning loop.

4. **Add resource limits immediately**. `--memory=2g --cpus=1 --pids-limit=256`. No container should be able to affect the host or other containers.

5. **Bind to 127.0.0.1 only**. `-p 127.0.0.1:${port}:18789`. Container ports should never be directly accessible from the network.

6. **Rate limit the deploy endpoint**. Even a simple in-memory counter per IP is better than nothing.

7. **Do not return tokens in the instance list endpoint**. Show them once at deploy time, then require re-authentication.

8. **Build the Caddyfile generator**. Instead of an in-app proxy, have the deploy API write a Caddy config snippet and trigger a reload. This works identically in dev and production.

---

*This review is intentionally pessimistic. Many of these issues are acceptable for a localhost-only MVP. They become blockers the moment the application is accessible from the internet.*
