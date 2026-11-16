#!/usr/bin/env node
// Job 검수 화면 성능 측정 하네스. mock 모드로 띄운 앱(`pnpm mock:serve` + `pnpm mock:start`)을
// headless Chromium 으로 열어 시간·네트워크 바이트·JS heap·DOM 수를 열여섯 단계에서 재고
// `mock/results/{label}-{시각}.json` + `.md` 로 남긴다. 두 결과의 차이는 `compare` 로 본다.
//
//   node mock/measure.mjs run --label before [--base http://localhost:3000] [--locale ko]
//        [--index mock/.generated/index.json] [--doc 30] [--scroll 40] [--jump 55]
//        [--values-doc 30] [--organizer-screens 8] [--runs 1] [--headed] [--gc] [--timeout 120000]
//   node mock/measure.mjs compare <a.json> <b.json>
//
// 단계: after-load(파일 로딩 끝) → structure-tab(구성 탭) → select-doc(문서 목록 n 번) →
// long-doc-scroll(긴 문서 m 쪽 넘기기) → jump-page(툴바로 k 쪽) → parse-tab(Parse 탭) →
// values-tab(값 탭) → jump-page-values(값 탭에서 같은 점프) → hover-highlight(값 탭 v 번 문서의 값
// 행 10 개를 가리킴) → select-highlight(값 행 10 개 선택) → organizer-tab(구성 탭으로 돌아감) →
// organizer-open(페이지 정리 열기) → organizer-scroll(격자 창을 창 높이씩 s 번 + 끝까지) →
// organizer-size-m(셀 크기 M) → organizer-click(보이는 첫 셀 클릭) → organizer-close(닫기).
// 정리 화면 여섯 단계는 앞 열 단계 뒤에 이어 재므로 heap·Nodes 는 누적값이고, 정리 화면 몫은
// organizer-open 대비 차로 본다. 정리 화면 토글이 없는 빌드는 여섯 단계를 skipped 로만 적는다.
// 앱이 남기는 User Timing 마크(`src/components/job-review/perf-marks.ts`)를 읽어 목록 준비·LOADED
// 시점과 점프의 앱 쪽 구간(`appMs`: 페이지 선택 → 그 페이지 이미지가 그려짐), 하이라이트 가리킴·선택의
// 앱 쪽 구간(`appMs`: 입력 → 그 렌더의 커밋 끝, 행 10 개의 중앙값)을 하네스 대기와 떼어 잰다.
// 각 단계는 `--timeout` 안에서만 기다리고, 실패하면 그 단계를 `skipped` 로 적고 `partial: true`
// 로 저장한다. 뷰어가 한 장씩 모드인지 연속 스크롤 모드인지는 DOM 으로 자동 판별한다.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { chromium } from "playwright";

import {
  NETWORK_CLASSES,
  compareMarkdown,
  compareResults,
  medianResults,
  toMarkdown,
} from "./lib/measure-report.mjs";

const NEXT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RESULTS_DIR = resolve(NEXT_DIR, "mock/results");
const DEFAULT_INDEX = "mock/.generated/index.json";

const DEFAULTS = {
  base: "http://localhost:3000",
  locale: "ko",
  doc: 30,
  scroll: 40,
  jump: 55,
  valuesDoc: 30,
  organizerScreens: 8,
  runs: 1,
  timeout: 120_000,
};

/** 뒤에 추가될 수 있는 UI 의 testid — 있으면 `present`, 없으면 `skipped` 로 기록만 한다. */
const OPTIONAL_TESTIDS = [
  "job-review-viewer-progress",
  "job-review-position-bar",
  "job-review-parse-switch-current-page",
  "job-review-draft-banner",
];

const METRIC_NAMES = [
  "JSHeapUsedSize",
  "JSHeapTotalSize",
  "Nodes",
  "Documents",
  "LayoutCount",
  "RecalcStyleCount",
];

/** 마지막 `/api/files/` 응답 뒤 이만큼 새 요청이 없으면 파일 로딩이 끝난 것으로 본다. */
const FILES_QUIET_MS = 1500;
/** 샘플 전 `/api/` 요청이 비기를 기다리는 상한. */
const API_IDLE_MS = 10_000;
/** 페이지를 넘긴 뒤 이미지 로드를 기다리는 상한(넘으면 세고 계속). */
const PAGE_IMAGE_MS = 2000;
/** hover-highlight·select-highlight 단계에서 재는 값 행 수. */
const HIGHLIGHT_ROWS = 10;
/** 하이라이트 입력 뒤 커밋 마크를 기다리는 상한(넘으면 하이라이트가 없는 행으로 보고 건너뜀). */
const HIGHLIGHT_COMMIT_MS = 1000;
/** 값 행을 고를 때 시도하는 후보 수의 상한. */
const HIGHLIGHT_CANDIDATES = 40;

/** 정리 화면 격자 창을 한 화면 내린 뒤 기다리는 시간. */
const ORGANIZER_SCROLL_WAIT_MS = 50;

/** 정리 화면(페이지 정리) testid. 토글이 없는 빌드면 정리 화면 단계를 `skipped` 로만 적는다. */
const ORGANIZER = {
  toggle: '[data-testid="job-review-viewer-button-organizer"]',
  grid: '[data-testid="job-review-organizer"]',
  viewport: '[data-testid="job-review-organizer-viewport"]',
  cell: '[data-testid="job-review-organizer-cell-select"]',
  sizeM: '[data-testid="job-review-organizer-size-m"]',
};

/** 앱이 남기는 User Timing 마크 이름(`src/components/job-review/perf-marks.ts` 와 같은 값). */
const MARKS = {
  selectPage: "review:select-page",
  pageImagePainted: "review:page-image-painted",
  documentListReady: "review:document-list-ready",
  loaded: "review:loaded",
  highlightInput: "review:highlight-input",
  highlightCommitted: "review:highlight-committed",
};

