import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { handleIncomingMessage, sendPlivoMessage } from "@/lib/whatsapp";

// --- Plivo Signature Verification ---

const PLIVO_AUTH_TOKEN = process.env.PLIVO_AUTH_TOKEN ?? "";
// Explicit webhook URL avoids all proxy header reconstruction issues.
// Set to the exact URL configured in Plivo Console (e.g. https://clawgent.ai/api/whatsapp/webhook)
const PLIVO_WEBHOOK_URL = process.env.PLIVO_WEBHOOK_URL ?? "";

/** Reconstruct the public-facing URL that Plivo used when computing the signature. */
function getWebhookUrl(req: NextRequest): string {
  // Prefer the explicit env var — guaranteed to match Plivo's signing URL
  if (PLIVO_WEBHOOK_URL) return PLIVO_WEBHOOK_URL;

  // Fallback: reconstruct from forwarded headers (works if proxy headers are correct)
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  const host =
    req.headers.get("x-forwarded-host") ??
    req.headers.get("host") ??
    "localhost";
  const parsed = new URL(req.url);
  return `${proto}://${host}${parsed.pathname}${parsed.search}`;
}

/** Build sorted POST params string for V3 signature (key+value pairs, sorted by key). */
function buildSortedParams(body: string, contentType: string): string {
  const params: Record<string, string> = {};
  if (contentType.includes("application/json")) {
    try {
      const obj = JSON.parse(body);
      for (const [k, v] of Object.entries(obj)) {
        params[k] = String(v);
      }
    } catch {
      // Unparseable — empty params
    }
  } else {
    for (const [k, v] of new URLSearchParams(body).entries()) {
      params[k] = v;
    }
  }
  return Object.keys(params)
    .sort()
    .map((k) => `${k}${params[k]}`)
    .join("");
}

function hmacCompare(baseString: string, expected: string): boolean {
  const computed = createHmac("sha256", PLIVO_AUTH_TOKEN)
    .update(baseString)
    .digest("base64");
  const a = Buffer.from(computed);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function verifyPlivoSignature(req: NextRequest, body: string): boolean {
  if (!PLIVO_AUTH_TOKEN) return false;

  const webhookUrl = getWebhookUrl(req);

  // V3: url + "." + sorted POST params + "." + nonce  (recommended, used by Voice API)
  const v3Sig = req.headers.get("x-plivo-signature-v3");
  const v3Nonce = req.headers.get("x-plivo-signature-v3-nonce");
  if (v3Sig && v3Nonce) {
    const sortedParams = buildSortedParams(
      body,
      req.headers.get("content-type") ?? "",
    );
    if (hmacCompare(`${webhookUrl}.${sortedParams}.${v3Nonce}`, v3Sig))
      return true;
  }

  // V2: url + nonce  (used by Messaging/WhatsApp API)
  const v2Sig = req.headers.get("x-plivo-signature-v2");
  const v2Nonce = req.headers.get("x-plivo-signature-v2-nonce");
  if (v2Sig && v2Nonce) {
    if (hmacCompare(webhookUrl + v2Nonce, v2Sig)) return true;
  }

  console.warn(
    `[whatsapp webhook] Signature mismatch — url=${webhookUrl}, hasV3=${!!v3Sig}, hasV2=${!!v2Sig}`,
  );
  return false;
}

// --- Per-Phone Rate Limiting (in-memory) ---

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 10; // max messages per minute per phone

function isRateLimited(phone: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(phone);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(phone, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) return true;
  return false;
}

// Periodic cleanup of stale rate limit entries
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(key);
  }
}, 5 * 60_000);

// --- Route Handler ---

export async function POST(request: NextRequest) {
  try {
    // Read raw body for signature verification
    const rawBody = await request.text();

    // Verify Plivo signature (skip in dev — URL mismatch behind proxy/ngrok)
    const isDev = process.env.NODE_ENV !== "production";
    if (!isDev && PLIVO_AUTH_TOKEN && !verifyPlivoSignature(request, rawBody)) {
      console.warn("[whatsapp webhook] Invalid Plivo signature — rejecting");
      // Return 200 anyway to not reveal verification to attackers
      return NextResponse.json({ status: "ok" });
    }

    // Parse the body
    const contentType = request.headers.get("content-type") ?? "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: Record<string, any>;

    if (contentType.includes("application/json")) {
      data = JSON.parse(rawBody);
    } else {
      // Form-encoded — parse manually from raw body
      data = {};
      const params = new URLSearchParams(rawBody);
      for (const [key, value] of params.entries()) {
        data[key] = value;
      }
    }

    const from = String(data.From ?? "");
    const messageType = String(data.Type ?? "");
    let text = String(data.Text ?? data.Body ?? "");

    // Extract interactive reply selections (list picks, button taps)
    // Plivo sends interactive replies in an "Interactive" field as a JSON string (PascalCase)
    // Format: {"Type":"list_reply","ListReply":{"Id":"...","Title":"...","Description":"..."}}
    //     or: {"Type":"button_reply","ButtonReply":{"Id":"...","Title":"..."}}
    if (data.Interactive) {
      try {
        const interactive =
          typeof data.Interactive === "string"
            ? JSON.parse(data.Interactive)
            : data.Interactive;
        // Plivo uses PascalCase: Type, ListReply, ButtonReply, Id, Title
        const iType = interactive.Type ?? interactive.type;
        const listReply = interactive.ListReply ?? interactive.list_reply;
        const buttonReply = interactive.ButtonReply ?? interactive.button_reply;

        if (iType === "list_reply" && listReply) {
          const id = listReply.Id ?? listReply.id ?? listReply.Title ?? listReply.title;
          if (id) {
            text = String(id);
            console.log(
              `[whatsapp webhook] List reply: id=${listReply.Id ?? listReply.id} title=${listReply.Title ?? listReply.title}`,
            );
          }
        } else if (iType === "button_reply" && buttonReply) {
          const id = buttonReply.Id ?? buttonReply.id ?? buttonReply.Title ?? buttonReply.title;
          if (id) {
            text = String(id);
            console.log(
              `[whatsapp webhook] Button reply: id=${buttonReply.Id ?? buttonReply.id} title=${buttonReply.Title ?? buttonReply.title}`,
            );
          }
        } else {
          console.log(
            `[whatsapp webhook] Unknown interactive type: ${iType}`,
            JSON.stringify(interactive),
          );
        }
      } catch (e) {
        console.warn(
          `[whatsapp webhook] Failed to parse Interactive field:`,
          data.Interactive,
        );
      }
    }

    if (messageType === "whatsapp" && text && from) {
      // Rate limit per phone number
      if (isRateLimited(from)) {
        console.warn(`[whatsapp webhook] Rate limited: ${maskPhone(from)}`);
        return NextResponse.json({ status: "ok" });
      }

      // Process in background so we return 200 immediately
      processMessage(from, text).catch((err) => {
        console.error("[whatsapp webhook] Processing error:", err);
      });
    }

    return NextResponse.json({ status: "ok" });
  } catch (err) {
    console.error("[whatsapp webhook] Parse error:", err);
    return NextResponse.json({ status: "ok" });
  }
}

// Health check — useful for monitoring
export async function GET() {
  return NextResponse.json({ status: "ok", service: "whatsapp-webhook" });
}

async function processMessage(phone: string, text: string): Promise<void> {
  const response = await handleIncomingMessage(phone, text);
  if (response) {
    await sendPlivoMessage(phone, response);
  }
}

/** Mask phone number for logging: +1234567890 → ***7890 */
function maskPhone(phone: string): string {
  if (phone.length <= 4) return "***";
  return "***" + phone.slice(-4);
}
