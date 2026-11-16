#!/usr/bin/env node
// Job 검수 화면 DOM 캡처. mock 모드로 띄운 앱(`pnpm mock:serve` + `pnpm mock:start`)을 Chromium 으로 열어
// 화면 상태마다 지정한 루트 요소의 `outerHTML` 을 파일로 쓴다. 컴포넌트를 옮기거나 쪼갠 전후에 같은 빌드
// 조건으로 두 번 떠서 `diff -r <전> <후>` 가 비어 있는지 본다(jsdom 렌더 테스트가 흉내만 내는 레이아웃·
// 가상화·Radix 포털 결과를 실제 브라우저로 덮는다).
//
//   node mock/dom-snapshot.mjs --out <dir> [--base http://localhost:3000] [--locale ko]
//        [--index mock/.generated/index.json] [--only values,filmstrip] [--headed] [--timeout 60000]
//
// 실행마다 달라지는 값(React `useId`·Radix 가 만든 id 와 그 id 를 가리키는 `aria-*`·`for`, blob URL)은
// 나온 순서대로 번호를 붙인 자리 표시로 바꾼다. 태그 사이에 줄바꿈을 넣어 diff 를 줄 단위로 읽을 수 있게 한다.
// 화면 이동은 스모크와 같은 helper(`mock/lib/smoke-scenarios.mjs`)와 같은 저장소 초기값을 쓴다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { chromium } from "playwright";

import {
  byTestId,
  eventually,
  longDocument,
  openJob,
  seedReviewStorage,
} from "./lib/smoke-scenarios.mjs";

const NEXT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_INDEX = "mock/.generated/index.json";

const DEFAULTS = {
  base: "http://localhost:3000",
  locale: "ko",
  timeout: 60_000,
};

/** 문서 목록 칼럼(필터 바·요약·가려짐 안내·제외 페이지 안내·문서 목록을 감싸는 섹션). */
const DOCUMENT_COLUMN = 'section[aria-labelledby="job-review-documents-title"]';
const VALUE_PANEL = "[data-value-panel]";

/** 이 시간 동안 캡처 대상 HTML 이 바뀌지 않으면 그려지기가 끝난 것으로 본다. */
const SETTLE_MS = 600;

/**
 * 화면 상태. `open` 이 화면을 그 상태로 만들고, `roots` 의 각 선택자가 가리키는 요소(첫 번째)를
 * `<state>--<name>.html` 로 쓴다.
 */
const STATES = [
  {
    name: "values",
    description: "값 탭, 13 쪽 이상 긴 문서 1 쪽(위치 바·값 패널)",
    async open(ctx) {
      const long = requireLongDocument(ctx.config.index);
      await openJob(
        ctx,
        { doc: long.document_id, page: "1" },
        "information-extract",
      );
      await ctx.page.waitForSelector(byTestId("job-review-position-bar"));
      await ctx.page.waitForSelector(VALUE_PANEL);
    },
    roots: {
      "document-column": DOCUMENT_COLUMN,
      "position-bar": byTestId("job-review-position-bar"),
      "value-panel": VALUE_PANEL,
    },
  },
  {
    name: "filmstrip",
    description: "구성 탭, 긴 문서 1 쪽(필름스트립 이웃 보기)",
    async open(ctx) {
      const long = requireLongDocument(ctx.config.index);
      await openJob(
        ctx,
        { doc: long.document_id, page: "1" },
        "document-classify",
      );
      await ctx.page.waitForSelector(byTestId("job-review-filmstrip"));
    },
    roots: {
      "document-column": DOCUMENT_COLUMN,
      filmstrip: byTestId("job-review-filmstrip"),
    },
  },
  {
    name: "organizer",
    description: "구성 탭, 긴 문서 1 쪽에서 페이지 정리 화면을 연 상태",
    async open(ctx) {
      const long = requireLongDocument(ctx.config.index);
      await openJob(
        ctx,
        { doc: long.document_id, page: "1" },
        "document-classify",
      );
      await ctx.page.waitForSelector(byTestId("job-review-filmstrip"));
      await ctx.page.getByTestId("job-review-viewer-button-organizer").click();
      await ctx.page.waitForSelector(byTestId("job-review-organizer"));
      await eventually(
        async () =>
          (await ctx.page
            .getByTestId("job-review-organizer-cell-select")
            .count()) > 0,
        5000,
      );
    },
    roots: {
      organizer: byTestId("job-review-organizer"),
    },
  },
];

const HELP = `검수 화면 DOM 캡처

  node mock/dom-snapshot.mjs --out <dir> [옵션]

옵션
  --out <dir>         캡처를 쓸 폴더 (필수, 없으면 만든다)
  --base <url>        앱 주소 (기본 ${DEFAULTS.base})
  --locale <l>        URL·브라우저 locale (기본 ${DEFAULTS.locale})
  --index <path>      mock 생성기의 index.json (기본 ${DEFAULT_INDEX})
  --only <a,b>        이 화면 상태만 (쉼표로 구분)
  --headed            브라우저 창을 보이게 실행
  --timeout <ms>      화면 상태 하나의 대기 상한 (기본 ${DEFAULTS.timeout})
  -h, --help          이 도움말

화면 상태: ${STATES.map(state => `${state.name}(${state.description})`).join(", ")}
`;

function fail(text) {
  console.error(text);
  process.exit(1);
}

function shortMessage(error) {
  const text = error instanceof Error ? error.message : String(error);
  return text.split("\n")[0].slice(0, 200);
}