const HELP = `검수 화면 성능 측정

  node mock/measure.mjs run --label <name> [옵션]
  node mock/measure.mjs compare <a.json> <b.json>

run 옵션
  --label <name>     결과 파일 이름 앞부분 (필수, 영문·숫자·._-)
  --base <url>       앱 주소 (기본 ${DEFAULTS.base})
  --locale <l>       URL locale (기본 ${DEFAULTS.locale})
  --index <path>     mock 생성기의 index.json (기본 ${DEFAULT_INDEX})
  --doc <n>          select-doc 단계에서 고르는 문서 번호, 1 부터 (기본 ${DEFAULTS.doc})
  --scroll <n>       long-doc-scroll 단계에서 넘기는 쪽 수 (기본 ${DEFAULTS.scroll})
  --jump <n>         jump-page 단계에서 입력하는 쪽 번호 (기본 ${DEFAULTS.jump})
  --values-doc <n>   hover-highlight·select-highlight 단계에서 값 탭에 여는 문서 번호, 1 부터
                     (기본 ${DEFAULTS.valuesDoc}; 배열 50 행 기준은 mock:gen --items-max 60 의 30 번 문서)
  --organizer-screens <n>
                     organizer-scroll 단계에서 격자 창을 창 높이씩 내리는 횟수. 그 뒤 끝까지
                     한 번 더 내린다 (기본 ${DEFAULTS.organizerScreens})
  --runs <n>         반복 횟수. 2 이상이면 run 마다 파일 + 중앙값 파일 (기본 ${DEFAULTS.runs})
  --headed           브라우저 창을 보이게 실행
  --gc               샘플 전에 GC 를 강제한다 (heap 비교용 세트)
  --timeout <ms>     run 하나의 대기 상한 (기본 ${DEFAULTS.timeout})
  -h, --help         이 도움말
`;

function fail(text) {
  console.error(text);
  process.exit(1);
}

function integerOption(name, raw, fallback, min) {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    fail(`--${name} 은 ${min} 이상의 정수여야 합니다: ${raw}`);
  }
  return value;
}

