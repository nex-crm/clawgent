import { createServer, IncomingMessage } from "http";
import { connect, Socket } from "net";
import next from "next";

type UpgradeHandler = (req: IncomingMessage, socket: Socket, head: Buffer) => void;

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = parseInt(process.env.PORT || "3001", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

function resolveInstance(id: string): { port: number; token: string } | null {
  const g = globalThis as unknown as {
    __clawgent_instances?: Map<string, { port: number; token: string; status: string }>;
  };
  const instances = g.__clawgent_instances;
  if (!instances) return null;
  const inst = instances.get(id);
  if (!inst || inst.status !== "running") return null;
  return { port: inst.port, token: inst.token };
}

app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res);
  });

  // Get Next.js's upgrade handler so we can delegate HMR to it
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nextUpgradeHandler: UpgradeHandler | undefined = (app as any).getUpgradeHandler();

  // Prevent Next.js from registering its own "upgrade" listener on the server.
  // Next.js calls `server.on('upgrade', ...)` lazily during the first HTTP request.
  // We intercept that to keep a single upgrade handler (ours) in control.
  const origOn = server.on.bind(server);
  let nextAutoHandler: UpgradeHandler | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server as any).on = function (event: string, listener: UpgradeHandler) {
    if (event === "upgrade" && nextAutoHandler === null && server.listenerCount("upgrade") > 0) {
      nextAutoHandler = listener;
      return server;
    }
    return origOn(event, listener);
  };

  // Single upgrade handler: route instance WS to Docker containers,
  // everything else to Next.js (HMR).
  server.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const url = req.url || "";
    const match = url.match(/^\/i\/([a-f0-9]{24})(\/.*)?$/);

    if (!match) {
      // Let Next.js handle HMR and other WebSocket upgrades
      const handler = nextAutoHandler || nextUpgradeHandler;
      if (handler) {
        handler(req, socket, head);
      }
      return;
    }

    const id = match[1];
    const targetPath = match[2] || "/";
    const inst = resolveInstance(id);

    if (!inst) {
      socket.destroy();
      return;
    }

    // Build the target path with token for OpenClaw auth
    const separator = targetPath.includes("?") ? "&" : "?";
    const fullPath = `${targetPath}${separator}token=${inst.token}`;

    // Raw TCP proxy to the Docker container
    const targetSocket = connect(inst.port, "127.0.0.1", () => {
      // Rebuild the HTTP upgrade request with modified path and host
      const headers = { ...req.headers, host: `127.0.0.1:${inst.port}` };
      delete headers["sec-websocket-extensions"];

      let httpReq = `GET ${fullPath} HTTP/1.1\r\n`;
      for (const [key, value] of Object.entries(headers)) {
        if (value) {
          const sanitized = (Array.isArray(value) ? value.join(", ") : value).replace(/[\r\n]/g, "");
          httpReq += `${key}: ${sanitized}\r\n`;
        }
      }
      httpReq += "\r\n";

      targetSocket.write(httpReq);
      if (head.length) targetSocket.write(head);

      // Pipe bidirectionally — target's 101 response goes straight to client
      targetSocket.pipe(socket);
      socket.pipe(targetSocket);
    });

    targetSocket.on("error", (err) => {
      console.error(`[ws] target error: ${err.message}`);
      socket.destroy();
    });

    socket.on("error", () => targetSocket.destroy());
    targetSocket.on("close", () => socket.destroy());
    socket.on("close", () => targetSocket.destroy());
  });

  server.listen(port, hostname, () => {
    console.log(`> Clawgent ready on http://${hostname}:${port}`);
  });
});
