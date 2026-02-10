/**
 * OpenClaw WebSocket client for server-side communication with OpenClaw containers.
 *
 * Protocol: JSON-RPC over WebSocket (protocol v3)
 *   Request:  { type: "req", id: uuid, method: string, params: unknown }
 *   Response: { type: "res", id: uuid, ok: boolean, payload?: unknown, error?: { message: string } }
 *   Event:    { type: "event", event: string, payload?: unknown }
 *
 * Connection flow:
 *   1. Open WebSocket to ws://127.0.0.1:{port}/?token={token}
 *   2. Server may send connect.challenge event
 *   3. Client sends "connect" request with auth
 *   4. Server responds with hello (snapshot, sessionDefaults, etc.)
 */

import WS from "ws";

// --- Types ---

export interface OpenClawConnectOptions {
  port: number;
  token: string;
  clientId?: string;
}

export interface OpenClawChatOptions {
  sessionKey?: string;
  timeout?: number;
}

type JsonObject = Record<string, unknown>;
type PendingRequest = { resolve: (v: unknown) => void; reject: (e: Error) => void };

// --- Message text extraction ---

/** Extract plain text from an OpenClaw message object (handles string content and content block arrays). */
export function extractMessageText(message: unknown): string | null {
  if (!message || typeof message !== "object") return null;
  const msg = message as JsonObject;
  const content = msg.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const texts = content
      .filter((c: unknown) => {
        const block = c as JsonObject;
        return block.type === "text" && typeof block.text === "string";
      })
      .map((c: unknown) => (c as JsonObject).text as string);
    return texts.length > 0 ? texts.join("\n") : null;
  }
  if (typeof msg.text === "string") return msg.text;
  return null;
}

// --- Client ---

