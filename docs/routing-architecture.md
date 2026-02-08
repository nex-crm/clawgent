# Routing Architecture: Unique Instance URLs

> Last updated: 2026-02-08
> Status: Research complete, recommendation ready

---

## 1. Problem Statement

Currently, each deployed OpenClaw instance is accessed via a raw port URL:

```
http://127.0.0.1:19000/?token=abc123
http://127.0.0.1:19001/?token=def456
```

This is ugly, hard to share, hard to remember, and leaks infrastructure details. We need clean, user-friendly URLs that route to the correct backend container.

---

## 2. Approaches Evaluated

### 2.1 Subdomain Routing (`{id}.localhost:3001`)

**How it works**: Each instance gets a subdomain. Next.js proxy/middleware or a reverse proxy inspects the `Host` header and routes to the correct backend port.

```
http://a1b2c3d4.localhost:3001  -->  http://127.0.0.1:19000
http://e5f6g7h8.localhost:3001  -->  http://127.0.0.1:19001
```

**Pros**:
- Clean, industry-standard pattern (Vercel, Railway, Fly.io all do this)
- Each instance is fully isolated by origin (cookies, localStorage)
- No path collision with the Next.js app itself

**Cons**:
- `*.localhost` subdomain resolution is inconsistent across browsers:
  - Chrome/Chromium: Works natively (resolves `*.localhost` to `127.0.0.1` per RFC 6761)
  - Firefox: Partial support, behavior varies by version and OS
  - Safari: Does NOT resolve `*.localhost` subdomains (confirmed bug)
- Requires `/etc/hosts` entries or a DNS trick (e.g., `lvh.me`) for cross-browser dev
- Next.js dev server doesn't listen for subdomains by default
- Adds complexity when moving to AWS (need wildcard DNS + wildcard TLS cert)

**Verdict**: Too fragile for local development. Safari incompatibility is a dealbreaker since the user tests in Chrome but others may not.

---

### 2.2 Path-Based Routing (`localhost:3001/i/{id}/...`)

**How it works**: All instance traffic goes through a path prefix. A reverse proxy strips the prefix and forwards to the correct backend port.

```
http://localhost:3001/i/a1b2c3d4/     -->  http://127.0.0.1:19000/
http://localhost:3001/i/a1b2c3d4/ws   -->  ws://127.0.0.1:19000/ws
http://localhost:3001/i/e5f6g7h8/     -->  http://127.0.0.1:19001/
```

**Pros**:
- Works in all browsers, no DNS tricks needed
- Single origin (localhost:3001), no CORS issues
- Simple to implement with Next.js rewrites or a Node.js proxy
- Easy to migrate to AWS (just change the base URL)
- Token can be embedded in path or query string

**Cons**:
- OpenClaw dashboard may use absolute paths for its assets (e.g., `/js/app.js` instead of `./js/app.js`). If so, those requests won't include the `/i/{id}/` prefix and will 404.
- All instances share the same origin (cookies/localStorage could collide if OpenClaw uses them without instance-scoping)
- Path rewriting adds a small amount of complexity

**Verdict**: Best option for local development. The absolute-path issue is solvable (see Section 4).

---

### 2.3 External Reverse Proxy (Traefik / Caddy / nginx)

**How it works**: Run a standalone reverse proxy process alongside the Next.js dev server. It handles routing to OpenClaw containers.

| Proxy | Dynamic Registration | WebSocket | Config Complexity | Extra Process |
|-------|---------------------|-----------|-------------------|---------------|
| **Traefik** | Docker labels (automatic) | Yes | Medium (YAML) | Yes |
| **Caddy** | API or Caddyfile reload | Yes | Low | Yes |
| **nginx** | Conf file reload | Yes | Medium | Yes |

**Pros**:
- Purpose-built for reverse proxying
- Battle-tested WebSocket support
- Traefik auto-discovers Docker containers via labels

**Cons**:
- Extra process to manage (user must run both Next.js AND the proxy)
- More moving parts = more things to break
- Traefik/Caddy are overkill for local dev with <10 containers
- Configuration drift between local (proxy) and production (AWS ALB or similar)
- Violates the "simple, no heavy infra" requirement

**Verdict**: Overkill for MVP. Good option for production if we self-host, but AWS ALB/CloudFront will handle this in production.

