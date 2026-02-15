"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";

// ─── A2UI Types ─────────────────────────────────────────────────────

interface A2UITextComponent {
  Text: {
    text: { literalString: string };
    usageHint?: "h1" | "h2" | "body" | "caption";
  };
}

interface A2UIColumnComponent {
  Column: {
    children: { explicitList: string[] };
  };
}

interface A2UIRowComponent {
  Row: {
    children: { explicitList: string[] };
  };
}

interface A2UIButtonAction {
  name: string;
  context?: Array<{ key: string; value: { path?: string; literalString?: string } }>;
}

interface A2UIButtonComponent {
  Button: {
    child: string;              // Component ID for button label (usually a Text)
    primary?: boolean;
    action: A2UIButtonAction;
  };
}

interface A2UILinkComponent {
  Link: {
    text: { literalString: string };
    actionName: string;
    usageHint?: "nav" | "inline";
  };
}

interface A2UIDividerComponent {
  Divider: {
    axis?: "horizontal" | "vertical";
  };
}

type A2UIComponentDef =
  | A2UITextComponent
  | A2UIColumnComponent
  | A2UIRowComponent
  | A2UIButtonComponent
  | A2UILinkComponent
  | A2UIDividerComponent;

interface A2UIComponent {
  id: string;
  component: A2UIComponentDef;
}

interface SurfaceUpdateEvent {
  surfaceUpdate: {
    surfaceId: string;
    components: A2UIComponent[];
  };
}

interface BeginRenderingEvent {
  beginRendering: {
    surfaceId: string;
    root: string;
  };
}

interface DeleteSurfaceEvent {
  deleteSurface: {
    surfaceId: string;
  };
}

interface DataModelUpdateEvent {
  dataModelUpdate: {
    surfaceId: string;
    data: Record<string, unknown>;
  };
}

type A2UIEvent =
  | SurfaceUpdateEvent
  | BeginRenderingEvent
  | DeleteSurfaceEvent
  | DataModelUpdateEvent;

interface Surface {
  id: string;
  root: string | null;
  components: Map<string, A2UIComponent>;
  data: Record<string, unknown>;
}

// ─── A2UI Event Parser ──────────────────────────────────────────────

function parseA2UIEvents(raw: string): A2UIEvent[] {
  const events: A2UIEvent[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (
        parsed.surfaceUpdate ||
        parsed.beginRendering ||
        parsed.deleteSurface ||
        parsed.dataModelUpdate
      ) {
        events.push(parsed as A2UIEvent);
      }
    } catch {
      // Skip non-JSON lines
    }
  }
  return events;
}

// Extract A2UI JSONL from ```a2ui fenced code blocks in chat text
function extractA2UIFromCodeFence(text: string): A2UIEvent[] {
  const events: A2UIEvent[] = [];
  // Match ```a2ui ... ``` blocks (case-insensitive, multiline)
  const fenceRegex = /```a2ui\s*\n([\s\S]*?)```/gi;
  let match;
  while ((match = fenceRegex.exec(text)) !== null) {
    const block = match[1];
    events.push(...parseA2UIEvents(block));
  }
  return events;
}

// ─── Component Renderers ────────────────────────────────────────────

