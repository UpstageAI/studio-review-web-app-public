#!/usr/bin/env node
// Job 검수 화면 읽기·조작 스모크. mock 모드로 띄운 앱(`pnpm mock:serve` + `pnpm mock:start`)을
// Chromium 으로 열어 사람이 손으로 확인하던 동작(뷰어 키보드·URL, 위치 바, 문서 목록 필터,
// 필름스트립 이웃 보기·DnD, 구조 툴바, 페이지 정리 화면, 값 패널, 임시 저장, 하이라이트 재시도, Collection 상세
// 검수 열·필터, 검수 큐, 저장 왕복)을 시나리오마다 새
// 브라우저 컨텍스트(빈 localStorage, 필름스트립만 펼침으로 시작)에서 되풀이하고 `[PASS]/[FAIL] <시나리오>/<확인>` 을 찍는다.
// FAIL 이 하나라도 있으면 exit 1, PASS·FAIL 이 하나도 없으면(모두 SKIP) exit 2. CI 에서는 돌지 않는다.
//
//   node mock/smoke.mjs [--base http://localhost:3000] [--mock http://127.0.0.1:4010] [--locale ko]
//        [--only viewer,draft] [--index mock/.generated/index.json] [--headed] [--timeout 60000] [--list]
//
// 시작할 때 앱이 mock 모드인지(mock Collection 의 `review-capabilities` 가 200 인지) 확인하고 아니면
// 멈춘다 — `save` 시나리오가 실제 upstream 에 저장하지 않게. `save` 는 끝에 `--mock` 서버의
// `POST /__mock/reset` 으로 저장한 상태를 되돌린다.
//
// 시나리오는 `mock/lib/smoke-scenarios.mjs`. 데이터가 맞지 않는 시나리오(예: `values` 는
// `--items-max 120` 데이터, 이웃 보기는 20 쪽 넘는 Job)는 `[SKIP]` 으로 이유만 찍는다.
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { chromium } from "playwright";

import { SCENARIOS, seedReviewStorage } from "./lib/smoke-scenarios.mjs";

const NEXT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_INDEX = "mock/.generated/index.json";

const DEFAULTS = {
  base: "http://localhost:3000",
  mock: "http://127.0.0.1:4010",
  locale: "ko",
  timeout: 60_000,
};

const HELP = `검수 화면 스모크

  node mock/smoke.mjs [옵션]

옵션
  --base <url>        앱 주소 (기본 ${DEFAULTS.base})
  --mock <url>        mock upstream 주소, save 의 reset 용 (기본 ${DEFAULTS.mock})
  --locale <l>        URL·브라우저 locale (기본 ${DEFAULTS.locale})
  --index <path>      mock 생성기의 index.json (기본 ${DEFAULT_INDEX})
  --only <a,b>        이 시나리오만 (쉼표로 구분)
  --headed            브라우저 창을 보이게 실행
  --timeout <ms>      시나리오 하나의 대기 상한 (기본 ${DEFAULTS.timeout})
  --list              시나리오 목록만 출력
  -h, --help          이 도움말

시나리오: ${SCENARIOS.map(scenario => scenario.name).join(", ")}
`;

function fail(text) {
  console.error(text);
  process.exit(1);
}

function shortMessage(error) {
  const text = error instanceof Error ? error.message : String(error);
  return text.split("\n")[0].slice(0, 200);
}

function loadIndex(path) {
  const indexPath = resolve(NEXT_DIR, path);
  if (!existsSync(indexPath)) {
    fail(
      `${relative(NEXT_DIR, indexPath)} 가 없습니다. 먼저 pnpm mock:gen 을 실행하세요.`,
    );
  }
  return JSON.parse(readFileSync(indexPath, "utf8"));
}

/** 앱이 떠 있는지 한 번 확인한다(시나리오마다 같은 timeout 오류가 반복되지 않게). */
async function assertReachable(base) {
  try {
    const response = await fetch(base, { redirect: "manual" });
    if (response.status >= 500) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    fail(
      `${base} 에 연결할 수 없습니다 (${shortMessage(error)}). pnpm mock:serve 와 pnpm build && pnpm mock:start 를 먼저 띄우세요.`,
    );
  }
}

/**
 * 앱이 mock upstream 을 보고 있는지 확인한다. mock 데이터의 Collection 은 실제 upstream 에 없으므로
 * `review-capabilities` 가 200 이 아니면 mock 모드가 아니다(`--base` 가 loopback 이 아니어도 이것으로 막는다).
 */
async function assertMockTarget(base, collection) {
  const url = `${base}/api/search-collections/${encodeURIComponent(collection)}/review-capabilities`;
  let status;
  try {
    status = (await fetch(url, { redirect: "manual" })).status;
  } catch (error) {
    status = shortMessage(error);
  }
  if (status !== 200) {
    fail(
      `대상이 mock 모드가 아닙니다 — 저장 시나리오는 mock upstream 에서만 돕니다 (${url} → ${status}).`,
    );
  }
}