function stamp(date = new Date()) {
  const pad = n => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

function gitCommit() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: NEXT_DIR,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function shortMessage(error) {
  const text = error instanceof Error ? error.message : String(error);
  return text.split("\n")[0].slice(0, 200);
}

/** 단계 안에서 던지면 그 단계를 재지 않고 `skipped` 로만 적는다(`partial` 은 세우지 않는다). */
class SkipStep extends Error {}

function loadIndex(path) {
  const indexPath = resolve(NEXT_DIR, path);
  if (!existsSync(indexPath)) {
    fail(
      `${relative(NEXT_DIR, indexPath)} 가 없습니다. 먼저 pnpm mock:gen 을 실행하세요.`,
    );
  }
  const index = JSON.parse(readFileSync(indexPath, "utf8"));
  const stepIdOf = type =>
    Object.entries(index.steps ?? {}).find(
      ([, step]) => step?.type === type,
    )?.[0] ?? null;
  return {
    index,
    classifyStepId: stepIdOf("document-classify"),
    parseStepId: stepIdOf("document-parse"),
    extractStepId: stepIdOf("information-extract"),
  };
}

const LOOPBACK_PAGES =
  /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\/pages\//;

function classifyRequest(request) {
  const url = request.url();
  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    // 상대·data URL 은 그대로 둔다.
  }
  if (/\/api\/search-collections\/[^/]+\/review-document(\/|$)/.test(pathname))
    return "reviewDocument";
  if (/\/api\/files\/[^/]+\/highlights(\/|$)/.test(pathname))
    return "fileHighlights";
  if (/\/api\/files\/[^/]+\/?$/.test(pathname)) return "files";
  if (/\/source-jobs\/[^/]+\/response(\/|$)/.test(pathname)) return "response";
  if (/\/source-jobs\/[^/]+\/figures\//.test(pathname)) return "figures";
  if (request.resourceType() === "image" || LOOPBACK_PAGES.test(url))
    return "images";
  return "other";
}

function isApiRequest(request) {
  try {
    return new URL(request.url()).pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

/**
 * 페이지의 요청을 클래스별로 세고(`count`·`bytes`(전송 바이트)·`decodedBytes`·`failed`),
 * `/api/` 와 `/api/files/` 의 in-flight 수, 페이지 이미지 요청 시작 수(`imagesSeen`)를
 * 추적한다. 크기는 `request.sizes()` 의 `responseBodySize`(-1 이면 `content-length`, 그것도
 * 없으면 0 + `unknownSizes`).
 */
function trackNetwork(page) {
  const byClass = Object.fromEntries(
    NETWORK_CLASSES.map(name => [
      name,
      { count: 0, bytes: 0, decodedBytes: 0, failed: 0 },
    ]),
  );
  const state = {
    apiInFlight: 0,
    filesInFlight: 0,
    filesSeen: 0,
    imagesSeen: 0,
    lastFilesEvent: 0,
    unknownSizes: 0,
    failures: [],
  };
  const classes = new WeakMap();
  const pending = new Set();

  const settle = request => {
    if (isApiRequest(request))
      state.apiInFlight = Math.max(0, state.apiInFlight - 1);
    if (classes.get(request) === "files") {
      state.filesInFlight = Math.max(0, state.filesInFlight - 1);
      state.lastFilesEvent = performance.now();
    }
  };

  page.on("request", request => {
    const cls = classifyRequest(request);
    classes.set(request, cls);
    if (isApiRequest(request)) state.apiInFlight += 1;
    if (cls === "files") {
      state.filesInFlight += 1;
      state.filesSeen += 1;
      state.lastFilesEvent = performance.now();
    }
    if (cls === "images") state.imagesSeen += 1;
  });

  page.on("requestfinished", request => {
    const cls = classes.get(request) ?? classifyRequest(request);
    settle(request);
    const entry = byClass[cls];
    entry.count += 1;
    const task = (async () => {
      const response = await request.response();
      const status = response?.status() ?? 0;
      let bytes = -1;
      try {
        bytes = (await request.sizes()).responseBodySize;
      } catch {
        bytes = -1;
      }
      if (bytes < 0) {
        const length = Number(response?.headers()["content-length"]);
        if (Number.isFinite(length) && length >= 0) bytes = length;
        else {
          bytes = 0;
          state.unknownSizes += 1;
        }
      }
      entry.bytes += bytes;
      if (cls !== "images" && cls !== "other" && response) {
        // `+=` 의 왼쪽을 await 앞에 읽으면 동시에 끝난 다른 응답의 합산을 덮어쓴다 — 길이를 먼저 구한다.
        let decoded = bytes;
        try {
          decoded = (await response.body()).length;
        } catch {
          // 본문을 다시 읽을 수 없으면(버퍼에서 밀려남) 전송 바이트로 대신한다.
        }
        entry.decodedBytes += decoded;
      } else {
        entry.decodedBytes += bytes;
      }
      if (status >= 400) {
        entry.failed += 1;
        state.failures.push({ url: request.url(), status });
      }
    })().catch(() => {});
    pending.add(task);
    task.finally(() => pending.delete(task));
  });

  page.on("requestfailed", request => {
    const cls = classes.get(request) ?? classifyRequest(request);
    settle(request);
    byClass[cls].count += 1;
    byClass[cls].failed += 1;
    state.failures.push({
      url: request.url(),
      error: request.failure()?.errorText ?? "failed",
    });
  });

  return {
    state,
    async flush() {
      await Promise.allSettled([...pending]);
    },
    summary() {
      const totals = Object.values(byClass).reduce(
        (acc, entry) => ({
          bytes: acc.bytes + entry.bytes,
          decodedBytes: acc.decodedBytes + entry.decodedBytes,
          count: acc.count + entry.count,
          failed: acc.failed + entry.failed,
        }),
        { bytes: 0, decodedBytes: 0, count: 0, failed: 0 },
      );
      return {
        byClass,
        totalBytes: totals.bytes,
        totalDecodedBytes: totals.decodedBytes,
        totalRequests: totals.count,
        failedCount: totals.failed,
        unknownSizes: state.unknownSizes,
        failures: state.failures.slice(0, 50),
      };
    },
  };
}

/** `predicate()` 가 참이 될 때까지 100 ms 간격으로 기다린다(상한 넘으면 throw). */
async function waitUntil(predicate, timeoutMs, what) {
  const deadline = performance.now() + Math.max(1, timeoutMs);
  for (;;) {
    if (predicate()) return;
    if (performance.now() >= deadline) {
      throw new Error(
        `timeout waiting for ${what} (${Math.round(timeoutMs)} ms)`,
      );
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
}

/**
 * 브라우저 안에서 평가: 현재 페이지 이미지가 보이는지, 어느 뷰어 모드인지. 연속 스크롤 모드는
 * 보이는 페이지만 그리므로(첫 페이지는 멀리 가면 DOM 에서 빠진다) 툴바 페이지 입력이 가리키는
 * 페이지의 `<img>` 를 본다.
 */
function viewerReadyInPage() {
  const continuousPages = document.querySelectorAll(
    '[data-testid^="continuous-page-"]',
  );
  if (continuousPages.length > 0) {
    const input = document.querySelector(
      '[data-testid="job-review-viewer-toolbar-page-input"]',
    );
    const current = input ? Number(input.value) - 1 : 0;
    const image = document.querySelector(
      `[data-testid="continuous-page-${current}"] img`,
    );
    return image && image.complete && image.naturalWidth > 0
      ? "continuous"
      : false;
  }
  const canvas = document.querySelector(
    '[data-testid="job-review-viewer"] [data-testid="image-canvas"]',
  );
  if (canvas && !canvas.classList.contains("opacity-0")) return "paged";
  return false;
}

/** 브라우저 안에서 평가: 이름별 첫 마크의 `startTime`(navigation 기준 ms). 없으면 `null`. */
function firstMarkTimesInPage(names) {
  return Object.fromEntries(
    names.map(name => [
      name,
      performance.getEntriesByName(name, "mark")[0]?.startTime ?? null,
    ]),
  );
}

/**
 * 브라우저 안에서 평가: `page`(1-based) 를 고른 첫 `select-page` 마크와 그 뒤 같은 페이지의 첫
 * `page-image-painted` 마크. 둘 다 있으면 `{select, painted, source}`, 아니면 `null`.
 */
function jumpMarksInPage({ page, selectName, paintedName }) {
  const select = performance
    .getEntriesByName(selectName, "mark")
    .find(entry => entry.detail?.page === page);
  if (!select) return null;
  const painted = performance
    .getEntriesByName(paintedName, "mark")
    .find(
      entry =>
        entry.detail?.page === page && entry.startTime >= select.startTime,
    );
  if (!painted) return null;
  return {
    select: select.startTime,
    painted: painted.startTime,
    source: select.detail?.source ?? null,
  };
}

/** 브라우저 안에서 평가: 첫 `select-page` 마크의 `{page, source}`. 없으면 `null`. */
function firstSelectMarkInPage(selectName) {
  const entry = performance.getEntriesByName(selectName, "mark")[0];
  if (!entry || typeof entry.detail?.page !== "number") return null;
  return { page: entry.detail.page, source: entry.detail.source ?? null };
}

/**
 * 브라우저 안에서 평가: 정리 화면 격자 창 안에 온전히 보이는 첫 셀. 뷰어가 가리키는 셀
 * (`aria-current`)과 제외 칸 셀(문서 없음)은 건너뛰고, `skipDocumentId`(지금 선택된 문서)의 셀은
 * 다른 문서의 셀이 없을 때만 고른다 — 같은 문서의 이웃 쪽은 연속 뷰어가 이미 그려 두어 그림 마크가
 * 남지 않는다. `index` 는 문서 전체의 셀 selector 순서(Playwright `nth`).
 */
function visibleCellInPage({ viewport, cell, skipDocumentId }) {
  const box = document.querySelector(viewport)?.getBoundingClientRect();
  if (!box) return null;
  const cells = [...document.querySelectorAll(cell)];
  const documentOf = element =>
    element.closest("[data-document-id]")?.getAttribute("data-document-id") ??
    null;
  const pick = allowSameDocument =>
    cells.findIndex(element => {
      if (element.getAttribute("aria-current") === "true") return false;
      const documentId = documentOf(element);
      if (documentId === null) return false;
      if (!allowSameDocument && documentId === skipDocumentId) return false;
      const rect = element.getBoundingClientRect();
      return (
        rect.height > 0 && rect.top >= box.top && rect.bottom <= box.bottom
      );
    });
  let index = pick(false);
  const sameDocument = index < 0;
  if (sameDocument) index = pick(true);
  if (index < 0) return null;
  return { index, documentId: documentOf(cells[index]), sameDocument };
}

/**
 * 브라우저 안에서 평가: 값 탭에서 가리키거나 고를 값 행 후보의 `data-field-id`. 배열 표는 행마다
 * 첫 칸 하나, 그 뒤 일반 필드 행. 하이라이트가 있는지는 DOM 으로 알 수 없어 하네스가 커밋 마크로
 * 거른다. `focusable` 이면 글자 입력(값 위젯의 한 줄·여러 줄 입력, 비활성 제외)이 있는 후보만.
 */
function highlightCandidatesInPage({ limit, focusable }) {
  const tableCells = [
    ...document.querySelectorAll('[data-testid="job-review-tree-table"] tr'),
  ]
    .map(row => row.querySelector("td[data-field-id]"))
    .filter(Boolean);
  const fieldRows = [
    ...document.querySelectorAll(
      '[data-testid="job-review-field-row"][data-field-id]',
    ),
  ];
  const textInput =
    '[data-testid="job-review-field-input-value"]:not([disabled]), [data-testid="job-review-field-textarea-value"]:not([disabled])';
  return [...tableCells, ...fieldRows]
    .filter(element => !focusable || element.querySelector(textInput))
    .slice(0, limit)
    .map(element => element.getAttribute("data-field-id"));
}

/**
 * 브라우저 안에서 평가: 첫 하이라이트 입력 마크(`kind`) → 그 뒤 첫 커밋 마크 구간(ms). 커밋이
 * 없으면 `null`.
 */
function highlightSpanInPage({ inputName, committedName, kind }) {
  const input = performance
    .getEntriesByName(inputName, "mark")
    .find(entry => entry.detail?.kind === kind);
  if (!input) return null;
  const committed = performance
    .getEntriesByName(committedName, "mark")
    .find(entry => entry.startTime >= input.startTime);
  return committed ? committed.startTime - input.startTime : null;
}

function domCountsInPage(optionalIds) {
  const count = selector => document.querySelectorAll(selector).length;
  return {
    thumbnails: count('[data-testid="job-review-filmstrip-thumbnail-select"]'),
    documentRows: count(
      '[data-testid="job-review-document-list-button-select"]',
    ),
    cells: count('[data-testid="job-review-organizer-cell-select"]'),
    images: document.images.length,
    optional: Object.fromEntries(
      optionalIds.map(id => [
        id,
        document.querySelector(`[data-testid="${id}"]`) ? "present" : "skipped",
      ]),
    ),
  };
}

async function runOnce(config, runNumber) {
  const { index, classifyStepId, parseStepId, extractStepId } = config;
  const url = `${config.base.replace(/\/$/, "")}/${config.locale}/collections/${index.ids.collection}/jobs/${index.ids.job}`;
  const longDocument =
    index.longDocumentIndex === null || index.longDocumentIndex === undefined
      ? null
      : index.documents[index.longDocumentIndex];

  const result = {
    label: config.label,
    at: new Date().toISOString(),
    commit: gitCommit(),
    base: config.base,
    url,
    viewerMode: null,
    browser: null,
    dataset: {
      options: index.options,
      totalPages: index.totalPages,
      documents: index.documents?.length ?? null,
      longDocumentIndex: index.longDocumentIndex ?? null,
      longDocumentPages: longDocument?.pages ?? null,
      files: index.files,
    },
    options: {
      doc: config.doc,
      scroll: config.scroll,
      jump: config.jump,
      valuesDoc: config.valuesDoc,
      organizerScreens: config.organizerScreens,
      runs: config.runs,
      run: runNumber,
      gc: config.gc,
      timeout: config.timeout,
      locale: config.locale,
      headed: config.headed,
    },
    timings: {
      ttfb: null,
      domContentLoaded: null,
      loaded: null,
      documentList: null,
      documentListSource: null,
      firstPageImage: null,
      filesDone: null,
    },
    network: null,
    samples: [],
    console: { errors: 0, warnings: 0, pageErrors: 0, firstErrors: [] },
    partial: false,
  };
  const problems = [];

  const browser = await chromium.launch({
    headless: !config.headed,
    args: ["--enable-precise-memory-info"],
  });
  result.browser = `Chromium ${browser.version()}`;
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    locale: config.locale,
  });
  // 구성 탭 필름스트립은 기본이 접힘이라, 기존 결과와 같은 화면(펼침)으로 잰다. 기본에서 빠지는
  // Parse 단계와 페이지 도구·정리 화면도 스모크(`mock/smoke.mjs`)와 같이 켜야 parse-tab·organizer-*
  // 단계를 잴 수 있다.
  // 값 패널 하이라이트 마크는 가리킬 때마다 쌓여 앱이 평소에는 남기지 않는다. 측정 페이지에서만 켠다
  // (`perf-marks.ts` 의 `HIGHLIGHT_MARKS_FLAG`).
  await context.addInitScript(() => {
    window.__reviewHighlightMarks = true;
  });
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem("review-filmstrip", "open");
      window.localStorage.setItem(
        "review-steps",
        JSON.stringify({ parse: true, instruct: true }),
      );
      window.localStorage.setItem(
        "review-features",
        JSON.stringify({
          pageTools: true,
          filmstrip: true,
          organizer: true,
          jsonMenu: true,
        }),
      );
    } catch {
      // 저장소가 막혀 있으면 기본(접힘) 그대로.
    }
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  if (config.gc) await cdp.send("HeapProfiler.enable");

  page.on("console", message => {
    const type = message.type();
    if (type === "error") {
      result.console.errors += 1;
      if (result.console.firstErrors.length < 5)
        result.console.firstErrors.push(message.text().slice(0, 200));
    } else if (type === "warning") {
      result.console.warnings += 1;
    }
  });
  page.on("pageerror", error => {
    result.console.pageErrors += 1;
    if (result.console.firstErrors.length < 5)
      result.console.firstErrors.push(`pageerror: ${shortMessage(error)}`);
  });
  const network = trackNetwork(page);

  const t0 = performance.now();
  const deadline = t0 + config.timeout;
  const elapsed = () => Math.round(performance.now() - t0);
  const remaining = () => Math.max(1, Math.round(deadline - performance.now()));
  const bounded = cap => Math.min(cap, remaining());

  const waitViewerReady = async timeoutMs => {
    const handle = await page.waitForFunction(viewerReadyInPage, null, {
      timeout: timeoutMs,
      polling: 100,
    });
    const mode = await handle.jsonValue();
    await handle.dispose();
    return mode;
  };
  const settleFrames = () =>
    page.evaluate(
      () =>
        new Promise(resolveFrames =>
          requestAnimationFrame(() => requestAnimationFrame(resolveFrames)),
        ),
    );
  const pageInputValue = () =>
    page
      .locator('[data-testid="job-review-viewer-toolbar-page-input"]')
      .inputValue({ timeout: remaining() });
  const waitPageInput = expected =>
    page.waitForFunction(
      value =>
        document.querySelector(
          '[data-testid="job-review-viewer-toolbar-page-input"]',
        )?.value === String(value),
      expected,
      { timeout: remaining(), polling: 100 },
    );
  const selectDocument = async nth => {
    const buttons = page.locator(
      '[data-testid="job-review-document-list-button-select"]',
    );
    const total = await buttons.count();
    if (nth < 0 || nth >= total) {
      throw new Error(
        `document ${nth + 1} is out of range (list has ${total})`,
      );
    }
    await buttons.nth(nth).click({ timeout: remaining() });
    await page.waitForFunction(
      n =>
        document
          .querySelectorAll(
            '[data-testid="job-review-document-list-button-select"]',
          )
          [n]?.getAttribute("aria-current") === "true",
      nth,
      { timeout: remaining(), polling: 100 },
    );
    await settleFrames();
    return waitViewerReady(remaining());
  };

  const clearJumpMarks = () =>
    page.evaluate(
      names => names.forEach(name => performance.clearMarks(name)),
      [MARKS.selectPage, MARKS.pageImagePainted],
    );
  /**
   * 점프의 앱 쪽 구간: `jump` 쪽을 고른 마크 → 그 쪽 이미지가 그려진 마크. 그림 마크는 이미지 로드
   * 다음 프레임에 찍히므로 잠깐 기다린다. 마크가 없으면 `appMs: null`.
   */
  const readJumpMarks = async jump => {
    const args = {
      page: jump,
      selectName: MARKS.selectPage,
      paintedName: MARKS.pageImagePainted,
    };
    try {
      const handle = await page.waitForFunction(jumpMarksInPage, args, {
        timeout: bounded(PAGE_IMAGE_MS),
        polling: 50,
      });
      const marks = await handle.jsonValue();
      await handle.dispose();
      return {
        appMs: Math.round(marks.painted - marks.select),
        selectSource: marks.source,
      };
    } catch {
      return { appMs: null };
    }
  };
  /** 툴바 페이지 입력으로 `target` 쪽에 가서 이미지가 보일 때까지 기다린다. */
  const jumpWithToolbar = async target => {
    const input = page.getByTestId("job-review-viewer-toolbar-page-input");
    await input.click({ timeout: remaining() });
    await input.fill(String(target), { timeout: remaining() });
    await input.press("Enter", { timeout: remaining() });
    await waitPageInput(target);
    await settleFrames();
    await waitViewerReady(remaining());
  };

  const sample = async (name, stepStart, notes) => {
    try {
      await waitUntil(
        () => network.state.apiInFlight === 0,
        bounded(API_IDLE_MS),
        "/api/ idle",
      );
    } catch (error) {
      problems.push(`${name}: ${shortMessage(error)}`);
    }
    await settleFrames();
    const stepMs = Math.round(performance.now() - stepStart);
    if (config.gc) await cdp.send("HeapProfiler.collectGarbage");
    const { metrics } = await cdp.send("Performance.getMetrics");
    const picked = Object.fromEntries(
      metrics
        .filter(metric => METRIC_NAMES.includes(metric.name))
        .map(metric => [metric.name, metric.value]),
    );
    const { optional, ...dom } = await page.evaluate(
      domCountsInPage,
      OPTIONAL_TESTIDS,
    );
    const entry = {
      name,
      elapsedMs: elapsed(),
      stepMs,
      metrics: picked,
      dom,
      optional,
    };
    if (notes && "appMs" in notes) entry.appMs = notes.appMs;
    if (notes && Object.keys(notes).length > 0) entry.notes = notes;
    return entry;
  };

  // `action` 이 준비 동작을 마친 뒤 `restart()` 를 부르면 그 시점부터 단계 시간을 잰다.
  // `SkipStep` 을 던지면 재지 않고 `skipped` 로만 적는다(`partial` 아님).
  const step = async (name, action) => {
    let started = performance.now();
    const restart = () => {
      started = performance.now();
    };
    try {
      const notes = await action(restart);
      result.samples.push(await sample(name, started, notes ?? undefined));
    } catch (error) {
      if (error instanceof SkipStep) {
        result.samples.push({ name, skipped: error.message });
        return;
      }
      result.partial = true;
      const message = shortMessage(error);
      problems.push(`${name}: ${message}`);
      result.samples.push({ name, skipped: message });
    }
  };

  try {
    // 1. 첫 로드: 문서 목록 → 첫 페이지 이미지 → 파일 로딩 끝.
    await step("after-load", async () => {
      try {
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: remaining(),
        });
      } catch (error) {
        throw new Error(
          `${shortMessage(error)} — 앱이 ${config.base} 에 떠 있는지 확인하세요 (pnpm mock:serve + pnpm build && pnpm mock:start)`,
        );
      }
      const navigation = await page.evaluate(() => {
        const entry = performance.getEntriesByType("navigation")[0];
        return entry
          ? {
              ttfb: entry.responseStart,
              domContentLoaded: entry.domContentLoadedEventEnd,
            }
          : null;
      });
      if (navigation) {
        result.timings.ttfb = Math.round(navigation.ttfb);
        result.timings.domContentLoaded = Math.round(
          navigation.domContentLoaded,
        );
      }
      await page.waitForSelector('[data-testid="job-review-document-list"]', {
        timeout: remaining(),
      });
      const polledDocumentList = elapsed();
      result.viewerMode = await waitViewerReady(remaining());
      result.timings.firstPageImage = elapsed();
      // 마크는 페이지 시계(navigation 기준, ttfb 와 같은 기준)라 하네스 폴링 지연이 없다. 마크가
      // 없는 앱(옛 빌드)이면 폴링 값(페이지 열기 기준)을 쓴다.
      const marks = await page.evaluate(firstMarkTimesInPage, [
        MARKS.loaded,
        MARKS.documentListReady,
      ]);
      if (marks[MARKS.loaded] !== null)
        result.timings.loaded = Math.round(marks[MARKS.loaded]);
      if (marks[MARKS.documentListReady] !== null) {
        result.timings.documentList = Math.round(
          marks[MARKS.documentListReady],
        );
        result.timings.documentListSource = "mark";
      } else {
        result.timings.documentList = polledDocumentList;
        result.timings.documentListSource = "poll";
      }
      await waitUntil(
        () =>
          network.state.filesSeen > 0 &&
          network.state.filesInFlight === 0 &&
          performance.now() - network.state.lastFilesEvent >= FILES_QUIET_MS,
        remaining(),
        "/api/files/ to finish",
      );
      result.timings.filesDone = Math.round(network.state.lastFilesEvent - t0);
    });

    // 2. 구성 탭(필름스트립).
    await step("structure-tab", async () => {
      if (!classifyStepId)
        throw new Error("index.json 에 document-classify step 이 없습니다");
      await page
        .getByTestId(`job-review-step-tab-${classifyStepId}`)
        .click({ timeout: remaining() });
      await page.waitForSelector('[data-testid="job-review-filmstrip"]', {
        timeout: remaining(),
      });
    });

    // 3. 문서 목록에서 n 번 문서 선택.
    await step("select-doc", async () => {
      await selectDocument(config.doc - 1);
    });

    // 4. 긴 문서를 골라 m 쪽 넘기기(한 장씩: 다음 버튼, 연속: 스크롤).
    await step("long-doc-scroll", async () => {
      if (!longDocument)
        throw new Error("index.json 에 긴 문서(longDocumentIndex)가 없습니다");
      const mode = await selectDocument(index.longDocumentIndex);
      const notes = { mode, pagesAdvanced: 0, imageTimeouts: 0 };
      if (mode === "paged") {
        const next = page.getByTestId("job-review-viewer-toolbar-next-page");
        for (let i = 0; i < config.scroll; i += 1) {
          await next.click({ timeout: remaining() });
          await waitPageInput(i + 2);
          notes.pagesAdvanced += 1;
          try {
            await waitViewerReady(bounded(PAGE_IMAGE_MS));
          } catch {
            notes.imageTimeouts += 1;
          }
        }
      } else {
        const scroller = page.locator(
          '[data-testid="job-review-viewer-scroll"]',
        );
        const maxIterations = config.scroll * 4;
        for (let i = 0; i < maxIterations; i += 1) {
          const current = Number(await pageInputValue());
          if (current >= config.scroll + 1) break;
          await scroller.evaluate(element => {
            element.scrollTop += element.clientHeight;
          });
          await page.waitForTimeout(50);
          await settleFrames();
          notes.pagesAdvanced = Math.max(0, Number(await pageInputValue()) - 1);
          if (performance.now() > deadline)
            throw new Error("timeout while scrolling");
        }
        if (Number(await pageInputValue()) < config.scroll + 1) {
          throw new Error(
            `scrolled ${maxIterations} times but page input is ${await pageInputValue()}`,
          );
        }
      }
      return notes;
    });

    // 5. 툴바 페이지 입력으로 k 쪽 점프.
    await step("jump-page", async restart => {
      if (longDocument && config.jump > longDocument.pages) {
        throw new Error(
          `--jump ${config.jump} 이 긴 문서 쪽수(${longDocument.pages})보다 큽니다`,
        );
      }
      await clearJumpMarks();
      restart();
      await jumpWithToolbar(config.jump);
      return readJumpMarks(config.jump);
    });

    // 6. Parse 탭.
    await step("parse-tab", async () => {
      if (!parseStepId)
        throw new Error("index.json 에 document-parse step 이 없습니다");
      await page
        .getByTestId(`job-review-step-tab-${parseStepId}`)
        .click({ timeout: remaining() });
      await page.waitForSelector('[data-testid="job-review-parse"]', {
        timeout: remaining(),
      });
    });

    // 7. 값 탭(필름스트립·구조 툴바 없음, 긴 문서는 위치 바).
    await step("values-tab", async () => {
      if (!extractStepId)
        throw new Error("index.json 에 information-extract step 이 없습니다");
      await page
        .getByTestId(`job-review-step-tab-${extractStepId}`)
        .click({ timeout: remaining() });
      await page.waitForSelector('[data-testid="job-review-position-bar"]', {
        timeout: remaining(),
      });
    });

    // 8. 값 탭에서 jump-page 와 같은 점프(출발 쪽으로 먼저 옮긴 뒤 잰다). 구성 탭 점프와의 차이가
    //    필름스트립·구조 툴바 몫이다.
    await step("jump-page-values", async restart => {
      if (longDocument && config.jump > longDocument.pages) {
        throw new Error(
          `--jump ${config.jump} 이 긴 문서 쪽수(${longDocument.pages})보다 큽니다`,
        );
      }
      const from = Math.min(1 + config.scroll, longDocument?.pages ?? 1);
      await jumpWithToolbar(from);
      await settleFrames();
      await clearJumpMarks();
      restart();
      await jumpWithToolbar(config.jump);
      return { from, ...(await readJumpMarks(config.jump)) };
    });

    // 하이라이트 두 단계: 값 탭에서 `--values-doc` 문서를 열고 값 행 10 개를 가리키거나(hover) 고른다
    // (입력에 포커스 — 행의 onFocusCapture 가 선택). 행마다 마크를 지우고 "입력 마크 → 커밋 마크"
    // 구간을 재며, 샘플의 `appMs` 는 그 중앙값(notes 에 행별 값·최대). 커밋이 없는 행(하이라이트가
    // 없거나 이미 같은 하이라이트)은 건너뛰고 다음 후보를 쓴다.
    const highlightSelector = id => `[data-field-id=${JSON.stringify(id)}]`;
    const clearHighlightMarks = () =>
      page.evaluate(
        names => names.forEach(name => performance.clearMarks(name)),
        [MARKS.highlightInput, MARKS.highlightCommitted],
      );
    const readHighlightSpan = async kind => {
      try {
        const handle = await page.waitForFunction(
          highlightSpanInPage,
          {
            inputName: MARKS.highlightInput,
            committedName: MARKS.highlightCommitted,
            kind,
          },
          { timeout: bounded(HIGHLIGHT_COMMIT_MS), polling: 20 },
        );
        const span = await handle.jsonValue();
        await handle.dispose();
        return span;
      } catch {
        return null;
      }
    };
    /** 마우스를 값 패널 밖(상단 바 왼쪽 끝)으로 옮겨 가리킨 하이라이트를 지운다. */
    const pointerAway = async () => {
      await page.mouse.move(2, 2);
      await settleFrames();
    };
    const measureHighlights = async (kind, action) => {
      const ids = await page.evaluate(highlightCandidatesInPage, {
        limit: HIGHLIGHT_CANDIDATES,
        focusable: kind === "select",
      });
      const spans = [];
      let skippedRows = 0;
      for (const id of ids) {
        if (spans.length >= HIGHLIGHT_ROWS) break;
        const target = page.locator(highlightSelector(id)).first();
        await pointerAway();
        await target.evaluate(element =>
          element.scrollIntoView({ block: "center" }),
        );
        await settleFrames();
        await clearHighlightMarks();
        await action(target);
        const span = await readHighlightSpan(kind);
        if (span === null) skippedRows += 1;
        else spans.push(Math.round(span * 10) / 10);
        try {
          await waitUntil(
            () => network.state.apiInFlight === 0,
            bounded(API_IDLE_MS),
            "/api/ idle",
          );
        } catch {
          // 다음 행으로 — 샘플 전에 다시 기다린다.
        }
        if (performance.now() > deadline)
          throw new Error(`timeout while measuring ${kind}`);
      }
      await pointerAway();
      if (spans.length === 0)
        throw new Error(`no value row with a highlight (${kind})`);
      const sorted = [...spans].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const medianMs =
        sorted.length % 2 === 1
          ? sorted[mid]
          : (sorted[mid - 1] + sorted[mid]) / 2;
      return {
        appMs: Math.round(medianMs * 10) / 10,
        rows: spans.length,
        maxMs: sorted[sorted.length - 1],
        skippedRows,
        spans,
      };
    };

    // 9. 값 탭에서 `--values-doc` 문서를 열고 값 행 10 개를 차례로 가리킨다.
    let tableRows = null;
    await step("hover-highlight", async restart => {
      if (!extractStepId)
        throw new Error("index.json 에 information-extract step 이 없습니다");
      await selectDocument(config.valuesDoc - 1);
      await page.waitForSelector('[data-testid="job-review-field-row"]', {
        timeout: remaining(),
      });
      await settleFrames();
      tableRows = await page.evaluate(
        () =>
          document.querySelectorAll(
            '[data-testid="job-review-tree-table"] tbody tr',
          ).length,
      );
      restart();
      const notes = await measureHighlights("hover", async target => {
        const box = await target.boundingBox();
        if (!box) return;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      });
      return { document: config.valuesDoc, tableRows, ...notes };
    });

    // 10. 같은 문서의 값 행 10 개를 차례로 고른다(글자 입력에 포커스).
    await step("select-highlight", async restart => {
      if (!extractStepId)
        throw new Error("index.json 에 information-extract step 이 없습니다");
      restart();
      const notes = await measureHighlights("select", target =>
        target.evaluate(element => {
          element
            .querySelector(
              '[data-testid="job-review-field-input-value"]:not([disabled]), [data-testid="job-review-field-textarea-value"]:not([disabled])',
            )
            ?.focus({ preventScroll: true });
        }),
      );
      return { document: config.valuesDoc, tableRows, ...notes };
    });

    // 정리 화면 여섯 단계. 앞 단계와 같은 브라우저 컨텍스트에 이어 재므로 heap·Nodes 는 누적값이고,
    // 정리 화면 몫은 organizer-open 대비 차로 본다. 토글이 없는 빌드면 여섯 단계 모두 skipped.
    let organizerMissing = false;
    const organizerStep = (name, action) =>
      step(name, async restart => {
        if (organizerMissing) throw new SkipStep("no organizer");
        return action(restart);
      });
    const viewportBox = () =>
      page.locator(ORGANIZER.viewport).evaluate(element => ({
        scrollTop: Math.round(element.scrollTop),
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
      }));
    /** 격자 창을 한 화면(또는 끝까지) 내리고 잠깐 기다린다. */
    const scrollViewport = async toEnd => {
      await page.locator(ORGANIZER.viewport).evaluate((element, end) => {
        element.scrollTop = end
          ? element.scrollHeight
          : element.scrollTop + element.clientHeight;
      }, toEnd);
      await page.waitForTimeout(ORGANIZER_SCROLL_WAIT_MS);
      await settleFrames();
    };
    const imageRequests = () => ({
      started: network.state.imagesSeen,
      finished: network.summary().byClass.images.count,
    });
    /** 셀 클릭 직후 첫 `select-page` 마크(대상 쪽은 마크가 알려 준다). 없으면 `null`. */
    const readSelectMark = async () => {
      try {
        const handle = await page.waitForFunction(
          firstSelectMarkInPage,
          MARKS.selectPage,
          { timeout: bounded(PAGE_IMAGE_MS), polling: 50 },
        );
        const mark = await handle.jsonValue();
        await handle.dispose();
        return mark;
      } catch {
        return null;
      }
    };
    /**
     * 뷰어 툴바가 `expected` 쪽을 가리킬 때까지. 1 쪽 문서는 페이지 입력 대신 글자
     * (`…-page-label`)를 그리므로 둘 다 본다(`waitPageInput` 은 여러 쪽 문서 전용).
     */
    const waitViewerPage = expected =>
      page.waitForFunction(
        value => {
          const input = document.querySelector(
            '[data-testid="job-review-viewer-toolbar-page-input"]',
          );
          if (input) return input.value === String(value);
          const label = document.querySelector(
            '[data-testid="job-review-viewer-toolbar-page-label"]',
          );
          return label?.textContent?.trim() === String(value);
        },
        expected,
        { timeout: remaining(), polling: 100 },
      );

    // 11. 구성 탭으로 돌아간다(필름스트립 띠가 다시 보임). 정리 화면 토글이 없으면 여기서부터 skipped.
    await organizerStep("organizer-tab", async () => {
      await page
        .getByTestId(`job-review-step-tab-${classifyStepId}`)
        .click({ timeout: remaining() });
      await page.waitForSelector('[data-testid="job-review-filmstrip"]', {
        timeout: remaining(),
      });
      if ((await page.locator(ORGANIZER.toggle).count()) === 0) {
        organizerMissing = true;
        throw new SkipStep("no organizer");
      }
    });

    // 12. 페이지 정리 열기: 작업 패널 자리에 격자(보이는 행만), 띠는 숨는다.
    await organizerStep("organizer-open", async () => {
      await page.locator(ORGANIZER.toggle).click({ timeout: remaining() });
      await page.waitForSelector(ORGANIZER.grid, { timeout: remaining() });
      await page.waitForFunction(
        selector => document.querySelectorAll(selector).length > 0,
        ORGANIZER.cell,
        { timeout: remaining(), polling: 50 },
      );
      await settleFrames();
      return viewportBox();
    });

    // 13. 격자 창을 창 높이씩 s 번 + 끝까지 내린다(각 50 ms 대기). notes 에 페이지 이미지 요청
    //     증가분(시작·완료)·끝 scrollTop·그려진 셀 수.
    await organizerStep("organizer-scroll", async () => {
      const before = imageRequests();
      const screens = config.organizerScreens;
      for (let i = 0; i <= screens; i += 1) {
        await scrollViewport(i === screens);
        if (performance.now() > deadline)
          throw new Error("timeout while scrolling the organizer");
      }
      const after = imageRequests();
      return {
        screens,
        waitMs: ORGANIZER_SCROLL_WAIT_MS,
        ...(await viewportBox()),
        cells: await page.locator(ORGANIZER.cell).count(),
        imagesStarted: after.started - before.started,
        imagesFinished: after.finished - before.finished,
      };
    });

    // 14. 셀 크기 M(열 수가 줄고 행이 늘어남; 선택 행을 다시 드러내며 창이 움직일 수 있다).
    await organizerStep("organizer-size-m", async () => {
      await page.locator(ORGANIZER.sizeM).click({ timeout: remaining() });
      await page.waitForFunction(
        selector =>
          document.querySelector(selector)?.getAttribute("aria-pressed") ===
          "true",
        ORGANIZER.sizeM,
        { timeout: remaining(), polling: 50 },
      );
      await settleFrames();
    });

    // 15. 보이는 첫 셀 클릭 → 뷰어가 그 문서·쪽으로(`appMs`, source organizer). 준비로 창을 끝까지
    //     내려(크기 토글 뒤 선택 행 드러내기로 창이 옮겨졌을 수 있다) 지금 선택된 문서가 아닌 셀을
    //     고른다. 대상 쪽은 클릭이 남긴 select-page 마크에서 읽는다.
    await organizerStep("organizer-click", async restart => {
      await scrollViewport(true);
      const selectedDocument = new URL(page.url()).searchParams.get("doc");
      const target = await page.evaluate(visibleCellInPage, {
        viewport: ORGANIZER.viewport,
        cell: ORGANIZER.cell,
        skipDocumentId: selectedDocument,
      });
      if (!target) throw new Error("no visible organizer cell to click");
      await clearJumpMarks();
      restart();
      await page
        .locator(ORGANIZER.cell)
        .nth(target.index)
        .click({ timeout: remaining() });
      const mark = await readSelectMark();
      if (!mark) throw new Error("no select-page mark after clicking a cell");
      await waitViewerPage(mark.page);
      await settleFrames();
      await waitViewerReady(remaining());
      return {
        documentId: target.documentId,
        sameDocument: target.sameDocument,
        page: mark.page,
        ...(await readJumpMarks(mark.page)),
      };
    });

    // 16. 페이지 정리 닫기: 작업 패널·띠가 돌아온다.
    await organizerStep("organizer-close", async () => {
      await page.locator(ORGANIZER.toggle).click({ timeout: remaining() });
      await page.waitForFunction(
        selector => !document.querySelector(selector),
        ORGANIZER.grid,
        { timeout: remaining(), polling: 50 },
      );
      await page.waitForSelector('[data-testid="job-review-filmstrip"]', {
        timeout: remaining(),
      });
    });
  } catch (error) {
    result.partial = true;
    problems.push(shortMessage(error));
  } finally {
    await network.flush();
    result.network = network.summary();
    await browser.close().catch(() => {});
  }
  if (problems.length > 0) result.error = problems.join(" / ");
  return result;
}