function requireLongDocument(index) {
  const long = longDocument(index);
  if (!long)
    throw new Error(
      "index.json 에 긴 문서(longDocumentIndex)가 없습니다 — 20 쪽 넘는 Job 데이터가 필요합니다",
    );
  return long;
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

/**
 * 실행마다 달라지는 값을 자리 표시로 바꾼다. React `useId`(`_r_1_`·`«r1»`·`:r1:`)와 Radix 가 만든
 * `radix-…` id 는 처음 나온 순서대로 `id-1`, `id-2` … 로, blob URL 은 `blob:1` … 로 바꾼다. 같은 id 를
 * 가리키는 `aria-controls`·`aria-labelledby` 등은 같은 번호가 되므로 연결 관계는 diff 에 남는다.
 */
function normalizeHtml(html) {
  const ids = new Map();
  const blobs = new Map();
  const idOf = raw => {
    if (!ids.has(raw)) ids.set(raw, `id-${ids.size + 1}`);
    return ids.get(raw);
  };
  const generatedId =
    /(?:radix-)?(?:_r_[0-9a-z]+_|«r[0-9a-z]+»|:r[0-9a-z]+:|&laquo;r[0-9a-z]+&raquo;)/g;
  return html
    .replace(/blob:[^"'\s)]+/g, url => {
      if (!blobs.has(url)) blobs.set(url, `blob:${blobs.size + 1}`);
      return blobs.get(url);
    })
    .replace(generatedId, raw => idOf(raw))
    .replace(/></g, ">\n<");
}

/** 대상 HTML 이 `SETTLE_MS` 동안 그대로일 때까지 기다린다(이미지·지연 렌더·가상화 창 계산이 끝나게). */
async function settledHtml(page, selectors, timeoutMs) {
  const read = () =>
    page.evaluate(
      list =>
        list.map(
          selector => document.querySelector(selector)?.outerHTML ?? null,
        ),
      selectors,
    );
  const deadline = Date.now() + timeoutMs;
  let previous = await read();
  for (;;) {
    await page.waitForTimeout(SETTLE_MS);
    const current = await read();
    const same = current.every((html, index) => html === previous[index]);
    if (same) return current;
    if (Date.now() >= deadline)
      throw new Error(`DOM 이 ${timeoutMs} ms 안에 멈추지 않았습니다`);
    previous = current;
  }
}

async function captureState(browser, state, config) {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    locale: config.locale,
  });
  context.setDefaultTimeout(Math.min(15_000, config.timeout));
  await seedReviewStorage(context);
  const page = await context.newPage();
  try {
    await state.open({ page, context, config });
    await page.waitForLoadState("networkidle").catch(() => {});
    const entries = Object.entries(state.roots);
    const htmls = await settledHtml(
      page,
      entries.map(([, selector]) => selector),
      config.timeout,
    );
    const written = [];
    for (const [index, [name, selector]] of entries.entries()) {
      const html = htmls[index];
      if (html === null) throw new Error(`${name}: ${selector} 가 없습니다`);
      const file = join(config.out, `${state.name}--${name}.html`);
      writeFileSync(file, `${normalizeHtml(html)}\n`);
      written.push(`${state.name}--${name}.html`);
    }
    return written;
  } finally {
    await context.close().catch(() => {});
  }
}

async function main() {
  const { values } = parseArgs({
    // pnpm 10 은 `pnpm mock:dom -- --out x` 의 `--` 를 그대로 넘기므로 맨 앞 `--` 는 버린다.
    args: process.argv
      .slice(2)
      .filter((arg, index) => !(arg === "--" && index === 0)),
    options: {
      out: { type: "string" },
      base: { type: "string" },
      locale: { type: "string" },
      index: { type: "string" },
      only: { type: "string" },
      headed: { type: "boolean", default: false },
      timeout: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(HELP);
    return;
  }
  if (!values.out) fail(`--out 이 필요합니다\n\n${HELP}`);
  const only = values.only
    ? values.only
        .split(",")
        .map(name => name.trim())
        .filter(Boolean)
    : null;
  const unknown = (only ?? []).filter(
    name => !STATES.some(state => state.name === name),
  );
  if (unknown.length > 0) fail(`알 수 없는 화면 상태: ${unknown.join(", ")}`);
  const timeout =
    values.timeout === undefined ? DEFAULTS.timeout : Number(values.timeout);
  if (!Number.isInteger(timeout) || timeout < 1000)
    fail(`--timeout 은 1000 이상의 정수여야 합니다: ${values.timeout}`);

  const out = resolve(process.cwd(), values.out);
  mkdirSync(out, { recursive: true });
  const config = {
    index: loadIndex(values.index ?? DEFAULT_INDEX),
    base: (values.base ?? DEFAULTS.base).replace(/\/$/, ""),
    locale: values.locale ?? DEFAULTS.locale,
    timeout,
    out,
  };
  try {
    const response = await fetch(config.base, { redirect: "manual" });
    if (response.status >= 500) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    fail(
      `${config.base} 에 연결할 수 없습니다 (${shortMessage(error)}). pnpm mock:serve 와 pnpm build && pnpm mock:start 를 먼저 띄우세요.`,
    );
  }

  const states = only
    ? STATES.filter(state => only.includes(state.name))
    : STATES;
  const browser = await chromium.launch({ headless: !values.headed });
  let failed = 0;
  try {
    for (const state of states) {
      try {
        const files = await captureState(browser, state, config);
        console.log(`[OK] ${state.name} → ${files.join(", ")}`);
      } catch (error) {
        failed += 1;
        console.log(`[FAIL] ${state.name} — ${shortMessage(error)}`);
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
  if (failed > 0) process.exitCode = 1;
}

await main();
