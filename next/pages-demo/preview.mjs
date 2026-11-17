#!/usr/bin/env node
// `out/` 을 GitHub Pages 처럼 돌려 보는 로컬 정적 서버(`.html` 생략 주소, base path, 404.html).
//
//   PAGES_BASE_PATH=/저장소-이름 PORT=4173 node pages-demo/preview.mjs
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../out");
const PORT = Number(process.env.PORT ?? 4173);
const basePath = (process.env.PAGES_BASE_PATH ?? "").replace(/\/+$/, "");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

const isFile = path => existsSync(path) && statSync(path).isFile();

/** 요청 경로 → `out/` 안 파일. GitHub Pages 처럼 `x` → `x.html` → `x/index.html` 순으로 찾는다. */
function fileFor(pathname) {
  const path = normalize(join(OUT_DIR, decodeURIComponent(pathname)));
  if (path !== OUT_DIR && !path.startsWith(OUT_DIR + sep)) return null;
  return [path, `${path}.html`, join(path, "index.html")].find(isFile) ?? null;
}

if (!existsSync(OUT_DIR)) {
  console.error("out/ 이 없습니다. 먼저 pnpm pages:build 를 실행하세요.");
  process.exit(1);
}

createServer((req, res) => {
  const { pathname } = new URL(req.url ?? "/", "http://localhost");
  const inside = pathname === basePath || pathname.startsWith(`${basePath}/`);
  const file = inside ? fileFor(pathname.slice(basePath.length) || "/") : null;
  const target = file ?? join(OUT_DIR, "404.html");
  res.writeHead(file ? 200 : 404, {
    "Content-Type": TYPES[extname(target)] ?? "application/octet-stream",
    "Cache-Control": "no-cache",
  });
  createReadStream(target).pipe(res);
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Pages 미리보기: http://localhost:${PORT}${basePath}/`);
});