function writeResult(result, baseName) {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const jsonPath = resolve(RESULTS_DIR, `${baseName}.json`);
  const mdPath = resolve(RESULTS_DIR, `${baseName}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(mdPath, `${toMarkdown(result)}\n`);
  return { jsonPath, mdPath };
}

async function commandRun(args) {
  const { values } = parseArgs({
    args,
    options: {
      label: { type: "string" },
      base: { type: "string" },
      locale: { type: "string" },
      index: { type: "string" },
      doc: { type: "string" },
      scroll: { type: "string" },
      jump: { type: "string" },
      "values-doc": { type: "string" },
      "organizer-screens": { type: "string" },
      runs: { type: "string" },
      headed: { type: "boolean", default: false },
      gc: { type: "boolean", default: false },
      timeout: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(HELP);
    return;
  }
  if (!values.label || !/^[\w.-]+$/.test(values.label)) {
    fail("--label <name> 이 필요합니다 (영문·숫자·._- 만).");
  }
  const config = {
    ...loadIndex(values.index ?? DEFAULT_INDEX),
    label: values.label,
    base: values.base ?? DEFAULTS.base,
    locale: values.locale ?? DEFAULTS.locale,
    doc: integerOption("doc", values.doc, DEFAULTS.doc, 1),
    scroll: integerOption("scroll", values.scroll, DEFAULTS.scroll, 0),
    jump: integerOption("jump", values.jump, DEFAULTS.jump, 1),
    valuesDoc: integerOption(
      "values-doc",
      values["values-doc"],
      DEFAULTS.valuesDoc,
      1,
    ),
    organizerScreens: integerOption(
      "organizer-screens",
      values["organizer-screens"],
      DEFAULTS.organizerScreens,
      0,
    ),
    runs: integerOption("runs", values.runs, DEFAULTS.runs, 1),
    timeout: integerOption("timeout", values.timeout, DEFAULTS.timeout, 1000),
    headed: values.headed,
    gc: values.gc,
  };

  const runStamp = stamp();
  const results = [];
  const files = [];
  for (let run = 1; run <= config.runs; run += 1) {
    console.error(
      `[measure] ${config.label} run ${run}/${config.runs} → ${config.base} (${config.index?.totalPages ?? "?"} pages${config.gc ? ", gc" : ""})`,
    );
    const result = await runOnce(config, run);
    results.push(result);
    const baseName =
      config.runs === 1
        ? `${config.label}-${runStamp}`
        : `${config.label}-${runStamp}-run${run}`;
    const written = writeResult(result, baseName);
    files.push(relative(NEXT_DIR, written.jsonPath));
    console.error(
      `[measure] saved ${relative(NEXT_DIR, written.jsonPath)}${result.partial ? " (partial)" : ""}`,
    );
    if (config.runs === 1) console.log(toMarkdown(result));
  }
  if (config.runs > 1) {
    const summary = medianResults(results);
    summary.runFiles = files;
    const written = writeResult(summary, `${config.label}-${runStamp}-median`);
    console.error(`[measure] saved ${relative(NEXT_DIR, written.jsonPath)}`);
    console.log(toMarkdown(summary));
  }
  if (results.some(result => result.partial)) {
    console.error(
      "[measure] 일부 단계가 끝나지 않았습니다 (partial). 결과 md 의 partial 줄을 확인하세요.",
    );
    process.exitCode = 2;
  }
}

function commandCompare(args) {
  const [aPath, bPath] = args;
  if (!aPath || !bPath) fail("compare <a.json> <b.json> 두 파일이 필요합니다.");
  const read = path =>
    JSON.parse(readFileSync(resolve(NEXT_DIR, path), "utf8"));
  console.log(compareMarkdown(compareResults(read(aPath), read(bPath))));
}

// pnpm 10 은 `pnpm mock:measure -- --label x` 의 `--` 를 그대로 넘기므로 맨 앞 `--` 는 버린다.
const [command, ...rest] = process.argv
  .slice(2)
  .filter((arg, index) => !(arg === "--" && index <= 1));
if (command === "run") {
  await commandRun(rest);
} else if (command === "compare") {
  commandCompare(rest);
} else if (command === "-h" || command === "--help" || command === undefined) {
  console.log(HELP);
} else {
  fail(`알 수 없는 명령: ${command}\n\n${HELP}`);
}