function RenderComponent({
  componentId,
  components,
  onAction,
  surfaceId,
}: {
  componentId: string;
  components: Map<string, A2UIComponent>;
  onAction?: (actionName: string, surfaceId: string) => void;
  surfaceId?: string;
}) {
  const entry = components.get(componentId);
  if (!entry) return null;

  const def = entry.component;

  if ("Text" in def) {
    const { text, usageHint } = def.Text;
    const content = text.literalString;
    switch (usageHint) {
      case "h1":
        return (
          <h1
            className="pixel-font arcade-text"
            style={{
              fontSize: "14px",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--arcade-yellow)",
              margin: "0 0 4px",
              lineHeight: 1.4,
            }}
          >
            {content}
          </h1>
        );
      case "h2":
        return (
          <h2
            className="pixel-font arcade-text"
            style={{
              fontSize: "10px",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--arcade-blue)",
              margin: "0 0 2px",
              lineHeight: 1.4,
            }}
          >
            {content}
          </h2>
        );
      case "caption":
        return (
          <span
            style={{
              fontSize: "11px",
              color: "rgba(255,255,255,0.35)",
              fontFamily: "var(--font-mono, monospace)",
              lineHeight: 1.5,
            }}
          >
            {content}
          </span>
        );
      default:
        // "body" or unspecified
        return (
          <p
            style={{
              fontSize: "13px",
              color: "rgba(255,255,255,0.75)",
              margin: 0,
              lineHeight: 1.6,
              fontFamily: "var(--font-mono, monospace)",
            }}
          >
            {content}
          </p>
        );
    }
  }

  if ("Button" in def) {
    const { child, primary, action } = def.Button;
    const isPrimary = primary !== false; // default true
    const style = isPrimary
      ? { bg: "rgba(0,200,83,0.15)", border: "var(--arcade-green)", glow: "0 0 6px var(--arcade-green)" }
      : { bg: "rgba(0,170,255,0.10)", border: "var(--arcade-blue)", glow: "none" };
    return (
      <button
        onClick={() => onAction?.(action.name, surfaceId || "")}
        className="pixel-font"
        style={{
          fontSize: "9px",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: style.border,
          background: style.bg,
          border: `2px solid ${style.border}`,
          padding: "8px 16px",
          cursor: "pointer",
          boxShadow: style.glow,
          transition: "background 0.15s, box-shadow 0.15s",
          fontFamily: "inherit",
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = style.border;
          e.currentTarget.style.color = "#000";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = style.bg;
          e.currentTarget.style.color = style.border;
        }}
      >
        <RenderComponent componentId={child} components={components} onAction={onAction} surfaceId={surfaceId} />
      </button>
    );
  }

  if ("Link" in def) {
    const { text, actionName, usageHint } = def.Link;
    const isNav = usageHint === "nav";
    return (
      <span
        onClick={() => onAction?.(actionName, surfaceId || "")}
        style={{
          fontSize: isNav ? "12px" : "13px",
          color: "var(--arcade-blue)",
          fontFamily: "var(--font-mono, monospace)",
          cursor: "pointer",
          textDecoration: "none",
          lineHeight: 1.6,
          display: isNav ? "block" : "inline",
          padding: isNav ? "4px 0" : "0",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
        onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
      >
        {text.literalString}
      </span>
    );
  }

  if ("Divider" in def) {
    return (
      <hr
        style={{
          border: "none",
          borderTop: "1px solid var(--arcade-border-color, rgba(255,255,255,0.12))",
          margin: "8px 0",
          width: "100%",
        }}
      />
    );
  }

  if ("Column" in def) {
    const childIds = def.Column.children.explicitList;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {childIds.map((cid) => (
          <RenderComponent key={cid} componentId={cid} components={components} onAction={onAction} surfaceId={surfaceId} />
        ))}
      </div>
    );
  }

  if ("Row" in def) {
    const childIds = def.Row.children.explicitList;
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          gap: "12px",
          flexWrap: "wrap",
          alignItems: "flex-start",
        }}
      >
        {childIds.map((cid) => (
          <RenderComponent key={cid} componentId={cid} components={components} onAction={onAction} surfaceId={surfaceId} />
        ))}
      </div>
    );
  }

  return null;
}

// ─── Surface Renderer ───────────────────────────────────────────────

function SurfaceView({ surface, onAction }: { surface: Surface; onAction?: (actionName: string, surfaceId: string) => void }) {
  if (!surface.root) {
    return (
      <div
        className="arcade-panel"
        style={{ padding: "16px", opacity: 0.5 }}
      >
        <span
          className="pixel-font"
          style={{ fontSize: "8px", color: "rgba(255,255,255,0.3)" }}
        >
          SURFACE {surface.id} — AWAITING RENDER
        </span>
      </div>
    );
  }

  return (
    <div className="arcade-panel" style={{ padding: "16px" }}>
      <RenderComponent
        componentId={surface.root}
        components={surface.components}
        onAction={onAction}
        surfaceId={surface.id}
      />
    </div>
  );
}

