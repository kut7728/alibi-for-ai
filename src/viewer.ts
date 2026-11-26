import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, extname, join } from "node:path";
import { RunStore } from "./store";

const host = "127.0.0.1";
const assets = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/tokens.css", ["tokens.css", "text/css; charset=utf-8"]],
  ["/viewer.css", ["viewer.css", "text/css; charset=utf-8"]],
  ["/viewer.js", ["viewer.js", "text/javascript; charset=utf-8"]],
]);
const imageTypes = new Map([
  [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".webp", "image/webp"],
]);

export async function startViewer(root: string) {
  const store = new RunStore(root);
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    response.setHeader("Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    const send = (status: number, type: string, body: string | Buffer) => {
      response.writeHead(status, { "Content-Type": type });
      response.end(body);
    };
    const text = (status: number, message: string) => send(status, "text/plain; charset=utf-8", message);
    const address = server.address();
    if (!address || typeof address === "string" || request.headers.host !== `${host}:${address.port}`) {
      return text(403, "Forbidden.");
    }
    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      return text(405, "Method not allowed.");
    }
    const path = request.url?.split("?", 1)[0] ?? "";
    const site = request.headers["sec-fetch-site"];
    if (path !== "/" && site && site !== "same-origin" && site !== "none") return text(403, "Forbidden.");
    try {
      const asset = assets.get(path);
      if (asset) {
        const [file, type] = asset;
        return send(200, type, await readFile(join(__dirname, "..", "viewer", file)));
      }
      if (path === "/api/runs") {
        const { runs, invalidRuns } = await store.list();
        return send(200, "application/json; charset=utf-8", JSON.stringify({
          project: basename(root), runs: runs.map(({ run }) => run), invalidRuns,
        }));
      }
      const screenshot = /^\/screenshots\/([0-9a-f-]+)\/([a-zA-Z0-9_-]+\.[a-zA-Z0-9]+)$/.exec(path);
      if (screenshot) {
        const [, id, name] = screenshot;
        const type = imageTypes.get(extname(name).toLowerCase());
        const data = type && await store.screenshot(id, name);
        if (type && data) return send(200, type, data);
      }
      return text(404, "Not found.");
    } catch {
      return text(500, "Could not load viewer data.");
    }
  });
  server.listen(0, host);
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not start the viewer.");
  return { server, url: `http://${host}:${address.port}/` };
}

export async function openViewer(root: string, json: boolean): Promise<void> {
  const { url } = await startViewer(root);
  console.log(json ? JSON.stringify({ url }) : `Alibi viewer: ${url}\nPress Ctrl+C to stop.`);
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "rundll32.exe" : "xdg-open";
  const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  const browser = spawn(command, args, { stdio: "ignore", windowsHide: true });
  const manual = () => console.error(json
    ? JSON.stringify({ warning: "Could not open the default browser.", url })
    : `Could not open the default browser. Open ${url} manually.`);
  browser.once("error", manual);
  browser.once("exit", (code) => { if (code !== 0) manual(); });
}
