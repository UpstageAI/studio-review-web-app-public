#!/usr/bin/env node
// GitHub Pages 데모를 `out/` 에 만든다. README "GitHub Pages 데모" 참고.
//
//   PAGES_BASE_PATH=/저장소-이름 node pages-demo/build.mjs
//
// 1. `next build` 를 정적 export 로 돌린다(`next.config.ts` 가 `NEXT_PUBLIC_PAGES_DEMO=1` 을 보고 바꾼다).
// 2. BFF Route Handler + mock upstream 을 서비스 워커 하나(`out/mock-sw.js`)로 번들한다.
// 3. locale 로 보내는 `out/index.html` 과 `.nojekyll` 을 쓴다.
import { spawnSync } from "node:child_process";
import { readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

import { SW_FILE } from "./config.mjs";

const NEXT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(NEXT_DIR, "out");
const API_DIR = join(NEXT_DIR, "src/app/api");
const SW_DIR = join(NEXT_DIR, "pages-demo/sw");

const basePath = (process.env.PAGES_BASE_PATH ?? "").replace(/\/+$/, "");
if (basePath !== "" && !/^(\/[A-Za-z0-9._~-]+)+$/.test(basePath)) {
  console.error(`PAGES_BASE_PATH 가 올바르지 않습니다: ${basePath}`);
  process.exit(1);
}

rmSync(OUT_DIR, { recursive: true, force: true });

const next = spawnSync(
  process.execPath,
  [join(NEXT_DIR, "node_modules/next/dist/bin/next"), "build"],
  {
    cwd: NEXT_DIR,
    stdio: "inherit",
    env: {
      ...process.env,
      NEXT_PUBLIC_PAGES_DEMO: "1",
      NEXT_PUBLIC_BASE_PATH: basePath,
      // UI Kit 데모 화면(`/{locale}/ui-kit-demo`)도 함께 만든다. 빼려면 `REVIEW_UI_KIT_DEMO=0`.
      REVIEW_UI_KIT_DEMO: process.env.REVIEW_UI_KIT_DEMO ?? "1",
    },
  },
);
if (next.status !== 0) process.exit(next.status ?? 1);

/** `src/app/api/**​/route.ts` → `{ pattern, 파일 }`. `[name]` 은 이름 붙은 그룹이 된다. */
function bffRoutes() {
  return readdirSync(API_DIR, { recursive: true })
    .map(file => String(file).split(sep).join("/"))
    .filter(file => /(^|\/)route\.ts$/.test(file))
    .sort()
    .map(file => {
      const segments = file.split("/").slice(0, -1);
      const pattern = ["api", ...segments]
        .map(segment => {
          const param = /^\[(\w+)\]$/.exec(segment);
          return param
            ? `(?<${param[1]}>[^/]+)`
            : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        })
        .join("\\/");
      return { pattern: `^\\/${pattern}$`, file: join(API_DIR, file) };
    });
}

const routes = bffRoutes();
const routesModule = [
  ...routes.map(
    (route, index) =>
      `import * as r${index} from ${JSON.stringify(route.file)};`,
  ),
  "export const routes = [",
  ...routes.map(
    (route, index) =>
      `  { pattern: new RegExp(${JSON.stringify(route.pattern)}), handlers: r${index} },`,
  ),
  "];",
].join("\n");

/** 서버 전용 모듈을 서비스 워커용으로 바꿔 끼운다. */
const swPlugin = {
  name: "pages-demo-sw",
  setup(api) {
    api.onResolve({ filter: /^virtual:bff-routes$/ }, () => ({
      path: "bff-routes",
      namespace: "pages-demo",
    }));
    api.onLoad({ filter: /.*/, namespace: "pages-demo" }, () => ({
      contents: routesModule,
      resolveDir: NEXT_DIR,
    }));
    api.onResolve({ filter: /^server-only$/ }, () => ({
      path: join(SW_DIR, "empty.mjs"),
    }));
    api.onResolve({ filter: /^@\/lib\/prisma$/ }, () => ({
      path: join(SW_DIR, "prisma-shim.mjs"),
    }));
    // 생성기의 PNG 모듈은 Node 의 Buffer·zlib 을 쓴다.
    api.onResolve({ filter: /^\.\/png\.mjs$/ }, () => ({
      path: join(SW_DIR, "png-browser.mjs"),
    }));
  },
};

await build({
  absWorkingDir: NEXT_DIR,
  entryPoints: [join(SW_DIR, "entry.mjs")],
  outfile: join(OUT_DIR, SW_FILE),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "none",
  tsconfig: join(NEXT_DIR, "tsconfig.json"),
  plugins: [swPlugin],
  logLevel: "warning",
});

// proxy(next-intl middleware)가 하던 locale 판단을 대신한다: 브라우저 언어 → 기본 locale.
const localeConfig = await build({
  absWorkingDir: NEXT_DIR,
  entryPoints: [join(NEXT_DIR, "src/i18n/config.ts")],
  format: "esm",
  write: false,
  logLevel: "warning",
});
const { locales, defaultLocale } = await import(
  `data:text/javascript;base64,${Buffer.from(localeConfig.outputFiles[0].contents).toString("base64")}`
);
writeFileSync(
  join(OUT_DIR, "index.html"),
  `<!doctype html>
<html lang="${defaultLocale}">
  <head>
    <meta charset="utf-8" />
    <meta name="robots" content="noindex" />
    <title>Studio review web app demo</title>
    <script>
      (function () {
        var locales = ${JSON.stringify(locales)};
        var wanted = (navigator.languages || [navigator.language || ""]).map(
          function (tag) { return String(tag).toLowerCase().split("-")[0]; }
        );
        var locale = wanted.filter(function (tag) { return locales.indexOf(tag) >= 0; })[0] || ${JSON.stringify(defaultLocale)};
        location.replace("./" + locale + location.search + location.hash);
      })();
    </script>
    <noscript><meta http-equiv="refresh" content="0; url=./${defaultLocale}" /></noscript>
  </head>
  <body></body>
</html>
`,
);
// GitHub Pages 의 Jekyll 이 `_next/` 를 빼지 않게 한다.
writeFileSync(join(OUT_DIR, ".nojekyll"), "");

console.log(
  `\nPages 데모 → ${relative(process.cwd(), OUT_DIR) || "."} (base path "${basePath || "/"}", BFF 라우트 ${routes.length}개)`,
);
console.log(
  `미리보기: PAGES_BASE_PATH=${basePath} node pages-demo/preview.mjs`,
);
