# Clawgent — Production Dockerfile
# Multi-stage build: install deps + build Next.js, then run with custom server
#
# NOTE: This container does NOT run Docker-in-Docker. The host Docker socket
# is mounted at runtime (-v /var/run/docker.sock:/var/run/docker.sock) so the
# app can spawn sibling OpenClaw containers on the host.

FROM node:22-bookworm-slim AS base

# Install build tools for native addons (better-sqlite3) and Docker CLI
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl gnupg python3 make g++ lsof && \
    install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc && \
    chmod a+r /etc/apt/keyrings/docker.asc && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list && \
    apt-get update && apt-get install -y --no-install-recommends docker-ce-cli && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --- All dependencies (dev + prod, needed for build AND tsx at runtime) ---
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# --- Build ---
FROM deps AS builder
COPY . .
RUN npm run build

# --- Production ---
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3001

WORKDIR /app

# Copy built Next.js app (standalone output)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Copy all node_modules (tsx is a devDep but needed at runtime for server.ts)
COPY --from=deps /app/node_modules ./node_modules

# Copy source files needed by custom server
COPY --from=builder /app/server.ts ./
COPY --from=builder /app/package.json ./
COPY --from=builder /app/next.config.ts ./
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/src ./src

# Create data directory for SQLite
RUN mkdir -p /app/data

EXPOSE 3001

# Run the custom server via tsx (handles both HTTP and raw TCP WebSocket proxy)
CMD ["./node_modules/.bin/tsx", "server.ts"]
