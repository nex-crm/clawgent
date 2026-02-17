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

// ─── Utilities ─────────────────────────────────────────────────────

function stripNumberPrefix(text: string): string {
  return text.replace(/^\[\d+\]\s*/, "");
}

// ─── Loading Skeleton ──────────────────────────────────────────────

function LoadingSkeleton({ label, lines = 5 }: { label?: string; lines?: number }) {
  const widths = ["85%", "60%", "72%", "45%", "90%", "55%"];
  return (
    <div className="arcade-panel" style={{ padding: "20px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
      {label && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
          <div style={{
            width: "6px", height: "6px",
            background: "var(--arcade-yellow)",
            animation: "canvas-pulse 1s ease-in-out infinite",
          }} />
          <span className="pixel-font" style={{
            fontSize: "8px", letterSpacing: "0.1em", textTransform: "uppercase",
            color: "var(--arcade-yellow)", animation: "canvas-pulse 1.5s ease-in-out infinite",
          }}>
            {label}
          </span>
        </div>
      )}
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          style={{
            height: "12px",
            width: widths[i % widths.length],
            background: "rgba(255,255,255,0.06)",
            animation: "canvas-pulse 1.5s ease-in-out infinite",
            animationDelay: `${i * 0.15}s`,
          }}
        />
      ))}
    </div>
  );
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
    const label = stripNumberPrefix(text.literalString);
    if (isNav) {
      return (
        <span
          onClick={() => onAction?.(actionName, surfaceId || "")}
          className="pixel-font"
          style={{
            fontSize: "9px",
            letterSpacing: "0.08em",
            color: "var(--arcade-blue)",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            border: "1px solid var(--arcade-blue)",
            padding: "4px 10px",
            marginRight: "6px",
            marginBottom: "4px",
            textTransform: "uppercase",
            transition: "background 0.15s, border-color 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "var(--arcade-yellow)";
            e.currentTarget.style.background = "rgba(0,160,248,0.08)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--arcade-blue)";
            e.currentTarget.style.background = "transparent";
          }}
        >
          {label}
        </span>
      );
    }
    return (
      <span
        onClick={() => onAction?.(actionName, surfaceId || "")}
        style={{
          fontSize: "13px",
          color: "var(--arcade-blue)",
          fontFamily: "var(--font-mono, monospace)",
          cursor: "pointer",
          textDecoration: "none",
          lineHeight: 1.6,
          display: "inline",
          padding: "0",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
        onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
      >
        {label}
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
    const isCard = /^(tc-|ins-|fu-|s\d+-d)/.test(componentId);
    const cardStyle = isCard
      ? { padding: "10px 12px", border: "1px solid var(--arcade-border-color)", background: "rgba(255,255,255,0.02)", marginBottom: "2px" }
      : {};
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", ...cardStyle }}>
        {childIds.map((cid) => (
          <RenderComponent key={cid} componentId={cid} components={components} onAction={onAction} surfaceId={surfaceId} />
        ))}
      </div>
    );
  }

  if ("Row" in def) {
    const childIds = def.Row.children.explicitList;
    const isKanban = componentId === "board" && childIds.length >= 3;
    return (
      <div
        className={isKanban ? "canvas-kanban-scroll" : undefined}
        style={{
          display: "flex",
          flexDirection: "row",
          gap: "12px",
          flexWrap: isKanban ? "nowrap" : "wrap",
          alignItems: "flex-start",
          ...(isKanban ? { overflowX: "auto", paddingBottom: "4px" } : {}),
        }}
      >
        {childIds.map((cid) => (
          <div key={cid} style={isKanban ? { minWidth: "200px", flex: "1 0 200px" } : undefined}>
            <RenderComponent componentId={cid} components={components} onAction={onAction} surfaceId={surfaceId} />
          </div>
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
  const connectRef = useRef<() => void>(() => {});
  const surfacesRef = useRef<Map<string, Surface>>(new Map());
  const sessionKeyRef = useRef<string | null>(null);

  const NAV_ITEMS = [
    { id: "digest", label: "HOME", icon: "\u{1F3E0}", actionName: "view-digest" },
    { id: "pipeline", label: "PIPELINE", icon: "\u{1F4CA}", actionName: "view-pipeline" },
    { id: "followups", label: "FOLLOW-UPS", icon: "\u{23F0}", actionName: "view-followups" },
    { id: "insights", label: "INSIGHTS", icon: "\u{1F4A1}", actionName: "view-insights" },
  ];

  const [currentView, setCurrentView] = useState("digest");
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

      // Update currentView to show the incoming surface
      setCurrentView(surfaceId);
      setIsTransitioning(false);
      if (transitionTimer.current) {
        clearTimeout(transitionTimer.current);
        transitionTimer.current = null;
      }
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
                  setErrorMsg("Session key not found — Canvas interactions may not work");
                }
              } catch { /* ignore missing sessionKey */ }
            } else {
              setStatus("error");
              setErrorMsg(frame.error?.message || "Connect failed");
            }
            return;
          }
        }

        // Canvas action acknowledgment
        if (frame.type === "res" && typeof frame.id === "string" && frame.id.startsWith("canvas-action-")) {
          if (frame.ok) {
            console.log("[Canvas] Action acknowledged:", frame.id);
          } else {
            const errMsg = frame.error?.message || "Action failed";
            console.warn("[Canvas] Action failed:", frame.id, errMsg);
            setErrorMsg(errMsg);
            setTimeout(() => setErrorMsg(null), 3000);
          }
          return;
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
      setIsTransitioning(false);
    };

    ws.onclose = (e) => {
      setStatus("disconnected");
      setIsTransitioning(false);
      wsRef.current = null;

      // Auto-reconnect after 3 seconds (unless intentionally closed)
      if (e.code !== 1000) {
        reconnectTimer.current = setTimeout(() => {
          connectRef.current();
        }, 3000);
      }
    };
  }, [id, tokenFromUrl, processEvent]);

  // Keep connectRef in sync so reconnect always uses latest
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  const sendCanvasAction = useCallback((actionName: string, _surfaceId?: string) => {
    const ws = wsRef.current;
    const sessionKey = sessionKeyRef.current;

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn("[Canvas] WS not open, state:", ws?.readyState, "— queueing retry");
      // Retry once after 2s (WS may be reconnecting)
      setTimeout(() => {
        const ws2 = wsRef.current;
        const sk2 = sessionKeyRef.current;
        if (ws2 && ws2.readyState === WebSocket.OPEN && sk2) {
          const retryId = `canvas-action-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          ws2.send(JSON.stringify({
            type: "req", id: retryId, method: "chat.send",
            params: { sessionKey: sk2, message: `[Canvas] ${actionName}`, idempotencyKey: retryId },
          }));
          setLastAction(actionName);
          setTimeout(() => setLastAction(null), 3000);
        } else {
          setErrorMsg("Not connected — reload the page");
          setTimeout(() => setErrorMsg(null), 4000);
        }
      }, 2000);
      return;
    }
    if (!sessionKey) {
      setErrorMsg("No session key — open chat first, then reload canvas");
      setTimeout(() => setErrorMsg(null), 5000);
      return;
    }

    setLastAction(actionName);
    setTimeout(() => setLastAction(null), 3000);

    // Show loading skeleton for navigation-type actions (view changes, browse, back)
    const isNavAction = /^(view-|browse-|list-|back-|record-|search$)/.test(actionName);
    if (isNavAction) {
      setIsTransitioning(true);
      if (transitionTimer.current) clearTimeout(transitionTimer.current);
      transitionTimer.current = setTimeout(() => setIsTransitioning(false), 30000);
    }

    const actionId = `canvas-action-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const req = {
      type: "req",
      id: actionId,
      method: "chat.send",
      params: {
        sessionKey,
        message: `[Canvas] ${actionName}`,
        idempotencyKey: actionId,
      },
    };
    ws.send(JSON.stringify(req));
  }, []);

  const handleNavClick = useCallback((viewId: string, actionName: string) => {
    setCurrentView(viewId);
    setIsTransitioning(true);
    if (transitionTimer.current) clearTimeout(transitionTimer.current);
    transitionTimer.current = setTimeout(() => {
      setIsTransitioning(false);
    }, 30000);
    sendCanvasAction(actionName);
  }, [sendCanvasAction]);

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
      {/* Condensed status bar + sticky nav */}
      <div style={{ position: "sticky", top: 0, zIndex: 10, background: "var(--arcade-bg)" }}>
        {/* Status bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "6px 16px",
            borderBottom: "1px solid var(--arcade-border-color)",
          }}
        >
          <span className="pixel-font" style={{ fontSize: "8px", letterSpacing: "0.1em", color: "var(--arcade-yellow)" }}>CANVAS</span>
          <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.2)", fontFamily: "var(--font-mono, monospace)" }}>|</span>
          <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.25)", fontFamily: "var(--font-mono, monospace)" }}>{id.slice(0, 8)}</span>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "6px" }}>
            <div
              style={{
                width: "6px",
                height: "6px",
                background: statusColor[status],
                boxShadow: status === "connected" ? `0 0 4px ${statusColor[status]}` : "none",
              }}
            />
            <span className="pixel-font" style={{ fontSize: "6px", color: statusColor[status], letterSpacing: "0.08em", textTransform: "uppercase" }}>
              {status}
            </span>
          </div>
        </div>

        {/* Nav bar */}
        <div
          style={{
            display: "flex",
            gap: "0",
            borderBottom: "2px solid var(--arcade-border-color)",
            background: "var(--arcade-bg-panel)",
          }}
        >
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => handleNavClick(item.id, item.actionName)}
              className="pixel-font"
              style={{
                flex: 1,
                padding: "8px 4px",
                fontSize: "7px",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                background: "transparent",
                border: "none",
                borderBottom: currentView === item.id ? "2px solid var(--arcade-yellow)" : "2px solid transparent",
                color: currentView === item.id ? "var(--arcade-yellow)" : "rgba(255,255,255,0.35)",
                cursor: "pointer",
                transition: "color 0.15s",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "4px",
              }}
              onMouseEnter={(e) => {
                if (currentView !== item.id) e.currentTarget.style.color = "rgba(255,255,255,0.6)";
              }}
              onMouseLeave={(e) => {
                if (currentView !== item.id) e.currentTarget.style.color = "rgba(255,255,255,0.35)";
              }}
            >
              <span style={{ fontSize: "10px" }}>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
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

      {/* Action sent indicator */}
      {lastAction && (
        <div style={{ padding: "4px 16px", marginTop: "4px" }}>
          <span className="pixel-font" style={{ fontSize: "7px", color: "var(--arcade-green)", letterSpacing: "0.08em" }}>
            SENT: [Canvas] {lastAction}
          </span>
        </div>
      )}

      {/* Surfaces */}
      {(() => {
        const matchedSurfaces = surfaceList.filter(
          (s) => s.id === currentView || s.id.startsWith(currentView)
        );
        const activeNav = NAV_ITEMS.find((n) => n.id === currentView);

        if (isTransitioning) {
          const loadingLabel = activeNav
            ? `Loading ${activeNav.label}...`
            : "Loading...";
          return (
            <div style={{ marginTop: "12px" }}>
              <LoadingSkeleton label={loadingLabel} />
            </div>
          );
        }

        if (surfaceList.length === 0) {
          return (
            <div
              className="arcade-panel"
              style={{
                padding: "48px 24px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "16px",
                marginTop: "12px",
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
                  Ask your agent for a daily digest to get started.
                </span>
              )}
            </div>
          );
        }

        if (matchedSurfaces.length === 0) {
          return (
            <div
              className="arcade-panel"
              style={{
                padding: "32px 24px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "12px",
                marginTop: "12px",
              }}
            >
              <span style={{ fontSize: "24px" }}>{activeNav?.icon || "📋"}</span>
              <span
                className="pixel-font"
                style={{
                  fontSize: "8px",
                  color: "rgba(255,255,255,0.35)",
                  letterSpacing: "0.1em",
                  textAlign: "center",
                  lineHeight: 1.8,
                  textTransform: "uppercase",
                }}
              >
                No {activeNav?.label || currentView} data yet
              </span>
              <span
                style={{
                  fontSize: "11px",
                  color: "rgba(255,255,255,0.2)",
                  fontFamily: "var(--font-mono, monospace)",
                  textAlign: "center",
                  maxWidth: "320px",
                  lineHeight: 1.5,
                }}
              >
                {currentView === "digest"
                  ? "Ask your agent for a daily digest."
                  : currentView === "pipeline"
                    ? "Ask your agent to show the pipeline."
                    : currentView === "followups"
                      ? "Ask your agent to show follow-ups."
                      : "Ask your agent to show insights."}
              </span>
              <button
                onClick={() => handleNavClick(currentView, activeNav?.actionName || `view-${currentView}`)}
                className="pixel-font"
                style={{
                  fontSize: "8px",
                  letterSpacing: "0.1em",
                  color: "var(--arcade-blue)",
                  background: "rgba(0,160,248,0.08)",
                  border: "1px solid var(--arcade-blue)",
                  padding: "6px 16px",
                  cursor: "pointer",
                  textTransform: "uppercase",
                  marginTop: "4px",
                }}
              >
                Request {activeNav?.label || currentView}
              </button>
            </div>
          );
        }

        return (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "12px", animation: "canvas-fadeIn 0.3s ease-out" }}>
            {matchedSurfaces.slice(0, 5).map((surface) => (
              <SurfaceView key={surface.id} surface={surface} onAction={sendCanvasAction} />
            ))}
          </div>
        );
      })()}

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