---

### 2.4 Next.js Built-in Rewrites (`next.config.ts`)

**How it works**: Define rewrite rules in `next.config.ts` that proxy requests to backend containers.

```typescript
// next.config.ts
const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/i/:id/:path*',
        destination: 'http://127.0.0.1:19000/:path*', // But which port?!
      },
    ];
  },
};
```

**Pros**:
- Zero dependencies, built into Next.js
- Works for HTTP

**Cons**:
- Rewrites are static (defined at build/startup time). We cannot dynamically map instance IDs to ports at runtime. New deploys would require restarting Next.js to pick up new rewrite rules.
- No native WebSocket proxying through rewrites
- Cannot inject auth token validation logic

**Verdict**: Not viable. The dynamic routing requirement eliminates this option entirely.

---

### 2.5 Next.js API Route as Reverse Proxy (Recommended)

**How it works**: A catch-all API route (`/api/proxy/[id]/[...path]` or `/i/[id]/[...path]`) looks up the instance's port from the in-memory store, then proxies the request using `node-http-proxy` or raw `fetch()`.

```
GET /i/a1b2c3d4/            -->  proxy to http://127.0.0.1:19000/
GET /i/a1b2c3d4/js/app.js   -->  proxy to http://127.0.0.1:19000/js/app.js
WS  /i/a1b2c3d4/ws          -->  proxy to ws://127.0.0.1:19000/ws
```

**Pros**:
- No extra processes or dependencies beyond one npm package
- Dynamic routing: looks up instance ID in the Map at request time
- Can validate auth tokens before proxying
- Path-based, works in all browsers
- Shares the same port as the main app (3001)
- Easy to add logging, rate limiting, access control

**Cons**:
- WebSocket proxying requires special handling (Next.js API routes are request-response, not long-lived). Requires either:
  - (a) `next-ws` package for WebSocket upgrade handling in API routes
  - (b) Custom server wrapping Next.js to intercept HTTP upgrade events
  - (c) `instrumentation.ts` hook to attach a WebSocket proxy to the underlying HTTP server
- Adds latency (extra hop through Node.js), but negligible for local dev
- Need to handle streaming responses correctly (SSE, chunked transfer)

**Verdict**: Best balance of simplicity, flexibility, and compatibility. WebSocket handling is the one hard part, but solvable.

---

## 3. Recommendation

**Use path-based routing through Next.js API routes (Option 2.5)**, with a custom server wrapper for WebSocket proxying.

### Architecture

```
Browser
   |
   |  http://localhost:3001/i/{id}/?token={token}
   |  ws://localhost:3001/i/{id}/ws
   |
   v
+----------------------------------------------------------+
|  Next.js Custom Server (server.ts)                        |
|  Port 3001                                                |
|                                                           |
|  HTTP requests:                                           |
|    /            --> Next.js App (landing page)             |
|    /api/*       --> Next.js API routes (deploy, status)    |
|    /i/{id}/*    --> Proxy API route (HTTP)                 |
|                    |                                      |
|                    v                                      |
|              instances Map lookup                         |
|              id -> port mapping                           |
|                    |                                      |
|                    v                                      |
|              http-proxy -> http://127.0.0.1:{port}/*      |
|                                                           |
|  WebSocket upgrades:                                      |
|    /i/{id}/ws   --> HTTP upgrade intercepted               |
|                    |                                      |
|                    v                                      |
|              http-proxy.ws -> ws://127.0.0.1:{port}/ws    |
+----------------------------------------------------------+
         |              |              |
         v              v              v
   +-----------+  +-----------+  +-----------+
   | Container |  | Container |  | Container |
   | port 19000|  | port 19001|  | port 19002|
   | OpenClaw  |  | OpenClaw  |  | OpenClaw  |
   +-----------+  +-----------+  +-----------+
```

### URL Structure

```
Dashboard:     http://localhost:3001/i/{id}/?token={token}
WebSocket:     ws://localhost:3001/i/{id}/ws
Static assets: http://localhost:3001/i/{id}/js/app.js
API (deploy):  http://localhost:3001/api/deploy
API (status):  http://localhost:3001/api/instances/{id}
```

---

## 4. Implementation Plan

### 4.1 Install Dependencies

