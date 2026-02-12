/**
 * Persistent WebSocket listener for proactive OpenClaw notifications.
 *
 * When an instance has an active WA session, maintains a long-lived
 * OpenClawClient connection that listens for unsolicited chat events
 * (heartbeat messages, proactive notifications) and forwards them
 * to WhatsApp via sendPlivoMessage.
 *
 * Filtering: Tracks runIds from user-initiated proxyToOpenClaw calls.
 * Events with unknown runIds are treated as proactive and forwarded.
 */

import { OpenClawClient, extractMessageText } from "./openclaw-client";
import { instances } from "./instances";
import { PERSONA_CONFIGS } from "./personas";
import { dbGetActiveWaSessions, dbGetWaSession } from "./db";

type JsonObject = Record<string, unknown>;

interface ListenerState {
  phone: string;
  instanceId: string;
  port: number;
  token: string;
  client: OpenClawClient;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  stopped: boolean;
}

// Active listeners per instance
const listeners = new Map<string, ListenerState>();

// Tracked outbound run IDs (from user-initiated proxyToOpenClaw calls)
const outboundRuns = new Set<string>();

/** Mark a runId as user-initiated (called before proxyToOpenClaw). */
export function trackOutboundRun(runId: string): void {
  outboundRuns.add(runId);
}

/** Unmark a runId after proxyToOpenClaw completes. */
export function untrackOutboundRun(runId: string): void {
  outboundRuns.delete(runId);
}

function getAgentDisplay(inst: { persona?: string } | undefined): string {
  if (inst?.persona && PERSONA_CONFIGS[inst.persona]) {
    const p = PERSONA_CONFIGS[inst.persona];
    return `${p.emoji} ${p.name}`;
  }
  return "your agent";
}

/** Start a persistent listener for an instance's proactive messages. */
export function startInstanceListener(instanceId: string, port: number, token: string, phone: string): void {
  if (listeners.has(instanceId)) {
    console.log(`[listener] Already listening for instance ${instanceId}`);
    return;
  }

  const client = new OpenClawClient({ port, token, clientId: "wa-proactive-listener" });
  const state: ListenerState = {
    client,
    phone,
    instanceId,
    port,
    token,
    reconnectTimer: null,
    stopped: false,
  };

  listeners.set(instanceId, state);
  connectListener(state, 0);
}

/** Stop the listener for a specific instance. */
export function stopInstanceListener(instanceId: string): void {
  const state = listeners.get(instanceId);
  if (!state) return;

  state.stopped = true;
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
  state.client.close();
  listeners.delete(instanceId);
  console.log(`[listener] Stopped listener for instance ${instanceId}`);
}

/** Stop all listeners (cleanup on shutdown). */
export function stopAllListeners(): void {
  for (const [id] of listeners) {
    stopInstanceListener(id);
  }
}

async function connectListener(state: ListenerState, attempt: number): Promise<void> {
  if (state.stopped) return;

  // Create a fresh client for each connection attempt
  const client = new OpenClawClient({
    port: state.port,
    token: state.token,
    clientId: "wa-proactive-listener",
  });
  state.client = client;

  try {
    await client.connect();
    console.log(`[listener] Connected to instance ${state.instanceId} for proactive WA notifications`);

    const sessionKey = client.sessionKey;

    // Listen for chat events — forward proactive messages to WhatsApp
    client.on("chat", async (payload: unknown) => {
      const p = payload as JsonObject | undefined;
      if (!p) return;

      const runId = p.runId as string | undefined;
      const chatState = p.state as string;

      // Ignore events from user-initiated (outbound) runs
      if (runId && outboundRuns.has(runId)) return;

      if (chatState === "final") {
        try {
          // Fetch history to get the actual assistant message
          const res = await client.request("chat.history", { sessionKey, limit: 5 });
          const messages = (res as JsonObject)?.messages as JsonObject[] | undefined;
          let text: string | null = null;

          if (Array.isArray(messages)) {
            for (let i = messages.length - 1; i >= 0; i--) {
              if (messages[i].role === "assistant") {
                text = extractMessageText(messages[i]);
                if (text) break;
              }
            }
          }

          if (text) {
            const inst = instances.get(state.instanceId);
            const agentDisplay = getAgentDisplay(inst);
            const message = `${text}\n\n— _${agentDisplay}_`;

            // Dynamic import to avoid circular dependency with whatsapp.ts
            const { sendPlivoMessage } = await import("./whatsapp");
            await sendPlivoMessage(state.phone, message);
            console.log(`[listener] Forwarded proactive message from instance ${state.instanceId} to WA`);
          }
        } catch (err) {
          console.error(`[listener] Error forwarding proactive message from ${state.instanceId}:`, err);
        }
      }
    });

    // Listen for connection close to trigger reconnect
    client.on("_close", () => {
      if (state.stopped) return;
      console.log(`[listener] Connection lost for instance ${state.instanceId}, scheduling reconnect`);
      scheduleReconnect(state, 0);
    });

  } catch (err) {
    console.error(`[listener] Connection failed for instance ${state.instanceId}:`, err);
    scheduleReconnect(state, attempt);
  }
}

function scheduleReconnect(state: ListenerState, attempt: number): void {
  if (state.stopped) return;

  // Verify instance still running + WA session still ACTIVE before reconnecting
  const inst = instances.get(state.instanceId);
  if (!inst || inst.status !== "running") {
    console.log(`[listener] Instance ${state.instanceId} no longer running, stopping listener`);
    listeners.delete(state.instanceId);
    state.stopped = true;
    return;
  }

  const waSession = dbGetWaSession(state.phone);
  if (!waSession || waSession.currentState !== "ACTIVE") {
    console.log(`[listener] WA session for ${state.instanceId} no longer ACTIVE, stopping listener`);
    listeners.delete(state.instanceId);
    state.stopped = true;
    return;
  }

  // Exponential backoff: 1s -> 2s -> 4s -> 8s -> 16s -> 30s max
  const delay = Math.min(1000 * Math.pow(2, attempt), 30_000);
  console.log(`[listener] Reconnecting to instance ${state.instanceId} in ${delay}ms (attempt ${attempt + 1})`);

  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    connectListener(state, attempt + 1);
  }, delay);

  // Don't block process exit
  if (state.reconnectTimer && typeof state.reconnectTimer === "object" && "unref" in state.reconnectTimer) {
    (state.reconnectTimer as NodeJS.Timeout).unref();
  }
}

/**
 * Bootstrap listeners on server startup.
 * Scans ACTIVE WA sessions with running instances and starts listeners.
 */
export function bootstrapListeners(): void {
  try {
    const activeSessions = dbGetActiveWaSessions();
    let started = 0;

    for (const session of activeSessions) {
      if (!session.instanceId) continue;

      const inst = instances.get(session.instanceId);
      if (!inst || inst.status !== "running") continue;

      startInstanceListener(inst.id, inst.port, inst.token, session.phone);
      started++;
    }

    if (started > 0) {
      console.log(`[listener] Bootstrapped ${started} proactive listener(s)`);
    }
  } catch (err) {
    console.error("[listener] Bootstrap error:", err);
  }
}
