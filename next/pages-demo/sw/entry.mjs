// GitHub Pages 데모의 서비스 워커. 서버가 없는 정적 호스팅에서 이 앱의 서버 쪽을 브라우저 안에서 돌린다.
//
//   페이지 fetch("/api/...")  →  BFF Route Handler(`src/app/api/**/route.ts`, 그대로 번들)
//                             →  upstageFetch → fetch("{scope}__mock-upstream/v2/...")
//                             →  mock upstream(`mock/lib/upstream.mjs`, `pnpm mock:serve` 와 같은 본체)
//
// 앱 DB(검수 상태)는 `prisma-shim.mjs` 가, 저장 내용은 `store.mjs` 가 IndexedDB 에 둔다 — 이 브라우저에만
// 남고 다른 사람과 공유되지 않는다. 네트워크로 나가는 요청은 없다.
import { UPSTREAM_BASE } from "./prelude.mjs";

import { routes } from "virtual:bff-routes";

import { generateDataset } from "../../mock/lib/dataset.mjs";
import { createMockUpstream } from "../../mock/lib/upstream.mjs";
import { DEMO_DATASET_OPTIONS } from "../config.mjs";
import { appendImport, clearImports, loadSaved } from "./store.mjs";

const UPSTREAM_URL = new URL(UPSTREAM_BASE);
const NULL_BODY_STATUS = new Set([204, 205, 304]);

/** 끝나지 않은 IndexedDB 쓰기. 응답을 돌려주기 전에 기다려 워커가 내려가도 저장이 남게 한다. */
let pendingWrites = Promise.resolve();
const track = promise => {
  pendingWrites = Promise.all([pendingWrites, promise]);
};

let upstream = null;

/** 데이터셋을 만들고(결정적, 수십 ms) 저장해 둔 가져오기를 같은 순서로 다시 반영한다. */
const ready = (async () => {
  const saved = await loadSaved();
  upstream = createMockUpstream({
    dataset: generateDataset(DEMO_DATASET_OPTIONS),
    loadDataset: () => generateDataset(DEMO_DATASET_OPTIONS),
    origin: UPSTREAM_BASE,
    onImport: record => track(appendImport(record)),
    onReset: () => track(clearImports()),
  });
  for (const record of saved) {
    try {
      upstream.replayImport(record);
    } catch (err) {
      console.warn("demo: skipped a saved import", err);
    }
  }
})();

const jsonError = (status, code, message) =>
  new Response(
    JSON.stringify({ error: { code, type: code, message, param: null } }),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "private, no-store",
      },
    },
  );

async function bodyBytes(body) {
  if (body === null || body === undefined) return new Uint8Array(0);
  return new Uint8Array(await new Response(body).arrayBuffer());
}

/** mock upstream 을 부른다. `url` 은 `{UPSTREAM_BASE}/...` 이고 그 뒤 경로가 upstream 의 경로다. */
async function callUpstream(url, init = {}) {
  await ready;
  const headers = {};
  new Headers(init.headers).forEach((value, name) => {
    headers[name] = value;
  });
  const inner = new URL(
    url.pathname.slice(UPSTREAM_URL.pathname.length) + url.search,
    url.origin,
  );
  let result;
  try {
    result = await upstream.route(
      {
        method: init.method ?? "GET",
        headers,
        readBody: () => bodyBytes(init.body),
      },
      inner,
    );
  } catch (err) {
    result = upstream.error(
      500,
      "internal_error",
      err instanceof Error ? err.message : String(err),
    );
  }
  return new Response(
    NULL_BODY_STATUS.has(result.status) ? null : result.body,
    { status: result.status, headers: result.headers },
  );
}

const isUpstream = url =>
  url.origin === UPSTREAM_URL.origin &&
  url.pathname.startsWith(`${UPSTREAM_URL.pathname}/`);

// BFF 의 upstream 호출(`upstageFetch`)을 네트워크 대신 mock upstream 으로 보낸다. 서비스 워커가 직접 부르는
// fetch 는 자기 `fetch` 이벤트를 거치지 않으므로 전역을 바꿔 잡는다.
const networkFetch = self.fetch.bind(self);
self.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  return isUpstream(url) ? callUpstream(url, init) : networkFetch(input, init);
};

function matchRoute(pathname) {
  for (const route of routes) {
    const match = route.pattern.exec(pathname);
    if (match) {
      const params = Object.fromEntries(
        Object.entries(match.groups ?? {}).map(([name, value]) => [
          name,
          decodeURIComponent(value),
        ]),
      );
      return { handlers: route.handlers, params };
    }
  }
  return null;
}

/** Route Handler 가 읽는 만큼만 채운 요청(`NextRequest` 자리). */
function handlerRequest(request, url, bytes) {
  return {
    method: request.method,
    url: url.href,
    nextUrl: url,
    headers: new Headers(request.headers),
    signal: request.signal,
    body: bytes === null ? null : new Response(bytes).body,
  };
}

async function runHandler(request, url, bytes) {
  const matched = matchRoute(url.pathname);
  if (!matched) return jsonError(404, "not_found", "Not found");
  const handler = matched.handlers[request.method];
  if (!handler)
    return jsonError(405, "method_not_allowed", "Method not allowed");
  return handler(handlerRequest(request, url, bytes), {
    params: Promise.resolve(matched.params),
  });
}

const FIGURE_PATH =
  /^(\/api\/search-collections\/[^/]+\/source-jobs\/[^/]+)\/figures\/[^/]+$/;

async function handleApi(request) {
  const url = new URL(request.url);
  try {
    await ready;
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const bytes = hasBody ? await request.arrayBuffer() : null;
    let response = await runHandler(request, url, bytes);
    // Parse 그림은 Job 응답을 읽을 때 메모리에 떼어 둔 것이라 워커가 다시 뜨면 없다. 그때는 Job 응답을
    // 한 번 더 만들어 채운 뒤 다시 찾는다.
    const figure = FIGURE_PATH.exec(url.pathname);
    if (figure && response.status === 404) {
      const jobResponse = new URL(`${figure[1]}/response`, url.origin);
      await runHandler(request, jobResponse, null);
      response = await runHandler(request, url, null);
    }
    await pendingWrites;
    return response;
  } catch (err) {
    console.error("demo: handler failed", url.pathname, err);
    return jsonError(
      500,
      "internal_error",
      err instanceof Error ? err.message : String(err),
    );
  }
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event =>
  event.waitUntil(self.clients.claim()),
);

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  // BFF 경로는 base path 없이 origin 바로 아래 `/api/...` 다(클라이언트가 그렇게 부른다).
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(handleApi(event.request));
  } else if (isUpstream(url)) {
    // 페이지 이미지(`<img>` 가 직접 받는 `{UPSTREAM_BASE}/pages/...`)와, 페이지에서 직접 부르는 mock 전용
    // 경로(`POST {UPSTREAM_BASE}/__mock/reset` — 이 브라우저에 저장한 내용을 처음으로 되돌린다).
    event.respondWith(
      callUpstream(url, {
        method: event.request.method,
        headers: event.request.headers,
      }),
    );
  }
});
