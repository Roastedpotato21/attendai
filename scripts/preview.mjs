import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const publicDir = resolve(rootDir, ".output", "public");
const workerPath = resolve(rootDir, ".output", "server", "index.mjs");
const port = Number.parseInt(process.env["PORT"] ?? "4173", 10);
const host = process.env["HOST"] ?? "127.0.0.1";

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const workerModule = await import(pathToFileURL(workerPath).href);
const worker = workerModule.default;

if (!worker || typeof worker.fetch !== "function") {
  throw new Error("The production worker is missing. Run `npm run build` before previewing.");
}

async function serveAsset(request) {
  const url = new URL(request.url);
  const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  const assetPath = resolve(publicDir, relativePath);

  if (assetPath !== publicDir && !assetPath.startsWith(`${publicDir}${sep}`)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const fileStats = await stat(assetPath);
    if (!fileStats.isFile()) return new Response("Not found", { status: 404 });

    return new Response(await readFile(assetPath), {
      headers: {
        "content-length": String(fileStats.size),
        "content-type":
          contentTypes[extname(assetPath).toLowerCase()] ?? "application/octet-stream",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

const executionContext = {
  passThroughOnException() {},
  waitUntil(promise) {
    void promise.catch((error) => console.error("Background preview task failed", error));
  },
};

const server = createServer(async (incoming, outgoing) => {
  try {
    const requestUrl = new URL(incoming.url ?? "/", `http://${incoming.headers.host ?? host}`);
    const hasBody = incoming.method !== "GET" && incoming.method !== "HEAD";
    const request = new Request(requestUrl, {
      method: incoming.method,
      headers: incoming.headers,
      ...(hasBody ? { body: Readable.toWeb(incoming), duplex: "half" } : {}),
    });
    const response = await worker.fetch(
      request,
      { ...process.env, ASSETS: { fetch: serveAsset } },
      executionContext,
    );

    outgoing.statusCode = response.status;
    response.headers.forEach((value, name) => outgoing.setHeader(name, value));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error(error);
    outgoing.statusCode = 500;
    outgoing.end("Internal Server Error");
  }
});

server.listen(port, host, () => {
  console.log(`Production preview: http://${host}:${port}`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