```bash
cd /Users/najmuzzaman/Documents/clawgent/app
npm install http-proxy @types/http-proxy
```

`http-proxy` (node-http-proxy) is a mature, well-maintained library with native WebSocket support. It is the underlying engine behind `http-proxy-middleware`.

### 4.2 Create Proxy API Route (HTTP only)

**File**: `app/src/app/i/[id]/[...path]/route.ts`

This catch-all route handles all HTTP requests under `/i/{id}/...`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { instances, reconcileWithDocker } from "@/lib/instances";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; path: string[] }> }
) {
  return proxyRequest(request, await params);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; path: string[] }> }
) {
  return proxyRequest(request, await params);
}

async function proxyRequest(
  request: NextRequest,
  { id, path }: { id: string; path: string[] }
) {
  let instance = instances.get(id);
  if (!instance) {
    await reconcileWithDocker();
    instance = instances.get(id);
  }

  if (!instance || instance.status !== "running") {
    return NextResponse.json(
      { error: "Instance not found or not running" },
      { status: 404 }
    );
  }

  // Reconstruct the target URL
  const targetPath = "/" + (path?.join("/") || "");
  const targetUrl = new URL(targetPath, `http://127.0.0.1:${instance.port}`);

  // Forward query string
  request.nextUrl.searchParams.forEach((value, key) => {
    targetUrl.searchParams.set(key, value);
  });

  // Proxy the request using fetch
  const proxyRes = await fetch(targetUrl.toString(), {
    method: request.method,
    headers: filterHeaders(request.headers),
    body: request.method !== "GET" && request.method !== "HEAD"
      ? request.body
      : undefined,
    // @ts-expect-error duplex needed for streaming body
    duplex: "half",
  });

  // Return the proxied response
  return new Response(proxyRes.body, {
    status: proxyRes.status,
    statusText: proxyRes.statusText,
    headers: proxyRes.headers,
  });
}

