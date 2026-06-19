import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { WebSocketServer } from "ws";
import type { ClientMessage } from "../src/net/protocol";
import { RoomManager } from "./RoomManager";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 8790);
const distDir = resolve(process.cwd(), "dist");
const roomManager = new RoomManager();

const server = createServer((request, response) => {
  if (!request.url || request.url.startsWith("/ws")) {
    response.writeHead(404);
    response.end();
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);
  const requestedPath = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = resolve(join(distDir, requestedPath));
  const fallbackPath = join(distDir, "index.html");
  const targetPath = filePath.startsWith(distDir) && existsSync(filePath) && statSync(filePath).isFile()
    ? filePath
    : fallbackPath;

  if (!existsSync(targetPath)) {
    response.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
    response.end("CarGame has not been built yet. Run pnpm build first.");
    return;
  }

  response.writeHead(200, { "content-type": contentType(targetPath) });
  createReadStream(targetPath).pipe(response);
});

const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (socket) => {
  const clientId = roomManager.register(socket);

  socket.on("message", (raw) => {
    try {
      const message = JSON.parse(raw.toString()) as ClientMessage;
      roomManager.handleMessage(clientId, message);
    } catch {
      socket.send(JSON.stringify({ type: "error", message: "消息格式错误。" }));
    }
  });

  socket.on("close", () => {
    roomManager.unregister(clientId);
  });
});

setInterval(() => {
  roomManager.tick();
}, 50);

server.listen(port, host, () => {
  console.log(`CarGame server listening on http://${host}:${port}`);
});

function contentType(filePath: string) {
  const ext = extname(filePath);
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}