async function runScenario(browser, scenario, config, totals) {
  const skipReason = scenario.skip?.(config.index) ?? null;
  if (skipReason) {
    console.log(`[SKIP] ${scenario.name} — ${skipReason}`);
    totals.skipped += 1;
    return;
  }
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    locale: config.locale,
  });
  context.setDefaultTimeout(Math.min(15_000, config.timeout));
  // 구성 탭 필름스트립은 기본이 접힘이라, 시나리오는 펼친 상태에서 시작한다(시나리오가 바꾸면 그 값 유지).
  // 설정 메뉴의 부가 기능(페이지 편집 도구, 페이지 썸네일, 페이지 정리, JSON 메뉴)은 페이지 썸네일 외에는 기본이
  // 꺼짐이라 모두 켜고 시작한다(썸네일은 이미 켜짐이지만 함께 적는다). 검수할 단계도 기본에서 빠지는 보기 전용 Parse 와 Instruct 를 켠다. 기본 화면을 보는
  // 시나리오(`defaults: true`)는 아무것도 넣지 않는다.
  if (!scenario.defaults) await seedReviewStorage(context);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error =>
    errors.push(`pageerror: ${shortMessage(error)}`),
  );
  page.on("console", message => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (scenario.allowConsole?.test(text)) return;
    errors.push(text.slice(0, 200));
  });

  const record = (check, ok, detail) => {
    const line = `[${ok ? "PASS" : "FAIL"}] ${scenario.name}/${check}`;
    console.log(detail && !ok ? `${line} — ${detail}` : line);
    if (ok) totals.passed += 1;
    else totals.failed += 1;
  };
  // 시간 초과로 race 가 끝나도 시나리오 Promise 는 계속 돌 수 있다(page 를 쓰지 않는 줄). 끝난 뒤의
  // 확인·SKIP 은 다음 시나리오 출력에 섞이거나 합계를 바꾸지 않게 버린다.
  let closed = false;
  const report = (check, ok, detail) => {
    if (!closed) record(check, ok, detail);
  };
  const skip = (check, reason) => {
    if (!closed) console.log(`[SKIP] ${scenario.name}/${check} — ${reason}`);
  };

  let timer;
  try {
    await Promise.race([
      scenario.run({ page, context, config, report, skip }),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`scenario timeout (${config.timeout} ms)`)),
          config.timeout,
        );
      }),
    ]);
  } catch (error) {
    record("run", false, shortMessage(error));
  } finally {
    closed = true;
    clearTimeout(timer);
  }
  record("no-console-errors", errors.length === 0, errors[0]);
  await context.close().catch(() => {});
}

async function main() {
  const { values } = parseArgs({
    // pnpm 10 은 `pnpm mock:smoke -- --only x` 의 `--` 를 그대로 넘기므로 맨 앞 `--` 는 버린다.
    args: process.argv
      .slice(2)
      .filter((arg, index) => !(arg === "--" && index === 0)),
    options: {
      base: { type: "string" },
      mock: { type: "string" },
      locale: { type: "string" },
      index: { type: "string" },
      only: { type: "string" },
      headed: { type: "boolean", default: false },
      timeout: { type: "string" },
      list: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(HELP);
    return;
  }
  if (values.list) {
    for (const scenario of SCENARIOS)
      console.log(`${scenario.name}\t${scenario.description}`);
    return;
  }
  const only = values.only
    ? values.only
        .split(",")
        .map(name => name.trim())
        .filter(Boolean)
    : null;
  const unknown = (only ?? []).filter(
    name => !SCENARIOS.some(scenario => scenario.name === name),
  );
  if (unknown.length > 0) fail(`알 수 없는 시나리오: ${unknown.join(", ")}`);
  const timeout =
    values.timeout === undefined ? DEFAULTS.timeout : Number(values.timeout);
  if (!Number.isInteger(timeout) || timeout < 1000)
    fail(`--timeout 은 1000 이상의 정수여야 합니다: ${values.timeout}`);

  const index = loadIndex(values.index ?? DEFAULT_INDEX);
  const config = {
    index,
    base: (values.base ?? DEFAULTS.base).replace(/\/$/, ""),
    mock: (values.mock ?? DEFAULTS.mock).replace(/\/$/, ""),
    locale: values.locale ?? DEFAULTS.locale,
    timeout,
  };
  await assertReachable(config.base);
  await assertMockTarget(config.base, index.ids.collection);

  const scenarios = only
    ? SCENARIOS.filter(scenario => only.includes(scenario.name))
    : SCENARIOS;
  console.error(
    `[smoke] ${config.base} — ${index.totalPages} pages, ${index.documents.length} documents, items-max ${index.options?.itemsMax ?? "?"}`,
  );
  const totals = { passed: 0, failed: 0, skipped: 0 };
  const browser = await chromium.launch({ headless: !values.headed });
  try {
    for (const scenario of scenarios)
      await runScenario(browser, scenario, config, totals);
  } finally {
    await browser.close().catch(() => {});
  }
  console.log(
    `\n${totals.passed} passed, ${totals.failed} failed, ${totals.skipped} scenarios skipped`,
  );
  if (totals.failed > 0) process.exitCode = 1;
  else if (totals.passed === 0) {
    console.log("실행된 시나리오가 없습니다(데이터 조건 확인)");
    process.exitCode = 2;
  }
}

await main();