function filterHeaders(headers: Headers): HeadersInit {
  const filtered: Record<string, string> = {};
  headers.forEach((value, key) => {
    // Skip hop-by-hop headers
    if (!["host", "connection", "keep-alive", "transfer-encoding"].includes(key.toLowerCase())) {
      filtered[key] = value;
    }
  });
  return filtered;
}
```

### 4.3 Handle the Root Path (`/i/{id}/` without trailing path)

**File**: `app/src/app/i/[id]/route.ts`

Next.js catch-all `[...path]` does not match the bare `/i/{id}/` route. We need a separate route for it:

```typescript
import { NextRequest } from "next/server";
// Re-export proxy logic for the root path
// Implementation mirrors the catch-all but with path = []
```

### 4.4 WebSocket Proxying via Custom Server

**File**: `app/server.ts`

Standard Next.js API routes cannot handle WebSocket upgrade requests. We need a thin custom server wrapper:

```typescript
import { createServer } from "http";
import httpProxy from "http-proxy";
import next from "next";

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = parseInt(process.env.PORT || "3001", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Create a reusable proxy instance
const proxy = httpProxy.createProxyServer({ ws: true });

proxy.on("error", (err, _req, res) => {
  console.error("[proxy error]", err.message);
  if (res && "writeHead" in res) {
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end("Bad Gateway");
  }
});

app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res);
  });

  // Intercept WebSocket upgrade requests for /i/{id}/ paths
  server.on("upgrade", (req, socket, head) => {
    const url = req.url || "";
    const match = url.match(/^\/i\/([a-f0-9]+)(\/.*)?$/);

    if (!match) {
      // Not an instance proxy path — let Next.js handle (HMR, etc.)
      return;
    }

    const id = match[1];
    const targetPath = match[2] || "/";

    // Dynamic import to access the shared instances Map
    // Note: In practice, expose a getter function from instances.ts
    const { instances } = require("./src/lib/instances");
    const instance = instances.get(id);

    if (!instance || instance.status !== "running") {
      socket.destroy();
      return;
    }

    req.url = targetPath;
    proxy.ws(req, socket, head, {
      target: `ws://127.0.0.1:${instance.port}`,
    });
  });

  server.listen(port, hostname, () => {
    console.log(`> Clawgent ready on http://${hostname}:${port}`);
  });
});
```

### 4.5 Update `package.json` Scripts

```json
{
  "scripts": {
    "dev": "tsx server.ts",
    "build": "next build",
    "start": "NODE_ENV=production tsx server.ts"
  }
}
```

### 4.6 Update Instance Dashboard URL

**File**: `app/src/lib/instances.ts` and `app/src/app/api/deploy/route.ts`

Change `dashboardUrl` from:
```typescript
`http://127.0.0.1:${instance.port}/?token=${instance.token}`
```
To:
```typescript
`/i/${instance.id}/?token=${instance.token}`
```

This makes the URL relative to the app, which is correct for both local and production.

### 4.7 Update Frontend Links

**File**: `app/src/app/page.tsx`

Dashboard links should use the new `/i/{id}/` path. The "Open Dashboard" button already uses `dashboardUrl` from the API, so it will automatically pick up the new URL format.

### 4.8 Files to Create/Modify

| Action | File | Purpose |
|--------|------|---------|
| CREATE | `app/server.ts` | Custom server with WebSocket upgrade handling |
| CREATE | `app/src/app/i/[id]/[...path]/route.ts` | HTTP proxy catch-all for instance sub-paths |
| CREATE | `app/src/app/i/[id]/route.ts` | HTTP proxy for instance root path |
| MODIFY | `app/src/lib/instances.ts` | Change `dashboardUrl` format |
| MODIFY | `app/src/app/api/deploy/route.ts` | Change `dashboardUrl` format |
| MODIFY | `app/src/app/api/instances/[id]/route.ts` | No changes needed (returns dashboardUrl as-is) |
| MODIFY | `app/package.json` | Update dev/start scripts, add http-proxy dependency |
| MODIFY | `app/next.config.ts` | No changes needed (rewrites not used) |
| MODIFY | `app/src/app/page.tsx` | Minor: handle relative dashboard URLs |

---

## 5. Handling the Absolute Path Problem

OpenClaw's dashboard may reference static assets with absolute paths (e.g., `/js/app.js` instead of `./js/app.js`). When proxied under `/i/{id}/`, these would resolve to `localhost:3001/js/app.js` instead of `localhost:3001/i/{id}/js/app.js`, resulting in 404s.

### Solutions (in order of preference):

1. **Proxy rewrites in the custom server**: Add a fallback rule — if a request to `/{asset-path}` fails against Next.js, check if it matches a pattern that OpenClaw would serve, and proxy it to the active instance. This is fragile and not recommended.

2. **Content rewriting**: The HTTP proxy can rewrite HTML responses, replacing absolute paths with prefixed paths. This is CPU-intensive and error-prone (breaks JS string matching, etc.).

3. **Verify OpenClaw uses relative paths**: Test an actual OpenClaw dashboard to check if assets use relative or absolute paths. If relative, no problem exists.

4. **Use `<base>` tag injection**: Inject `<base href="/i/{id}/">` into the proxied HTML response. This makes all relative URLs resolve correctly, and absolute paths in `<a>`, `<img>`, `<script>`, `<link>` tags become relative to the base. This is the cleanest solution if OpenClaw uses relative paths but the browser resolves them against the wrong base.

**Recommendation**: First, verify what OpenClaw actually does (option 3). If it uses absolute paths, use `<base>` tag injection (option 4).

---

## 6. Auth Token Handling

Current flow: token is passed as a query parameter `?token={token}`.

With the proxy, two options:

### Option A: Token in Query String (Current, Keep for Now)
```
http://localhost:3001/i/{id}/?token={token}
```
- Simple, no changes needed
- Token visible in URL bar and browser history
- Works with bookmarks

### Option B: Token Validation in Proxy (Future Enhancement)
- Proxy route validates the token against the instance record
- If valid, sets a short-lived cookie or session
- Subsequent requests authenticated via cookie
- Token no longer visible in URL after initial load

**Recommendation**: Keep Option A for MVP. It matches the current behavior and is simplest. Move to Option B when adding real auth.

---

## 7. What Changes for AWS Deployment

When moving from local Docker to AWS VMs, the routing architecture changes significantly but the user-facing URL pattern stays the same.

### Local (Current)
```
Browser --> Next.js custom server (port 3001)
               |
               v
         http-proxy --> Docker container (port 19000+)
