import { NextRequest, NextResponse } from "next/server";
import { findInstanceByToken } from "@/lib/instances";
import { checkRateLimit, incrementUsage } from "@/lib/rate-limit";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: { message, type: "proxy_error" } }, { status });
}

function extractToken(request: NextRequest): string | null {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

async function handleProxy(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;

  // 1. Verify server has Gemini key configured
  const geminiKey = process.env.NEX_SHARED_GEMINI_KEY;
  if (!geminiKey) {
    return jsonError("LLM proxy is not configured on this server", 503);
  }

  // 2. Extract and validate instance token
  const token = extractToken(request);
  if (!token) {
    return jsonError("Missing or malformed Authorization header. Expected: Bearer {instance-token}", 401);
  }

  const instance = findInstanceByToken(token);
  if (!instance || instance.status !== "running") {
    return jsonError("Invalid or expired instance token", 401);
  }

  // 3. Check rate limit for the instance owner
  const userId = instance.userId;
  if (!userId) {
    return jsonError("Instance has no associated user", 401);
  }

  const { allowed, remaining } = checkRateLimit(userId);
  if (!allowed) {
    return NextResponse.json(
      {
        error: {
          message: "Daily free tier limit reached (200 calls/day). Try again tomorrow or use your own API key.",
          type: "rate_limit_exceeded",
        },
      },
      {
        status: 429,
        headers: { "X-RateLimit-Remaining": String(remaining) },
      },
    );
  }

  // 4. Validate path against whitelist (prevent SSRF to arbitrary Gemini endpoints)
  const upstreamPath = path.join("/");
  const ALLOWED_PATH_PREFIXES = ["chat/completions", "models", "embeddings"];
  if (!ALLOWED_PATH_PREFIXES.some((prefix) => upstreamPath === prefix || upstreamPath.startsWith(`${prefix}/`))) {
    return jsonError(`Disallowed proxy path: ${upstreamPath}`, 400);
  }

  // 5. Build upstream URL
  const upstreamUrl = `${GEMINI_BASE}/${upstreamPath}`;

  // 6. Forward headers (strip original auth, inject Gemini key)
  const forwardHeaders = new Headers();
  for (const [key, value] of request.headers.entries()) {
    const lower = key.toLowerCase();
    // Skip hop-by-hop and auth headers
    if (lower === "authorization" || lower === "host" || lower === "connection" || lower === "transfer-encoding") {
      continue;
    }
    forwardHeaders.set(key, value);
  }
  forwardHeaders.set("Authorization", `Bearer ${geminiKey}`);

  // 7. Forward the request (120s timeout prevents hung connections when Gemini is down)
  const fetchInit: RequestInit = {
    method: request.method,
    headers: forwardHeaders,
    signal: AbortSignal.timeout(120_000),
  };

  // Include body for non-GET methods
  if (request.method !== "GET" && request.method !== "HEAD") {
    fetchInit.body = request.body;
    // @ts-expect-error duplex is required for streaming request bodies in Node
    fetchInit.duplex = "half";
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, fetchInit);
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      return jsonError("Upstream request timed out", 504);
    }
    const msg = err instanceof Error ? err.message : String(err);
    return jsonError(`Upstream request failed: ${msg}`, 502);
  }

  // 8. Only count successful upstream responses against rate limit
  // Don't burn quota on Gemini errors (4xx/5xx) or outages
  if (upstream.status < 400) {
    const today = new Date().toISOString().split("T")[0];
    incrementUsage(userId, today);
  }

  // 9. Stream response back
  const responseHeaders = new Headers();
  for (const [key, value] of upstream.headers.entries()) {
    const lower = key.toLowerCase();
    // Skip hop-by-hop headers
    if (lower === "transfer-encoding" || lower === "connection") continue;
    responseHeaders.set(key, value);
  }
  responseHeaders.set("X-RateLimit-Remaining", String(Math.max(0, remaining - 1)));

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export const POST = handleProxy;
export const GET = handleProxy;
