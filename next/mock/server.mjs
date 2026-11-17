#!/usr/bin/env node
// Upstage 콘솔 API 를 흉내 내는 mock upstream 서버. 앱은 `UPSTAGE_CONSOLE_API_URL=http://127.0.0.1:4010`
// 으로 이 서버를 부른다. `pnpm mock:gen` 이 만든 `dataset.json` 을 읽어 메모리에만 두고, 저장
// (`review-imports`)도 메모리에만 반영한다 — 디스크에 쓰지 않고 재시작하거나 `POST /__mock/reset` 을
// 부르면 처음 상태로 돌아간다. 저장 본문의 `base_version` 이 지금 version 과 다르면 실제 서버처럼 아무것도
// 반영하지 않고 `failed`(`base_version_conflict`)로 끝낸다.
// Job 이 여럿(`--jobs N`)이면 Job 마다 문서·응답·버전을 따로 둔다. `source-jobs` 목록은 `limit`·`after`·
// `order`·`latest` 만 해석하고 `group_by`·`q`·`status` 는 무시한다. Collection 목록은 `is_default`·`listed` 만
// 해석하고 `kind`·`order` 등 다른 쿼리는 무시한다. 목록에는 Collection 관계 화면용 Collection 들
// (`lib/lineage.mjs`)이 함께 나오며 검수할 Job 은 없다.
// Job 변경 이력(`source-jobs/{job}/revisions[/{id}]`)은 Job 마다 메모리 원장(`lib/revisions.mjs`)에 두고,
// 데이터셋의 seed 이력에서 시작해 저장이 반영될 때마다 바뀐 결과·구조마다 행을 더한다. 목록은 `type`·
// `occurrence_id`·`job_result_id`·`operation_id`·`include=content`·`after`·`limit`·`order` 를 해석한다.
// `POST /__mock/revisions-fail?status=429|500&count=N&retry_after=2` 는 이후 revisions 요청 N 개를 그
// 상태로 실패시킨다.
//
//   MOCK_PORT=4010 MOCK_HOST=127.0.0.1 MOCK_LATENCY_MS=0 MOCK_DATA=mock/.generated/dataset.json
//   MOCK_REVISION_CONTENT_MAX_BYTES=(무제한)
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { createMockUpstream } from "./lib/upstream.mjs";

const PORT = Number(process.env.MOCK_PORT ?? 4010);
const HOST = process.env.MOCK_HOST ?? "127.0.0.1";
const LATENCY_MS = Number(process.env.MOCK_LATENCY_MS ?? 0);
const DATA_PATH = process.env.MOCK_DATA
  ? resolve(process.env.MOCK_DATA)
  : fileURLToPath(new URL("./.generated/dataset.json", import.meta.url));
/** revisions `content`·`base_content` 하나의 상한(바이트). 넘으면 `*_omitted: "too_large"`. 기본 무제한. */
const REVISION_CONTENT_MAX_BYTES = process.env.MOCK_REVISION_CONTENT_MAX_BYTES
  ? Number(process.env.MOCK_REVISION_CONTENT_MAX_BYTES)
  : Infinity;

if (!existsSync(DATA_PATH)) {
  console.error(
    `mock 데이터가 없습니다: ${DATA_PATH}\n먼저 pnpm mock:gen 을 실행하세요.`,
  );
  process.exit(1);
}

const loadDataset = () => JSON.parse(readFileSync(DATA_PATH, "utf8"));
const dataset = loadDataset();
// 본체(라우팅·저장·이력)는 `lib/upstream.mjs` 에 있다. 여기는 Node HTTP 로 감싸기만 한다.
const upstream = createMockUpstream({
  dataset,
  loadDataset,
  // 데이터셋의 URL 은 127.0.0.1 고정이다(`MOCK_HOST` 와 무관).
  origin: `http://127.0.0.1:${PORT}`,
  revisionContentMaxBytes: REVISION_CONTENT_MAX_BYTES,
});

/** 요청 본문을 `maxBytes` 까지 읽는다. 넘으면 연결을 끊고 `{ tooLarge: true }` 로 거절한다. */
function readBody(req, maxBytes) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", chunk => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(Object.assign(new Error("body too large"), { tooLarge: true }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function send(req, res, result) {
  const body = result.body === null ? null : Buffer.from(result.body, "utf8");
  const headers = { ...result.headers };
  if (body !== null) headers["Content-Length"] = String(body.length);
  res.writeHead(result.status, headers);
  if (body === null || req.method === "HEAD") res.end();
  else res.end(body);
}

const server = createServer(async (req, res) => {
  const started = performance.now();
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
  let result;
  try {
    result = await upstream.route(
      {
        method: req.method ?? "GET",
        headers: req.headers,
        readBody: maxBytes => readBody(req, maxBytes),
      },
      url,
    );
  } catch (err) {
    result = upstream.error(
      500,
      "internal_error",
      err instanceof Error ? err.message : String(err),
    );
  }
  if (LATENCY_MS > 0) await sleep(LATENCY_MS);
  send(req, res, result);
  const bytes = result.body === null ? 0 : Buffer.byteLength(result.body);
  console.log(
    `${req.method} ${url.pathname}${url.search} ${result.status} ${bytes}B ${Math.round(performance.now() - started)}ms`,
  );
});

server.listen(PORT, HOST, () => {
  const documents = dataset.documents.length;
  console.log(
    `mock upstream listening on http://${HOST}:${PORT} — ${DATA_PATH} (${dataset.totalPages} pages, ${documents} documents, ${dataset.files.length} file(s), ${upstream.jobCount} job(s))`,
  );
  if (LATENCY_MS > 0) console.log(`  latency ${LATENCY_MS} ms per response`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}