```

### AWS (Future)
```
Browser --> CloudFront / ALB
               |
               v
         Next.js on ECS/EC2 (or Vercel)
               |
               v
         API route proxy --> EC2 VM public IP:18789
```

### Key Differences

| Aspect | Local | AWS |
|--------|-------|-----|
| Proxy target | `127.0.0.1:{port}` | `{vm-public-ip}:18789` |
| Custom server needed? | Yes (for WS) | Maybe (ALB handles WS upgrades) |
| WebSocket | Custom server upgrade handler | ALB WebSocket sticky sessions |
| TLS | Not needed (localhost) | ACM certificate on ALB |
| DNS | N/A | Route53 with optional wildcard |
| Path prefix | `/i/{id}/` | `/i/{id}/` (same) |

### Migration Path

1. The `dashboardUrl` format (`/i/{id}/?token={token}`) stays the same
2. The proxy route changes `target` from `http://127.0.0.1:{port}` to `http://{vm-ip}:18789`
3. The Instance type gets a new field: `vmIp` (replaces `port` for remote instances)
4. AWS ALB can handle WebSocket upgrades natively, so the custom server may not be needed in production
5. If using Vercel for the frontend, the proxy routes would use Vercel Serverless Functions (HTTP only) + a separate WebSocket service

### Recommended AWS Architecture

```
                    CloudFront (CDN + HTTPS)
                           |
                    +------+------+
                    |             |
                    v             v
              ALB (HTTPS)    S3 (static)
                    |
            +-------+-------+
            |               |
            v               v
     ECS (Next.js)    Target Group
     - API routes     (health checks)
     - Proxy routes
            |
            v
     EC2 Instances (OpenClaw VMs)
     - Each on port 18789
     - Security group: allow ALB only
```

---

## 8. Trade-offs Summary

| Factor | Chosen Approach | Risk | Mitigation |
|--------|----------------|------|------------|
| Complexity | Custom server + API route proxy | Custom server adds 50 lines of code | Well-documented, standard Node.js pattern |
| WebSocket | Custom server upgrade handler | Next.js HMR uses upgrade too | Path-match filter: only proxy `/i/{id}/` upgrades |
| Performance | Extra hop through Node.js | Latency increase | Negligible for local dev; AWS ALB removes this hop |
| OpenClaw assets | May use absolute paths | 404 for assets | Test first; use `<base>` tag injection if needed |
| Browser compat | Path-based (not subdomain) | None | Works everywhere |
| Auth | Token in query string | Visible in URL | Acceptable for MVP; cookie-based auth later |
| State | In-memory Map | Resets on restart | Docker reconciliation already implemented |

---

## 9. Alternatives Considered but Rejected

| Alternative | Why Rejected |
|-------------|-------------|
| Subdomain routing (`{id}.localhost`) | Safari doesn't resolve `*.localhost`; requires DNS hacks |
| Traefik/Caddy sidecar | Extra process, overkill for <10 containers |
| `next.config.ts` rewrites | Static, cannot map IDs to ports dynamically |
| `next-ws` package | Patches Next.js internals, fragile across versions |
| Pure `fetch()` proxy (no http-proxy) | Cannot handle WebSocket upgrades or streaming efficiently |
| nginx sidecar | Same issues as Traefik/Caddy, plus manual config management |

---

## 10. Implementation Sequence

1. Install `http-proxy` and `@types/http-proxy`
2. Create `server.ts` custom server wrapper
3. Create `/i/[id]/[...path]/route.ts` HTTP proxy route
4. Create `/i/[id]/route.ts` root proxy route
5. Update `dashboardUrl` in `instances.ts` and `deploy/route.ts`
6. Update `package.json` scripts
7. Test: deploy instance, verify dashboard loads at `/i/{id}/`
8. Test: verify WebSocket connection works through proxy
9. Test: verify multiple instances route correctly
10. Test: verify instance destruction removes routing

---

## References

- [Next.js 16 Proxy documentation](https://nextjs.org/docs/app/getting-started/proxy)
- [node-http-proxy (http-proxy)](https://github.com/http-party/node-http-proxy)
- [RFC 6761 - localhost special-use domain](https://datatracker.ietf.org/doc/html/rfc6761)
- [Next.js WebSocket discussion #38057](https://github.com/vercel/next.js/discussions/38057)
- [Next.js rewrites documentation](https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites)