// ─── Connection Status ──────────────────────────────────────────────

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

// ─── Main Canvas Page ───────────────────────────────────────────────

export default function CanvasPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const tokenFromUrl = searchParams.get("token");

  const [surfaces, setSurfaces] = useState<Map<string, Surface>>(new Map());
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const surfacesRef = useRef<Map<string, Surface>>(new Map());
  const sessionKeyRef = useRef<string | null>(null);

  const processEvent = useCallback((event: A2UIEvent) => {
    const current = surfacesRef.current;

    if ("surfaceUpdate" in event) {
      const { surfaceId, components } = event.surfaceUpdate;
      let surface = current.get(surfaceId);
      if (!surface) {
        surface = {
          id: surfaceId,
          root: null,
          components: new Map(),
          data: {},
        };
      }
      for (const comp of components) {
        surface.components.set(comp.id, comp);
      }
      // Auto-detect root: if no root is set yet and a component named "root" exists, use it
      if (!surface.root) {
        if (surface.components.has("root")) {
          surface.root = "root";
        } else if (components.length > 0) {
          // Use the first component as root fallback
          surface.root = components[0].id;
        }
      }
      current.set(surfaceId, surface);
      surfacesRef.current = new Map(current);
      setSurfaces(new Map(current));
    }

    if ("beginRendering" in event) {
      const { surfaceId, root } = event.beginRendering;
      const surface = current.get(surfaceId);
      if (surface) {
        surface.root = root;
        current.set(surfaceId, surface);
        surfacesRef.current = new Map(current);
        setSurfaces(new Map(current));
      }
    }

    if ("deleteSurface" in event) {
      const { surfaceId } = event.deleteSurface;
      current.delete(surfaceId);
      surfacesRef.current = new Map(current);
      setSurfaces(new Map(current));
    }

    if ("dataModelUpdate" in event) {
      const { surfaceId, data } = event.dataModelUpdate;
      const surface = current.get(surfaceId);
      if (surface) {
        surface.data = { ...surface.data, ...data };
        current.set(surfaceId, surface);
        surfacesRef.current = new Map(current);
        setSurfaces(new Map(current));
      }
    }
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    // Read token from localStorage (set by proxy.ts injection or from URL param)
    let token = tokenFromUrl;
    if (!token) {
      try {
        const settings = JSON.parse(localStorage.getItem("openclaw.control.settings.v1") || "{}");
        token = settings.token || null;
      } catch { /* ignore */ }
    }
    const wsUrl = `${proto}//${host}/i/${id}/${token ? `?token=${token}` : ""}`;
    setStatus("connecting");

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    let handshakeComplete = false;

    ws.onopen = () => {
      // Don't set "connected" yet — wait for handshake to complete
      setErrorMsg(null);
    };

    ws.onmessage = (msg) => {
      if (typeof msg.data !== "string") return;

      try {
        const frame = JSON.parse(msg.data);

        // Handle OpenClaw gateway handshake
        if (!handshakeComplete) {
          // Step 1: Receive connect.challenge, send connect request
          if (frame.type === "event" && frame.event === "connect.challenge") {
            const connectReq = {
              type: "req",
              id: "canvas-connect",
              method: "connect",
              params: {
                minProtocol: 3,
                maxProtocol: 3,
                client: {
                  id: "webchat-ui",
                  version: "1.0.0",
                  platform: "web",
                  mode: "webchat",
                },
                auth: { token: token || "" },
              },
            };
            ws.send(JSON.stringify(connectReq));
            return;
          }

          // Step 2: Receive connect response
          if (frame.type === "res" && frame.id === "canvas-connect") {
            if (frame.ok) {
              handshakeComplete = true;
              setStatus("connected");
              // Extract sessionKey for sending canvas actions back to agent
              try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (window as any).__canvasConnectFrame = frame;
                const result = frame.result || frame.data || frame.payload || frame;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (window as any).__canvasConnectResult = result;
                const mainKey = result?.snapshot?.sessionDefaults?.mainSessionKey
                  || result?.sessionDefaults?.mainSessionKey
                  || result?.mainSessionKey;
                if (mainKey) {
                  sessionKeyRef.current = mainKey;
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (window as any).__canvasSessionKey = mainKey;
                } else {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (window as any).__canvasSessionKey = "NOT_FOUND";
                }
              } catch { /* ignore missing sessionKey */ }
            } else {
              setStatus("error");
              setErrorMsg(frame.error?.message || "Connect failed");
            }
            return;
          }
        }

        // After handshake: look for A2UI events in any message
        // A2UI can arrive as direct JSONL or embedded in chat/event frames
        if (frame.surfaceUpdate || frame.beginRendering || frame.deleteSurface || frame.dataModelUpdate) {
          processEvent(frame as A2UIEvent);
          return;
        }

        // Check for A2UI in chat message events
        // Gateway format: { type: "event", event: "chat", payload: { state, message: { content } } }
        if (frame.type === "event" && frame.event === "chat" && frame.payload) {
          const payload = frame.payload;
          // Only process final messages (not streaming deltas)
          if (payload.state === "final" && payload.message) {
            const content = payload.message.content;
            let textContent = "";

            // content can be string or array of content blocks
            if (typeof content === "string") {
              textContent = content;
            } else if (Array.isArray(content)) {
              textContent = content
                .filter((c: { type: string; text?: string }) => c.type === "text" && typeof c.text === "string")
                .map((c: { text: string }) => c.text)
                .join("\n");
            }

            // Extract ```a2ui fenced code blocks from chat text
            if (textContent) {
              const fenceEvents = extractA2UIFromCodeFence(textContent);
              for (const event of fenceEvents) {
                processEvent(event);
              }
            }
          }
        }

        // Also check any event payload for raw A2UI JSONL
        if (frame.type === "event" && frame.payload) {
          const payloadStr = typeof frame.payload === "string" ? frame.payload : JSON.stringify(frame.payload);
          const a2uiEvents = parseA2UIEvents(payloadStr);
          for (const event of a2uiEvents) {
            processEvent(event);
          }
        }
      } catch {
        // Not JSON — try parsing as raw A2UI JSONL or code fences
        const events = parseA2UIEvents(msg.data);
        for (const event of events) {
          processEvent(event);
        }
        // Also check for ```a2ui fenced code blocks
        const fenceEvents = extractA2UIFromCodeFence(msg.data);
        for (const event of fenceEvents) {
          processEvent(event);
        }
      }
    };

    ws.onerror = () => {
      setStatus("error");
      setErrorMsg("WebSocket connection error");
    };

    ws.onclose = (e) => {
      setStatus("disconnected");
      wsRef.current = null;

      // Auto-reconnect after 3 seconds (unless intentionally closed)
      if (e.code !== 1000) {
        reconnectTimer.current = setTimeout(() => {
          connect();
        }, 3000);
      }
    };
  }, [id, tokenFromUrl, processEvent]);

  const sendCanvasAction = useCallback((actionName: string, surfaceId: string) => {
    const ws = wsRef.current;
    const sessionKey = sessionKeyRef.current;
    console.log("[Canvas] Action clicked:", actionName, "surface:", surfaceId, "ws:", !!ws, "wsState:", ws?.readyState, "sessionKey:", sessionKey);
    if (!ws || ws.readyState !== WebSocket.OPEN || !sessionKey) return;

    const req = {
      type: "req",
      id: `canvas-action-${Date.now()}`,
      method: "chat.send",
      params: {
        sessionKey,
        message: `[Canvas] ${actionName}`,
      },
    };
    ws.send(JSON.stringify(req));
  }, []);

  useEffect(() => {
    // Store token in localStorage for OpenClaw auth (consistent with proxy.ts)
    if (tokenFromUrl) {
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const host = window.location.host;
      const gatewayUrl = `${proto}://${host}/i/${id}/`;
      const settingsData = JSON.stringify({
        gatewayUrl,
        token: tokenFromUrl,
      });
      localStorage.setItem("openclaw.control.settings.v1", settingsData);
    }

    connect();

    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.close(1000);
        wsRef.current = null;
      }
    };
  }, [connect, id, tokenFromUrl]);

  const statusColor: Record<ConnectionStatus, string> = {
    connecting: "var(--arcade-yellow)",
    connected: "var(--arcade-green)",
    disconnected: "var(--arcade-red)",
    error: "var(--arcade-red)",
  };

  const surfaceList = Array.from(surfaces.values());

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: "16px",
        maxWidth: "960px",
        margin: "0 auto",
      }}
    >
      {/* Header bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "16px",
          padding: "12px 16px",
          border: "2px solid var(--arcade-border-color)",
          background: "var(--arcade-bg-panel)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span
            className="pixel-font"
            style={{
              fontSize: "10px",
              letterSpacing: "0.12em",
              color: "var(--arcade-yellow)",
              textTransform: "uppercase",
            }}
          >
            CANVAS
          </span>
          <span
            style={{
              fontSize: "11px",
              color: "rgba(255,255,255,0.3)",
              fontFamily: "var(--font-mono, monospace)",
            }}
          >
            {id.slice(0, 8)}...
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div
            style={{
              width: "8px",
              height: "8px",
              background: statusColor[status],
              boxShadow: status === "connected"
                ? `0 0 4px ${statusColor[status]}`
                : "none",
            }}
          />
          <span
            className="pixel-font"
            style={{
              fontSize: "7px",
              color: statusColor[status],
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            {status}
          </span>
        </div>
      </div>

      {/* Error message */}
      {errorMsg && (
        <div
          style={{
            padding: "12px 16px",
            marginBottom: "12px",
            border: "2px solid var(--arcade-red)",
            background: "rgba(216,32,32,0.08)",
          }}
        >
          <span
            className="pixel-font"
            style={{
              fontSize: "8px",
              color: "var(--arcade-red)",
            }}
          >
            {errorMsg}
          </span>
        </div>
      )}

      {/* Surfaces */}
      {surfaceList.length === 0 ? (
        <div
          className="arcade-panel"
          style={{
            padding: "48px 24px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "16px",
          }}
        >
          <span style={{ fontSize: "32px" }}>📡</span>
          <span
            className="pixel-font"
            style={{
              fontSize: "9px",
              color: "rgba(255,255,255,0.3)",
              letterSpacing: "0.12em",
              textAlign: "center",
              lineHeight: 2,
            }}
          >
            {status === "connected"
              ? "WAITING FOR CANVAS DATA..."
              : status === "connecting"
                ? "CONNECTING TO INSTANCE..."
                : "RECONNECTING..."}
          </span>
          {status === "connected" && (
            <span
              style={{
                fontSize: "11px",
                color: "rgba(255,255,255,0.2)",
                fontFamily: "var(--font-mono, monospace)",
                textAlign: "center",
                maxWidth: "360px",
                lineHeight: 1.5,
              }}
            >
              Canvas views will appear here when your agent uses the canvas
              tool to render A2UI components.
            </span>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {surfaceList.map((surface) => (
            <SurfaceView key={surface.id} surface={surface} onAction={sendCanvasAction} />
          ))}
        </div>
      )}

      {/* Back link */}
      <div style={{ marginTop: "24px", textAlign: "center" }}>
        <a
          href={`/i/${id}/${tokenFromUrl ? `?token=${tokenFromUrl}` : ""}`}
          style={{
            fontSize: "11px",
            color: "var(--arcade-blue)",
            fontFamily: "var(--font-mono, monospace)",
            textDecoration: "none",
          }}
        >
          ← Back to instance
        </a>
      </div>
    </div>
  );
}
