import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

export interface FixtureServer { url: string; close(): Promise<void>; }

export async function startFixtureServer(): Promise<FixtureServer> {
  const html = await readFile(resolve("tests/fixtures/chatgpt-page/index.html"));
  const images = await Promise.all([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => sharp({ create: { width: 2, height: 2, channels: 3, background: { r: value * 20, g: 100, b: 200 } } }).png().toBuffer()));
  const server: Server = createServer((request, response) => {
    if (request.url?.startsWith("/image.png")) { const id = Number(new URL(request.url, "http://localhost").searchParams.get("id") ?? 0); const png = images[id] ?? images[0] as Buffer; response.writeHead(200, { "content-type": "image/png", "content-length": png.byteLength }); response.end(png); return; }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }); response.end(html);
  });
  await new Promise<void>((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolveListen()); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("夹具服务启动失败");
  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())) };
}