export class OpenClawClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private eventListeners = new Map<string, Array<(payload: unknown) => void>>();
  private _sessionKey = "agent:main:main";
  private _connected = false;

  readonly port: number;
  readonly token: string;
  readonly clientId: string;

  constructor(options: OpenClawConnectOptions) {
    this.port = options.port;
    this.token = options.token;
    this.clientId = options.clientId ?? "openclaw-control-ui";
  }

  /** The session key resolved from the server hello (available after connect). */
  get sessionKey(): string { return this._sessionKey; }

  /** Whether the client is connected and authenticated. */
  get connected(): boolean { return this._connected; }

  /** Open WebSocket, authenticate, and return the hello response. */
  connect(): Promise<JsonObject> {
    const wsUrl = `ws://localhost:${this.port}/?token=${encodeURIComponent(this.token)}`;

    return new Promise<JsonObject>((resolve, reject) => {
      let connectSent = false;
      let connectTimer: ReturnType<typeof setTimeout> | null = null;

      const origin = process.env.NODE_ENV === "production"
        ? "https://clawgent.ai"
        : `http://localhost:${process.env.PORT ?? 3001}`;
      const ws = new WS(wsUrl, { origin });
      this.ws = ws as unknown as WebSocket;

      const doConnect = () => {
        if (connectSent) return;
        connectSent = true;
        if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }

        this.request("connect", {
          minProtocol: 3,
          maxProtocol: 3,
          client: { id: this.clientId, version: "1.0", platform: "server", mode: "webchat" },
          role: "operator",
          scopes: ["operator.admin"],
          caps: [],
          auth: { token: this.token },
        })
          .then((hello) => {
            this._connected = true;
            const h = hello as JsonObject | null;
            const defaults = (h?.snapshot as JsonObject)?.sessionDefaults as JsonObject | undefined;
            if (defaults?.mainSessionKey && typeof defaults.mainSessionKey === "string") {
              this._sessionKey = defaults.mainSessionKey;
            }
            resolve((hello as JsonObject) ?? {});
          })
          .catch(reject);
      };

      ws.addEventListener("open", () => {
        connectTimer = setTimeout(doConnect, 750);
      });

      ws.addEventListener("message", (event) => {
        let data: JsonObject;
        try { data = JSON.parse(String(event.data)); } catch { return; }

        if (data.type === "res") {
          const p = this.pending.get(data.id as string);
          if (p) {
            this.pending.delete(data.id as string);
            if (data.ok) p.resolve(data.payload);
            else p.reject(new Error((data.error as JsonObject)?.message as string ?? "request failed"));
          }
          return;
        }

        if (data.type === "event") {
          const eventName = data.event as string;
          if (eventName === "connect.challenge") { doConnect(); return; }
          this.eventListeners.get(eventName)?.forEach((fn) => fn(data.payload));
        }
      });

      ws.addEventListener("error", (err) => {
        if (!this._connected) reject(new Error("WebSocket connection failed"));
      });

      ws.addEventListener("close", () => {
        this._connected = false;
        for (const [, p] of this.pending) p.reject(new Error("connection closed"));
        this.pending.clear();
      });
    });
  }

  /** Send a JSON-RPC request and wait for the response. */
  request(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error("not connected"));
      }
      const id = crypto.randomUUID();
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ type: "req", id, method, params }));
    });
  }

  /** Subscribe to gateway events (chat, agent, presence, etc.). */
  on(event: string, handler: (payload: unknown) => void): void {
    const list = this.eventListeners.get(event) ?? [];
    list.push(handler);
    this.eventListeners.set(event, list);
  }

  /** Remove an event listener. */
  off(event: string, handler: (payload: unknown) => void): void {
    const list = this.eventListeners.get(event);
    if (!list) return;
    const idx = list.indexOf(handler);
    if (idx >= 0) list.splice(idx, 1);
  }

  /** Close the WebSocket connection. */
  close(): void {
    this._connected = false;
    try { this.ws?.close(); } catch { /* ignore */ }
    this.ws = null;
  }

  /**
   * Send a chat message and wait for the complete response text.
   * Opens a temporary event listener, waits for the final chat event,
   * fetches history, and returns the assistant's reply.
   */
  async sendChat(message: string, options?: OpenClawChatOptions): Promise<string> {
    const timeout = options?.timeout ?? 120_000;
    const sk = options?.sessionKey ?? this._sessionKey;
    const runId = crypto.randomUUID();

    return new Promise<string>((resolve) => {
      let done = false;
      let lastDelta = "";

      const finish = (text: string) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.off("chat", onChat);
        resolve(text);
      };

      const timer = setTimeout(() => {
        finish(lastDelta || "agent took too long to respond.");
      }, timeout);

      const onChat = (payload: unknown) => {
        const p = payload as JsonObject | undefined;
        if (!p) return;
        if (runId && p.runId && p.runId !== runId) return;

        const state = p.state as string;

        if (state === "delta") {
          const text = extractMessageText(p.message);
          if (text && text.length >= lastDelta.length) lastDelta = text;
        }

        if (state === "final") {
          this.request("chat.history", { sessionKey: sk, limit: 10 })
            .then((res) => {
              const messages = (res as JsonObject)?.messages as JsonObject[] | undefined;
              if (Array.isArray(messages)) {
                for (let i = messages.length - 1; i >= 0; i--) {
                  if (messages[i].role === "assistant") {
                    const text = extractMessageText(messages[i]);
                    if (text) { finish(text); return; }
                  }
                }
              }
              finish(lastDelta || "agent had nothing to say.");
            })
            .catch(() => finish(lastDelta || "agent had nothing to say."));
        }

        if (state === "error") {
          finish((p.errorMessage as string) ?? "agent error.");
        }

        if (state === "aborted") {
          finish(lastDelta || "agent response was cut short.");
        }
      };

      this.on("chat", onChat);

      this.request("chat.send", {
        sessionKey: sk,
        message,
        deliver: false,
        idempotencyKey: runId,
      }).catch((err) => {
        finish(`failed to send message: ${err.message}`);
      });
    });
  }
}

// --- Convenience: one-shot send ---

/**
 * Connect to an OpenClaw container, send a chat message, return the response, disconnect.
 * Suitable for stateless integrations (WhatsApp, Telegram, API, etc.).
 */
export async function sendChatMessage(
  options: OpenClawConnectOptions & { message: string; sessionKey?: string; timeout?: number },
): Promise<string> {
  const client = new OpenClawClient(options);
  try {
    await client.connect();
    return await client.sendChat(options.message, {
      sessionKey: options.sessionKey,
      timeout: options.timeout,
    });
  } finally {
    client.close();
  }
}
