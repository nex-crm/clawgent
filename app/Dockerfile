# Clawgent — Production Dockerfile
# Multi-stage build: install deps + build Next.js, then run with custom server

FROM node:22-bookworm-slim AS base

# Install Docker CLI (needed to spawn OpenClaw containers)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl gnupg && \
    install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc && \
    chmod a+r /etc/apt/keyrings/docker.asc && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list && \
    apt-get update && apt-get install -y --no-install-recommends docker-ce-cli && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --- Dependencies ---
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Also install dev deps for build stage
FROM base AS deps-all
COPY package.json package-lock.json ./
RUN npm ci

# --- Build ---
FROM deps-all AS builder
COPY . .
RUN npm run build

# --- Production ---
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3001

WORKDIR /app

# Copy built Next.js app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Copy production dependencies
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

# Use tsx to run the custom server (same as local dev, but NODE_ENV=production)
CMD ["npx", "tsx", "server.ts"]
