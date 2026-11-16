// `mock/smoke.mjs` 의 시나리오. 시나리오는 `{name, description, skip?(index), allowConsole?, run(ctx)}`
// 이고 `run` 은 `ctx.report(check, ok, detail)` 로 확인 결과를 남긴다. 화면은 testid·data 속성으로만
// 찾고(문구는 locale 마다 다르다 — 예외는 트레이 변경 종류 문구 2 곳으로, en/ko/ja 를 모두 받는 정규식,
// 그리고 변경 이력의 트레이 출처 줄로, 실행 locale 의 `src/messages/<locale>.json` 에서 읽는다),
// 문서·쪽 번호·Job id 는 mock 생성기의 `index.json` 에서 읽는다.
import { readFileSync } from "node:fs";

/** 이 쪽 수를 넘는 Job 은 필름스트립 이웃 보기·문서 목록 가상화 같은 큰 Job 경로를 쓴다. */
const LARGE_JOB_ABOVE = 20;
/** 이 쪽 수 이상인 문서는 페이지 탭 대신 위치 바를 쓴다. */
const POSITION_BAR_FROM = 13;
/** 문서 목록이 창에 보이는 행만 그리기 시작하는 문서 수(초과). */
const DOCUMENT_LIST_VIRTUALIZE_ABOVE = 100;
/** 문서 목록 라벨 검색 디바운스(ms). */
const FILTER_DEBOUNCE_MS = 300;
/** 주소창 `?doc=&page=` 갱신 지연(ms). */
const URL_SYNC_MS = 300;
/** 임시 저장 디바운스(ms). */
const DRAFT_DEBOUNCE_MS = 500;
/** 값 패널 배열 묶음 크기. */
const ARRAY_BATCH = 50;

const VIEWER_KEYSHORTCUTS =
  "PageUp PageDown Home End Alt+ArrowUp Alt+ArrowDown";

const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));

export const byTestId = id => `[data-testid="${id}"]`;

/** `fn()` 이 참(또는 값)이 될 때까지 `interval` 간격으로 다시 본다. 상한을 넘으면 마지막 값. */
export async function eventually(fn, timeoutMs = 3000, interval = 50) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value || Date.now() >= deadline) return value;
    await sleep(interval);
  }
}

/**
 * 브라우저 컨텍스트가 새 문서를 열 때마다 검수 화면 저장소를 채운다: 구성 탭 필름스트립 펼침,
 * 보기 전용 Parse·Instruct 단계, 설정 메뉴의 부가 기능 전부 켬. 이미 값이 있으면(시나리오가 바꿨으면) 그대로 둔다.
 */
export async function seedReviewStorage(context) {
  await context.addInitScript(() => {
    try {
      if (window.localStorage.getItem("review-filmstrip") === null) {
        window.localStorage.setItem("review-filmstrip", "open");
      }
      if (window.localStorage.getItem("review-steps") === null) {
        window.localStorage.setItem(
          "review-steps",
          JSON.stringify({ parse: true, instruct: true }),
        );
      }
      if (window.localStorage.getItem("review-features") === null) {
        window.localStorage.setItem(
          "review-features",
          JSON.stringify({
            pageTools: true,
            filmstrip: true,
            organizer: true,
            jsonMenu: true,
            history: true,
          }),
        );
      }
    } catch {
      // 저장소가 막혀 있으면 기본(접힘) 그대로.
    }
  });
}

function stepIdOf(index, type) {
  return (
    Object.entries(index.steps ?? {}).find(
      ([, step]) => step?.type === type,
    )?.[0] ?? null
  );
}

export function longDocument(index) {
  const at = index.longDocumentIndex;
  return at === null || at === undefined
    ? null
    : { ...index.documents[at], index: at };
}

/** mock 생성기의 Extract 결과 id(`occ_ext_{문서 순번}`). */
const extractResultId = documentIndex => `occ_ext_${documentIndex + 1}`;

function jobUrl(config, params = {}) {
  const { collection, job } = config.index.ids;
  const query = new URLSearchParams(params).toString();
  return `${config.base}/${config.locale}/collections/${collection}/jobs/${job}${query ? `?${query}` : ""}`;
}

/** Job 화면을 열고 문서 목록·뷰어가 생길 때까지 기다린 뒤, `stepType` 이 있으면 그 탭을 연다. */
export async function openJob(ctx, params = {}, stepType = null) {
  const { page, config } = ctx;
  await page.goto(jobUrl(config, params), { waitUntil: "domcontentloaded" });
  await page.waitForSelector(byTestId("job-review-document-list"));
  await page.waitForSelector(byTestId("job-review-viewer"));
  if (stepType) await openTab(ctx, stepType);
}

function collectionUrl(config) {
  return `${config.base}/${config.locale}/collections/${config.index.ids.collection}`;
}

const jobPath = (config, jobId) =>
  `/${config.locale}/collections/${config.index.ids.collection}/jobs/${jobId}`;

/** 주소창이 가리키는 Job id(Job 화면이 아니면 null). */
function urlJobId(page) {
  const match = /\/jobs\/([^/?#]+)/.exec(new URL(page.url()).pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

const reviewBadge = page => page.getByTestId("job-review-badge-review-status");

/** Job 화면 검수 배지의 `data-status`(그려지기 전이면 null). */
async function reviewBadgeStatus(page) {
  const badge = reviewBadge(page);
  return (await badge.count()) === 0 ? null : badge.getAttribute("data-status");
}

/** 배지가 서버 응답을 받을 때까지(`unknown` 이 아닐 때까지) 기다려 그 값을 돌려준다. */
async function settledReviewStatus(page, timeoutMs = 5000) {
  const status = await eventually(async () => {
    const value = await reviewBadgeStatus(page);
    return value && value !== "unknown" ? value : null;
  }, timeoutMs);
  return status ?? (await reviewBadgeStatus(page));
}

/** `jobId` 의 Job 화면을 바로 열고(큐 밖) 검수 배지가 정해질 때까지 기다린다. */
async function openJobById(ctx, jobId) {
  const { page, config } = ctx;
  await page.goto(`${config.base}${jobPath(config, jobId)}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForSelector(byTestId("job-review-document-list"));
  await page.waitForSelector(byTestId("job-review-viewer"));
  return settledReviewStatus(page);
}

/** Collection 상세를 열고 Job 표가 `rows` 행이 될 때까지 기다린다. */
/**
 * "표시 옵션" 메뉴의 "최신 설정 결과만 보기" 는 기본으로 켜져 있다. `--jobs` 의 짝수 번째 Job 은 이전
 * Config 라서, 모든 Job 을 보려는 시나리오는 메뉴를 열어 이걸로 끄고 메뉴를 닫는다.
 */
async function showAllConfigs(page) {
  const menu = page.getByTestId("collection-detail-button-view-options");
  await menu.waitFor();
  const toggle = page.getByTestId("collection-detail-switch-latest-only");
  if ((await toggle.count()) === 0) await menu.click();
  await toggle.waitFor();
  if ((await toggle.getAttribute("aria-checked")) === "true") {
    await toggle.click();
  }
  await eventually(
    async () => (await toggle.getAttribute("aria-checked")) === "false",
  );
  // 항목 위의 툴팁이 떠 있으면 첫 Esc 는 툴팁만 닫으므로 메뉴가 닫힐 때까지 누른다.
  for (let i = 0; i < 3 && (await toggle.count()) > 0; i++) {
    await page.keyboard.press("Escape");
    await eventually(async () => (await toggle.count()) === 0, 1000);
  }
}

async function openCollection(ctx, rows) {
  const { page, config } = ctx;
  await page.goto(collectionUrl(config), { waitUntil: "domcontentloaded" });
  await page.waitForSelector(byTestId("job-rows-table"));
  await showAllConfigs(page);
  await eventually(
    async () =>
      (await page.getByTestId("job-rows-table-row-open").count()) === rows,
    5000,
  );
}

/** 표 배지의 `data-status` 목록(행 순서). */
const tableReviewStatuses = page =>
  page
    .getByTestId("job-rows-table-badge-review-status")
    .evaluateAll(badges =>
      badges.map(badge => badge.getAttribute("data-status")),
    );

async function openTab({ page, config }, stepType) {
  const stepId = stepIdOf(config.index, stepType);
  if (!stepId) throw new Error(`index.json 에 ${stepType} step 이 없습니다`);
  await page.getByTestId(`job-review-step-tab-${stepId}`).click();
}

/** 주소창의 `doc`·`page`. */
function urlSelection(page) {
  const params = new URL(page.url()).searchParams;
  return { doc: params.get("doc"), page: params.get("page") };
}

const viewerPage = page =>
  page.getByTestId("job-review-viewer-toolbar-page-input").inputValue();

/** `config.locale` 과 다른 locale 하나(설정 메뉴 언어 전환 확인용). */
const otherLocale = config => (config.locale === "ja" ? "ko" : "ja");

/**
 * 헤더 설정 메뉴에서 `locale` 을 고르고 주소가 그 locale 로 바뀔 때까지 기다린다. 바뀐 뒤의 주소
 * (`URL`)를 돌려준다(시간 안에 안 바뀌면 지금 주소).
 */
async function switchLocaleFromMenu(page, locale) {
  await page.getByTestId("app-header-button-settings").click();
  await page.getByTestId(`settings-menu-radio-locale-${locale}`).click();
  await eventually(
    () => new URL(page.url()).pathname.startsWith(`/${locale}/`),
    8000,
  );
  return new URL(page.url());
}

async function waitViewerPage(page, expected, timeoutMs = 3000) {
  return eventually(
    async () => (await viewerPage(page)) === String(expected),
    timeoutMs,
  );
}

/** 문서 목록에서 `aria-current` 인 행의 순번(0부터). 가상화된 목록이면 그려진 행 기준이 아니라 `data` 로 못 읽으므로 테스트는 작은 순번만 쓴다. */
function selectedRow(page) {
  return page.evaluate(selector => {
    const rows = [...document.querySelectorAll(selector)];
    return rows.findIndex(row => row.getAttribute("aria-current") === "true");
  }, byTestId("job-review-document-list-button-select"));
}

async function selectDocumentRow(page, nth) {
  await page
    .getByTestId("job-review-document-list-button-select")
    .nth(nth)
    .click();
  return eventually(async () => (await selectedRow(page)) === nth);
}

/** 뷰어 열에 포커스를 두고 키를 누른다(뷰어 단축키는 이 열이 듣는다). */
async function pressInViewer(page, key) {
  const column = page.getByTestId("job-review-viewer-column");
  const focused = await column.evaluate(
    element =>
      element === document.activeElement ||
      element.contains(document.activeElement),
  );
  if (!focused) await column.focus();
  await page.keyboard.press(key);
}

/** 앱 User Timing 마크 이름(`src/components/job-review/perf-marks.ts` 와 같아야 한다). */
const MARK_SELECT_PAGE = "review:select-page";

const clearSelectPageMarks = page =>
  page.evaluate(name => performance.clearMarks(name), MARK_SELECT_PAGE);

/** 지금까지 남은 `select-page` 마크를 `쪽(1-based)/source` 문자열로. */
const selectPageMarks = page =>
  page.evaluate(
    name =>
      performance
        .getEntriesByName(name, "mark")
        .map(entry => `${entry.detail?.page}/${entry.detail?.source}`),
    MARK_SELECT_PAGE,
  );

const dispatchPageHide = page =>
  page.evaluate(() => window.dispatchEvent(new Event("pagehide")));

/**
 * 필름스트립·페이지 격자 DnD 를 합성한다. Playwright `dragTo` 는 HTML5 DnD 를 일으키지 못하므로 같은
 * `DataTransfer` 로 dragstart → dragenter/dragover(두 번, 사이에 React 상태 반영) → drop 을 보낸다.
 * 포인터 좌표는 그 요소의 가운데로 둔다(0,0 이면 가장자리 자동 스크롤이 창 밖으로 간다).
 * `whileOver` 가 있으면 drop 직전(끌어 올린 채) 불러 그때의 화면을 읽게 한다.
 */
async function syntheticDrag(page, source, target, whileOver = null) {
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  const centerOf = async element => {
    const box = await element.boundingBox();
    return box
      ? { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 }
      : {};
  };
  await source.dispatchEvent("dragstart", {
    dataTransfer,
    ...(await centerOf(source)),
  });
  await sleep(100);
  const over = { dataTransfer, ...(await centerOf(target)) };
  await target.dispatchEvent("dragenter", over);
  await target.dispatchEvent("dragover", over);
  await sleep(100);
  await target.dispatchEvent("dragover", over);
  if (whileOver) await whileOver();
  await target.dispatchEvent("drop", over);
  if ((await source.count()) > 0) {
    await source.dispatchEvent("dragend", { dataTransfer }).catch(() => {});
  }
  await dataTransfer.dispose();
  await sleep(100);
}

/** 값 위젯의 한 줄 입력·여러 줄 입력(Core `ValueWidget` 의 `-input-value`·`-textarea-value`). */
const FIELD_INPUT = byTestId("job-review-field-input-value");
const FIELD_TEXTAREA = byTestId("job-review-field-textarea-value");

/** 결과 안 오류 문구: 값 행(Core `FieldRow`)·배열 표 칸·결과 머리. */
const VALUE_ERRORS = [
  "job-review-field-row-error",
  "job-review-tree-table-cell-error",
  "job-review-result-error",
]
  .map(byTestId)
  .join(", ");

/** 필름스트립 띠 안의 끌 수 있는 썸네일. */
const DRAGGABLE_THUMBNAIL = '[data-filmstrip-page][draggable="true"]';

const stripSelector = documentId =>
  `${byTestId("job-review-filmstrip")} [data-document-id="${documentId}"]`;

const stripThumbnails = (page, documentId) =>
  page
    .locator(
      `${stripSelector(documentId)} ${byTestId("job-review-filmstrip-thumbnail-select")}`,
    )
    .count();

// ── viewer ────────────────────────────────────────────────────────────────

/** 문서 라벨 상한(`DOCUMENT_LABEL_MAX_LENGTH`). */
const LABEL_MAX_LENGTH = 200;

/**
 * 검수 JSON 의 Classify Step 라벨 목록을 지워(브라우저가 받는 BFF 응답만) 문서 라벨을 select 대신
 * 자유 입력으로 보이게 한다. mock 데이터는 늘 라벨 목록이 있어 이렇게 해야 입력이 나온다.
 */
async function withoutLabelChoices(page) {
  const strip = value => {
    if (Array.isArray(value)) {
      for (const item of value) strip(item);
    } else if (value && typeof value === "object") {
      if (value.type === "document-classify" && Array.isArray(value.labels))
        delete value.labels;
      for (const item of Object.values(value)) strip(item);
    }
  };
  await page.route(
    url => url.pathname.endsWith("/review-document"),
    async route => {
      const response = await route.fetch();
      if (!response.ok()) return route.fulfill({ response });
      const body = await response.json();
      strip(body);
      await route.fulfill({ response, json: body });
    },
  );
}

/**
 * 자유 입력 라벨: 앞뒤 공백을 붙여 Enter 로 확정하면 같은 입력에 포커스가 남고(다시 만들어지지 않음)
 * 변경이 하나 늘며 공백 없는 값이 남는다. 상한을 넘겨 붙여 넣으면 상한에서 잘린다.
 */
async function checkLabelInput({ page, report }, input, changeCount) {
  await input.waitFor();
  const handle = await input.elementHandle();
  const changesBefore = await changeCount();
  const value = "smoke-label";
  await input.click();
  await input.fill(`  ${value}  `);
  await input.press("Enter");
  const kept = await eventually(async () =>
    handle.evaluate(
      element =>
        element.isConnected &&
        document.activeElement === element &&
        element instanceof HTMLInputElement &&
        element.value === "smoke-label",
    ),
  );
  report(
    "label-enter-keeps-focus",
    kept &&
      (await eventually(
        async () => (await changeCount()) === changesBefore + 1,
      )),
    `포커스 ${await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null)}, 값 "${await input.inputValue()}", 변경 ${changesBefore} → ${await changeCount()}`,
  );
  await input.fill("");
  await page.keyboard.insertText("x".repeat(LABEL_MAX_LENGTH + 1));
  const length = (await input.inputValue()).length;
  report(
    "label-max-length",
    (await input.getAttribute("maxlength")) === String(LABEL_MAX_LENGTH) &&
      length === LABEL_MAX_LENGTH,
    `붙여 넣은 뒤 ${length} 자`,
  );
  await input.press("Escape");
  report(
    "label-escape-restores",
    await eventually(async () => (await input.inputValue()) === value),
    `값 "${await input.inputValue()}"`,
  );
}

async function viewer(ctx) {
  const { page, config, report } = ctx;
  const documents = config.index.documents;
  const first = documents[0];
  await openJob(ctx);

  report(
    "continuous-default",
    (await page.locator(byTestId("job-review-viewer-scroll")).count()) === 1 &&
      (await page.locator('[data-testid^="continuous-page-"]').count()) > 0,
    "연속 스크롤 뷰어(job-review-viewer-scroll)가 없음",
  );

  // 처음 열 때 주소창에 선택이 적힐 때까지 기다린 뒤 키보드 이동을 본다.
  await eventually(() => urlSelection(page).page === "1");
  if (first.pages < 3) {
    report(
      "keyboard",
      false,
      `첫 문서가 ${first.pages} 쪽이라 PageDown/End 를 볼 수 없음`,
    );
  } else {
    await pressInViewer(page, "PageDown");
    const urlRightAfter = urlSelection(page).page;
    report(
      "pagedown",
      await waitViewerPage(page, 2),
      `page input ${await viewerPage(page)}`,
    );
    report(
      "url-after-300ms",
      urlRightAfter === "1" &&
        (await eventually(
          () => urlSelection(page).page === "2",
          URL_SYNC_MS + 700,
        )),
      `바로 뒤 page=${urlRightAfter}, 지금 ${urlSelection(page).page}`,
    );
    await pressInViewer(page, "End");
    report(
      "end",
      await waitViewerPage(page, first.pages),
      `page input ${await viewerPage(page)}`,
    );
    await pressInViewer(page, "Home");
    report(
      "home",
      await waitViewerPage(page, 1),
      `page input ${await viewerPage(page)}`,
    );
    await eventually(() => urlSelection(page).page === "1", URL_SYNC_MS + 700);

    // PageDown 직후(대기 없이) PageUp — 연속 뷰어가 앞 이동의 scroll 이벤트를 처리하기 전에 되돌아가도
    // 마지막 입력(1 쪽)을 따르고 뷰어가 2 쪽을 다시 고르지 않아야 한다.
    const fastFailures = [];
    for (let round = 1; round <= 5; round += 1) {
      await clearSelectPageMarks(page);
      await pressInViewer(page, "PageDown");
      await page.keyboard.press("PageUp");
      const landed = await waitViewerPage(page, 1);
      await sleep(100);
      const marks = await selectPageMarks(page);
      if (
        !landed ||
        (await viewerPage(page)) !== "1" ||
        marks.some(mark => mark.endsWith("/viewer"))
      ) {
        fastFailures.push(
          `${round}회: page ${await viewerPage(page)}, marks ${marks.join(" → ")}`,
        );
      }
    }
    report(
      "pagedown-pageup-fast",
      fastFailures.length === 0,
      fastFailures.join("; "),
    );

    // 키 반복(PageDown 을 누른 채) — 한 쪽씩 키보드로만 넘어가고 뷰어 에코가 끼지 않아야 한다.
    const repeats = Math.min(5, first.pages - 1);
    await clearSelectPageMarks(page);
    await pressInViewer(page, "Home");
    await waitViewerPage(page, 1);
    await clearSelectPageMarks(page);
    for (let round = 0; round < repeats; round += 1) {
      await page.keyboard.down("PageDown");
    }
    await page.keyboard.up("PageDown");
    const repeatLanded = await waitViewerPage(page, 1 + repeats);
    await sleep(100);
    const repeatMarks = await selectPageMarks(page);
    const expectedRepeat = Array.from(
      { length: repeats },
      (_, at) => `${at + 2}/keyboard`,
    );
    report(
      "pagedown-repeat",
      repeatLanded &&
        repeatMarks.join(" ") === expectedRepeat.join(" ") &&
        (await viewerPage(page)) === String(1 + repeats),
      `page ${await viewerPage(page)}, marks ${repeatMarks.join(" → ")}`,
    );
    await pressInViewer(page, "Home");
    await waitViewerPage(page, 1);
    await eventually(() => urlSelection(page).page === "1", URL_SYNC_MS + 700);

    await pressInViewer(page, "PageDown");
    await waitViewerPage(page, 2);
    const urlBeforeHide = urlSelection(page).page;
    await dispatchPageHide(page);
    report(
      "pagehide-flushes-url",
      urlBeforeHide === "1" && urlSelection(page).page === "2",
      `pagehide 전 page=${urlBeforeHide}, 직후 page=${urlSelection(page).page}`,
    );
  }

  if (documents.length > 1) {
    await pressInViewer(page, "Alt+ArrowDown");
    report(
      "alt-arrow-down",
      await eventually(async () => (await selectedRow(page)) === 1),
      `선택 행 ${await selectedRow(page)}`,
    );
  }

  const column = await page
    .getByTestId("job-review-viewer-column")
    .evaluate(element => {
      const describedBy = element.getAttribute("aria-describedby");
      return {
        title: element.getAttribute("title"),
        keyshortcuts: element.getAttribute("aria-keyshortcuts"),
        description: describedBy
          ? (document.getElementById(describedBy)?.textContent ?? "").trim()
          : "",
      };
    });
  report(
    "aria-keyshortcuts",
    column.keyshortcuts === VIEWER_KEYSHORTCUTS &&
      column.title === null &&
      column.description !== "",
    JSON.stringify(column),
  );

  // 보기 방식 토글은 뷰어 아래 툴바 안, 쪽 번호 묶음(다음 페이지 버튼) 오른쪽에 겹치지 않게 있고 처음에는
  // 이어서 스크롤이 눌려 있다. 한 장씩으로 바꾸면 연속 스크롤 요소가 사라지고, 되돌리면 돌아온다.
  const modeContinuous = page.getByTestId(
    "job-review-viewer-button-mode-continuous",
  );
  const modePaged = page.getByTestId("job-review-viewer-button-mode-paged");
  const toolbarBox = await page
    .getByTestId("job-review-viewer-toolbar")
    .boundingBox();
  const nextPageBox = await page
    .getByTestId("job-review-viewer-toolbar-next-page")
    .boundingBox();
  const modeBox = await modeContinuous.boundingBox();
  const inBar =
    toolbarBox !== null &&
    nextPageBox !== null &&
    modeBox !== null &&
    modeBox.y >= toolbarBox.y &&
    modeBox.y + modeBox.height <= toolbarBox.y + toolbarBox.height &&
    modeBox.x >= nextPageBox.x + nextPageBox.width &&
    modeBox.x + modeBox.width <= toolbarBox.x + toolbarBox.width;
  const pressedFirst = await modeContinuous.getAttribute("aria-pressed");
  await modePaged.click();
  const pagedShown = await eventually(
    async () =>
      (await page.locator(byTestId("job-review-viewer-scroll")).count()) ===
        0 && (await modePaged.getAttribute("aria-pressed")) === "true",
  );
  await modeContinuous.click();
  const continuousBack = await eventually(
    async () =>
      (await page.locator(byTestId("job-review-viewer-scroll")).count()) === 1,
  );
  report(
    "mode-toggle-next-to-page",
    inBar && pressedFirst === "true" && pagedShown && continuousBack,
    `툴바 안 ${inBar}, 처음 눌림 ${pressedFirst}, 한 장씩 ${pagedShown}, 되돌림 ${continuousBack}`,
  );

  // 설정 메뉴의 언어 전환은 주소의 ?doc&page 를 그대로 두고 같은 문서·쪽으로 다시 연다.
  const target =
    documents.slice(1).find(doc => doc.pages >= 2) ??
    documents.find(doc => doc.pages >= 2) ??
    first;
  const targetPage = target.pages >= 2 ? "2" : "1";
  await openJob(ctx, { doc: target.document_id, page: targetPage });
  await waitViewerPage(page, Number(targetPage));
  const locale = otherLocale(config);
  const switched = await switchLocaleFromMenu(page, locale);
  await page.waitForSelector(byTestId("job-review-viewer"));
  const keptSelection = await eventually(() => {
    const selection = urlSelection(page);
    return (
      selection.doc === target.document_id && selection.page === targetPage
    );
  });
  report(
    "locale-switch-keeps-selection",
    switched.pathname.startsWith(`/${locale}/`) &&
      keptSelection &&
      (await waitViewerPage(page, Number(targetPage))),
    `주소 ${page.url()}, 뷰어 ${await viewerPage(page)} 쪽`,
  );
}

// ── position-bar ──────────────────────────────────────────────────────────

async function positionBar(ctx) {
  const { page, config, report } = ctx;
  const documents = config.index.documents;
  const long = longDocument(config.index);
  const target =
    long && long.pages >= POSITION_BAR_FROM
      ? long
      : documents.find(doc => doc.pages >= POSITION_BAR_FROM);
  await openJob(
    ctx,
    { doc: target.document_id, page: "1" },
    "information-extract",
  );
  await page.waitForSelector(byTestId("job-review-position-bar"));
  // 값 탭의 긴 문서(13 쪽 이상)에는 뷰어 위에 위치 바가 하나 보인다(짧은 문서는 띠가 없다).
  report(
    "shown-for-long-doc",
    (await page.locator(byTestId("job-review-position-bar")).count()) === 1,
  );
  const previous = page.getByTestId("job-review-position-bar-button-previous");
  const next = page.getByTestId("job-review-position-bar-button-next");
  const input = page.getByTestId("job-review-position-bar-input-page");
  const state = () =>
    previous.evaluate(element => ({
      ariaDisabled: element.getAttribute("aria-disabled"),
      disabled: element.hasAttribute("disabled"),
    }));
  const focusedTestId = () =>
    page.evaluate(
      () => document.activeElement?.getAttribute("data-testid") ?? null,
    );

  const atStart = await state();
  report(
    "previous-aria-disabled",
    atStart.ariaDisabled === "true" && !atStart.disabled,
    JSON.stringify(atStart),
  );
  await previous.click({ force: true });
  await previous.focus();
  await page.keyboard.press("Enter");
  await sleep(150);
  report(
    "previous-no-op-keeps-focus",
    (await input.inputValue()) === "1" &&
      (await focusedTestId()) === "job-review-position-bar-button-previous",
    `page ${await input.inputValue()}, focus ${await focusedTestId()}`,
  );

  // ▶ 직후(대기 없이) ◀ — 연속 뷰어가 앞 이동의 scroll 이벤트를 처리하기 전에 되돌아가도 마지막
  // 입력(1 쪽)이 남고 뷰어가 2 쪽을 다시 고르지 않아야 한다. 5 회 반복한다.
  const fastFailures = [];
  let firstRound = null;
  for (let round = 1; round <= 5; round += 1) {
    await clearSelectPageMarks(page);
    await next.click();
    await eventually(async () => (await input.inputValue()) === "2");
    await previous.focus();
    await page.keyboard.press("Enter");
    const landed = await eventually(
      async () => (await input.inputValue()) === "1",
    );
    if (round === 1) {
      firstRound = {
        landed,
        focus: await focusedTestId(),
        ariaDisabled: (await state()).ariaDisabled,
      };
    }
    await sleep(100);
    const marks = await selectPageMarks(page);
    const toolbar = await viewerPage(page);
    const ok =
      landed &&
      (await input.inputValue()) === "1" &&
      toolbar === "1" &&
      !marks.some(mark => mark.endsWith("/viewer")) &&
      marks.at(-1) === "1/bar";
    if (!ok) {
      fastFailures.push(
        `${round}회: bar ${await input.inputValue()}, toolbar ${toolbar}, marks ${marks.join(" → ")}`,
      );
    }
  }
  report(
    "back-to-first-keeps-focus",
    firstRound.landed &&
      firstRound.focus === "job-review-position-bar-button-previous" &&
      firstRound.ariaDisabled === "true",
    JSON.stringify(firstRound),
  );
  const urlSettled = await eventually(
    () => urlSelection(page).page === "1",
    URL_SYNC_MS + 700,
  );
  report(
    "fast-back-follows-last-input",
    fastFailures.length === 0 && urlSettled,
    `${fastFailures.join("; ")} url page=${urlSelection(page).page}`,
  );

  await input.fill(String(target.pages));
  await input.press("Enter");
  report(
    "next-aria-disabled-at-end",
    await eventually(
      async () => (await next.getAttribute("aria-disabled")) === "true",
    ),
    `page ${await input.inputValue()}`,
  );
}

// ── document-list ─────────────────────────────────────────────────────────

async function documentList(ctx) {
  const { page, config, report } = ctx;
  const documents = config.index.documents;
  await openJob(ctx);
  const rows = page.getByTestId("job-review-document-list-button-select");
  const viewport = page.getByTestId("job-review-document-list-viewport");
  const total = documents.length;
  const rendered = await rows.count();
  if (total > DOCUMENT_LIST_VIRTUALIZE_ABOVE) {
    report(
      "windowed",
      (await viewport.count()) === 1 && rendered > 0 && rendered < total,
      `${rendered}/${total} 행`,
    );
  } else {
    report(
      "all-rows",
      (await viewport.count()) === 0 && rendered === total,
      `${rendered}/${total} 행`,
    );
  }

  // 선택 문서(첫 문서)의 라벨과 다른 라벨로 거르면 선택이 가려진다.
  const label = documents.find(
    doc => doc.label && doc.label !== documents[0].label,
  )?.label;
  if (!label) {
    report("filter", false, "첫 문서와 다른 라벨의 문서가 없음");
    return;
  }
  const expected = documents.filter(doc => doc.label === label).length;
  const summary = page.getByTestId("job-review-document-summary");
  const summaryBefore = (await summary.textContent()) ?? "";
  const typedAt = Date.now();
  await page.getByTestId("job-review-document-filter-input-search").fill(label);
  // 입력 직후에는 목록이 그대로다(라벨 검색은 입력이 멎고 300 ms 뒤에 적용).
  const rowsRightAfter = await rows.count();
  const summaryRightAfter = (await summary.textContent()) ?? "";
  // 검색은 디바운스 뒤 적용된다 — 요약 줄이 바뀐 뒤 행 수를 본다.
  report(
    "summary-updates",
    await eventually(
      async () => ((await summary.textContent()) ?? "") !== summaryBefore,
    ),
  );
  const appliedAfter = Date.now() - typedAt;
  report(
    "filter-debounced",
    rowsRightAfter === rendered &&
      summaryRightAfter === summaryBefore &&
      appliedAfter >= FILTER_DEBOUNCE_MS - 50,
    `직후 ${rowsRightAfter}/${rendered} 행 · 적용 ${appliedAfter} ms`,
  );
  const filtered = await rows.count();
  report(
    "filter",
    expected > DOCUMENT_LIST_VIRTUALIZE_ABOVE
      ? filtered > 0 && filtered < expected
      : filtered === expected,
    `${filtered} 행, 기대 ${expected}`,
  );

  const hidden = page.getByTestId("job-review-document-filter-hidden");
  report(
    "selection-hidden-notice",
    await eventually(async () => (await hidden.count()) === 1),
  );
  const clear = page.getByTestId("job-review-document-filter-button-clear");
  if ((await clear.count()) === 0) {
    report("clear-filter", false, "필터 지우기 버튼이 없음");
    return;
  }
  await clear.click();
  // 지우기는 검색 디바운스를 기다리지 않는다.
  await sleep(100);
  report(
    "clear-filter",
    (await rows.count()) === rendered &&
      (await page
        .getByTestId("job-review-document-filter-input-search")
        .inputValue()) === "" &&
      (await hidden.count()) === 0 &&
      (await selectedRow(page)) === 0,
    `${await rows.count()} 행, 선택 ${await selectedRow(page)}`,
  );

  // 선택한 문서의 결과 메뉴를 Esc 로 닫으면 포커스가 그 메뉴 버튼으로 돌아온다.
  await openTab(ctx, "information-extract");
  const menuButton = page.getByTestId("job-review-result-button-menu").first();
  await menuButton.waitFor();
  await menuButton.click();
  const menus = page.locator('[role="menu"]');
  await eventually(async () => (await menus.count()) > 0, 2000);
  await page.keyboard.press("Escape");
  report(
    "menu-escape-returns-focus",
    Boolean(
      await eventually(
        async () =>
          (await menus.count()) === 0 &&
          (await menuButton.evaluate(
            button => button === document.activeElement,
          )),
        2000,
      ),
    ),
    `메뉴 ${await menus.count()}`,
  );
}

// ── filmstrip ─────────────────────────────────────────────────────────────

async function filmstrip(ctx) {
  const { page, config, report, skip } = ctx;
  const documents = config.index.documents;
  const long = longDocument(config.index);
  await openJob(ctx, { doc: long.document_id, page: "1" }, "document-classify");
  await page.waitForSelector(byTestId("job-review-filmstrip"));
  const strips = page.locator(
    `${byTestId("job-review-filmstrip")} [data-document-id]`,
  );
  report(
    "neighborhood-three-strips",
    (await eventually(async () => (await strips.count()) === 3)) &&
      (await page
        .locator(byTestId("job-review-filmstrip-scroller"))
        .count()) === 1,
    `띠 ${await strips.count()}`,
  );

  // 접힌 이웃 띠의 썸네일 메뉴는 "옮기기…"·"제외" 둘, 펼친 띠는 넷.
  const menuItems = page.locator(
    '[role="menuitem"][data-testid^="job-review-filmstrip-page-menu-"]',
  );
  const menuCount = async documentId => {
    await page
      .locator(
        `${stripSelector(documentId)} ${byTestId("job-review-filmstrip-thumbnail-menu-open")}`,
      )
      .first()
      .click();
    await eventually(async () => (await menuItems.count()) > 0, 2000);
    const count = await menuItems.count();
    await page.keyboard.press("Escape");
    await eventually(async () => (await menuItems.count()) === 0, 2000);
    return count;
  };
  const previousDoc = documents[long.index - 1];
  if (previousDoc) {
    const collapsed = await menuCount(previousDoc.document_id);
    report(
      "collapsed-strip-menu-two-items",
      collapsed === 2,
      `${collapsed} 개`,
    );
  }
  const expanded = await menuCount(long.document_id);
  report("expanded-strip-menu-four-items", expanded === 4, `${expanded} 개`);

  // 접힌 이웃 띠(앞 문서, 끝 몇 쪽만 보임)의 자기 페이지를 같은 띠에 놓으면 아무것도 바뀌지 않는다
  // (포인터와 무관하게 끝으로 옮겨지면 안 된다). 보이는 첫 칸을 끌어 그 띠의 썸네일 줄에 놓는다.
  if (!previousDoc || previousDoc.pages < 2) {
    skip("collapsed-self-drop-ignored", "앞 문서가 없거나 1 쪽 문서");
  } else {
    const changeCount = async () => {
      const badge = page.getByTestId("job-review-change-count");
      if ((await badge.count()) === 0) return 0;
      return Number.parseInt((await badge.textContent()) ?? "0", 10) || 0;
    };
    const previousStrip = stripSelector(previousDoc.document_id);
    const keysOfPrevious = () =>
      page
        .locator(`${previousStrip} [data-filmstrip-page]`)
        .evaluateAll(elements =>
          elements.map(element => element.getAttribute("data-filmstrip-page")),
        );
    const changesBefore = await changeCount();
    const keysBefore = await keysOfPrevious();
    await syntheticDrag(
      page,
      page.locator(`${previousStrip} ${DRAGGABLE_THUMBNAIL}`).first(),
      page.locator(
        `${previousStrip} ${byTestId("job-review-filmstrip-strip-pages")}`,
      ),
    );
    await sleep(200);
    const keysAfter = await keysOfPrevious();
    report(
      "collapsed-self-drop-ignored",
      (await changeCount()) === changesBefore &&
        keysAfter.join(",") === keysBefore.join(","),
      `변경 ${changesBefore} → ${await changeCount()}, 칸 ${keysBefore.join(",")} → ${keysAfter.join(",")}`,
    );
  }

  // "위치 지정…" 은 같은 파일 그룹 블록(단일 그룹 mock 은 1–문서 수) 안의 번호만 받는다.
  await page
    .locator(
      `${stripSelector(long.document_id)} ${byTestId("job-review-filmstrip-strip-menu-open")}`,
    )
    .click();
  await page.getByTestId("job-review-filmstrip-strip-menu-position").click();
  const dialog = page.getByTestId("job-review-document-position-dialog");
  await dialog.waitFor();
  const dialogText = (await dialog.textContent()) ?? "";
  const groupSize =
    new Set(documents.map(doc => doc.group ?? "single")).size === 1
      ? documents.length
      : null;
  report(
    "position-dialog-range",
    groupSize === null || dialogText.includes(`1–${groupSize}`),
    `설명 "${dialogText.slice(0, 120)}"`,
  );
  await page
    .getByTestId("job-review-document-position-dialog-input")
    .fill(String(documents.length + 9));
  await page
    .getByTestId("job-review-document-position-dialog-button-move")
    .click();
  report(
    "position-dialog-rejects-out-of-range",
    (await dialog.isVisible()) &&
      (await dialog.locator('[role="alert"]').count()) > 0,
  );
  await page
    .getByTestId("job-review-document-position-dialog-button-cancel")
    .click();
  await dialog.waitFor({ state: "hidden" });

  // 합성 DnD 3 종: 페이지 → 제외 띠, 페이지 → 이웃 띠, 띠 → 띠(합치기). 3 쪽 이상 문서를 고른다.
  const at = documents.findIndex(
    (doc, i) => i > 0 && i + 1 < documents.length && doc.pages >= 3,
  );
  if (at < 0) {
    report("dnd", false, "앞뒤 문서가 있는 3 쪽 이상 문서가 없음");
  } else {
    const subject = documents[at];
    const after = documents[at + 1];
    await selectDocumentRow(page, at);
    await eventually(
      async () =>
        (await stripThumbnails(page, subject.document_id)) === subject.pages,
    );
    const pageHandle = () =>
      page
        .locator(`${stripSelector(subject.document_id)} ${DRAGGABLE_THUMBNAIL}`)
        .first();

    await syntheticDrag(
      page,
      pageHandle(),
      page.getByTestId("job-review-filmstrip-excluded"),
    );
    report(
      "dnd-page-to-excluded",
      await eventually(
        async () =>
          (await stripThumbnails(page, subject.document_id)) ===
          subject.pages - 1,
      ),
      `썸네일 ${await stripThumbnails(page, subject.document_id)}`,
    );
    await syntheticDrag(
      page,
      pageHandle(),
      page.locator(stripSelector(after.document_id)),
    );
    report(
      "dnd-page-to-neighbor",
      await eventually(
        async () =>
          (await stripThumbnails(page, subject.document_id)) ===
          subject.pages - 2,
      ),
      `썸네일 ${await stripThumbnails(page, subject.document_id)}`,
    );
    await syntheticDrag(
      page,
      page.locator(
        `${stripSelector(after.document_id)} ${byTestId("job-review-filmstrip-strip-handle")}[draggable="true"]`,
      ),
      page.locator(stripSelector(subject.document_id)),
    );
    report(
      "dnd-merge-strips",
      (await eventually(
        async () =>
          (await page.locator(stripSelector(after.document_id)).count()) === 0,
      )) &&
        (await stripThumbnails(page, subject.document_id)) > subject.pages - 2,
      `합친 뒤 썸네일 ${await stripThumbnails(page, subject.document_id)}`,
    );
  }

  // 빠진 페이지가 새로 생기면 빠진 띠가 펼쳐진다.
  await selectDocumentRow(page, long.index);
  const range = page
    .getByTestId("job-review-structure-ranges-input-range")
    .first();
  await range.fill(`${long.first}-${long.last - 1}`);
  await range.press("Tab");
  report(
    "unplaced-lane-opens",
    await eventually(
      async () =>
        (await page
          .locator(byTestId("job-review-filmstrip-unplaced-collapse"))
          .count()) === 1,
    ),
  );

  // 필름스트립 접기: 접으면 띠가 사라지고 페이지 전체 세로 스크롤이 없으며, 다시 펼치면 띠가 돌아온다.
  const toggle = page.getByTestId("job-review-viewer-button-filmstrip");
  const pageOverflow = () =>
    page.evaluate(
      () =>
        document.documentElement.scrollHeight -
        document.documentElement.clientHeight,
    );
  await toggle.click();
  const closed = await eventually(
    async () =>
      (await page.locator(byTestId("job-review-filmstrip")).count()) === 0 &&
      (await toggle.getAttribute("aria-expanded")) === "false" &&
      (await pageOverflow()) <= 0,
  );
  report(
    "collapse-fits-viewport",
    closed,
    `페이지 넘침 ${await pageOverflow()} px`,
  );
  const toggleClosedBox = await toggle.boundingBox();
  await toggle.click();
  report(
    "expand-restores-strip",
    await eventually(
      async () =>
        (await page.locator(byTestId("job-review-filmstrip")).count()) === 1 &&
        (await toggle.getAttribute("aria-expanded")) === "true",
    ),
  );

  // 펼쳐도 토글은 제자리(뷰어 칼럼 맨 위 툴바)에 있고, 띠는 뷰어 칼럼 폭 안에 들어가며, 화면은 창 높이
  // 맞춤을 유지해 페이지 전체 세로 스크롤이 생기지 않는다.
  const toggleOpenBox = await toggle.boundingBox();
  const stripInColumn = await page.evaluate(() => {
    const column = document
      .querySelector('[data-testid="job-review-viewer-column"]')
      ?.getBoundingClientRect();
    const strip = document
      .querySelector('[data-testid="job-review-filmstrip"]')
      ?.getBoundingClientRect();
    return Boolean(
      column &&
      strip &&
      strip.left >= column.left - 0.5 &&
      strip.right <= column.right + 0.5,
    );
  });
  const toggleStill =
    toggleClosedBox !== null &&
    toggleOpenBox !== null &&
    Math.abs(toggleClosedBox.x - toggleOpenBox.x) < 1 &&
    Math.abs(toggleClosedBox.y - toggleOpenBox.y) < 1;
  report(
    "expand-keeps-layout",
    toggleStill &&
      stripInColumn &&
      (await pageOverflow()) <= 0 &&
      (await page.locator('[data-viewport-fit="true"]').count()) === 1,
    `토글 제자리 ${toggleStill}, 띠 칼럼 안 ${stripInColumn}, 페이지 넘침 ${await pageOverflow()} px`,
  );

  // 라벨 목록이 없는 설정이면 띠 머리 라벨은 자유 입력이다.
  await withoutLabelChoices(page);
  await openJob(ctx, { doc: long.document_id, page: "1" }, "document-classify");
  await checkLabelInput(
    ctx,
    page
      .locator(stripSelector(long.document_id))
      .getByTestId("job-review-filmstrip-label-input"),
    async () => {
      const badge = page.getByTestId("job-review-change-count");
      if ((await badge.count()) === 0) return 0;
      return Number.parseInt((await badge.textContent()) ?? "0", 10) || 0;
    },
  );
}

// ── structure-toolbar ─────────────────────────────────────────────────────

async function structureToolbar(ctx) {
  const { page, config, report, skip } = ctx;
  const documents = config.index.documents;
  await openJob(ctx, {}, "document-classify");
  await page.waitForSelector(byTestId("job-review-structure-toolbar"));
  const button = name =>
    page.getByTestId(`job-review-structure-toolbar-button-${name}`);
  const focusedTestId = () =>
    page.evaluate(
      () => document.activeElement?.getAttribute("data-testid") ?? null,
    );

  // 경계 버튼은 늘 그려지고 끝에서는 aria-disabled(누르면 아무 일 없음).
  report(
    "previous-aria-disabled-at-first",
    (await button("previous").getAttribute("aria-disabled")) === "true",
  );
  await button("previous").click({ force: true });
  await sleep(100);
  report(
    "previous-no-op",
    (await selectedRow(page)) === 0,
    `선택 행 ${await selectedRow(page)}`,
  );
  if (documents.length > 1) {
    await button("next").click();
    await eventually(async () => (await selectedRow(page)) === 1);
    await button("previous").focus();
    await page.keyboard.press("Enter");
    report(
      "focus-stays-on-boundary",
      (await eventually(async () => (await selectedRow(page)) === 0)) &&
        (await focusedTestId()) ===
          "job-review-structure-toolbar-button-previous" &&
        (await button("previous").getAttribute("aria-disabled")) === "true",
      `focus ${await focusedTestId()}`,
    );
    if (documents.length <= DOCUMENT_LIST_VIRTUALIZE_ABOVE) {
      await selectDocumentRow(page, documents.length - 1);
      report(
        "next-aria-disabled-at-last",
        await eventually(
          async () =>
            (await button("next").getAttribute("aria-disabled")) === "true",
        ),
      );
    }
  }

  // 아래 편집은 문서 순서를 바꾸므로 하나씩 새로 연 화면에서 한다(앞 편집의 임시 저장 배너는 무시).
  const reopen = async params => {
    await openJob(ctx, params, "document-classify");
    await page.waitForSelector(byTestId("job-review-structure-toolbar"));
  };

  // 페이지 범위 행: 틀린 새 행을 남긴 채 첫 행을 지우면(확정되지 않음) 당겨진 행의 Esc 는 그 행의 처음
  // 값(빈 칸)으로 돌아간다 — 지운 첫 행의 범위로 바뀌지 않는다.
  {
    await reopen({ doc: documents[0].document_id, page: "1" });
    const ranges = page.getByTestId("job-review-structure-ranges-input-range");
    await ranges.first().waitFor();
    const firstText = await ranges.first().inputValue();
    await page.getByTestId("job-review-structure-ranges-button-add").click();
    await eventually(async () => (await ranges.count()) === 2);
    await ranges.nth(1).fill("x");
    await page
      .getByTestId("job-review-structure-ranges-button-remove")
      .first()
      .click();
    await eventually(async () => (await ranges.count()) === 1);
    await ranges.first().press("Escape");
    const after = await ranges.first().inputValue();
    report(
      "range-row-escape-after-remove",
      (await ranges.count()) === 1 && after === "" && firstText !== "",
      `첫 행 "${firstText}", 지운 뒤 Esc "${after}"`,
    );
  }

  // 1 쪽 문서를 "앞 문서로" 옮기면 문서가 사라지므로 앞 문서·붙은 페이지가 선택된다.
  const single = documents.findIndex((doc, i) => i > 0 && doc.pages === 1);
  if (single < 0) {
    skip("to-previous-selects-target", "1 쪽 문서가 없음");
  } else {
    const target = documents[single - 1];
    await reopen({ doc: documents[single].document_id, page: "1" });
    await button("to-previous").click();
    report(
      "to-previous-selects-target",
      await eventually(async () => {
        const selection = urlSelection(page);
        return (
          selection.doc === target.document_id &&
          selection.page === String(target.pages + 1)
        );
      }, URL_SYNC_MS + 1500),
      JSON.stringify(urlSelection(page)),
    );
  }

  // "페이지 옮기기…" 로 둘째 문서 전부를 첫 문서 끝으로 → 첫 문서의 붙은 첫 페이지가 선택된다.
  const [into, from] = documents;
  if (!from) {
    skip("move-pages-dialog", "문서가 하나뿐");
  } else {
    await reopen({ doc: from.document_id, page: "1" });
    await button("move-pages").click();
    const dialog = page.getByTestId("job-review-move-pages-dialog");
    await dialog.waitFor();
    await page.getByTestId("job-review-move-pages-dialog-input-from").fill("1");
    await page
      .getByTestId("job-review-move-pages-dialog-input-to")
      .fill(String(from.pages));
    await page
      .getByTestId("job-review-move-pages-dialog-select-target")
      .click();
    await page
      .getByTestId(`job-review-move-pages-dialog-option-${into.document_id}`)
      .click();
    await page.getByTestId("job-review-move-pages-dialog-radio-before").check();
    const beforeLabel = await page
      .getByTestId("job-review-move-pages-dialog-input-before")
      .evaluate(
        input =>
          document.querySelector(`label[for="${input.id}"]`)?.textContent ?? "",
      );
    report(
      "before-page-label-range",
      beforeLabel.includes(`(1–${into.pages + 1})`),
      `라벨 "${beforeLabel}"`,
    );
    await page.getByTestId("job-review-move-pages-dialog-radio-end").check();
    await page.getByTestId("job-review-move-pages-dialog-button-move").click();
    await dialog.waitFor({ state: "hidden" });
    report(
      "move-pages-selects-target",
      await eventually(async () => {
        const selection = urlSelection(page);
        return (
          selection.doc === into.document_id &&
          selection.page === String(into.pages + 1)
        );
      }, URL_SYNC_MS + 1500),
      JSON.stringify(urlSelection(page)),
    );
  }

  // "페이지 옮기기…" 로 2 쪽만 라벨을 정한 새 문서로 분리 → 보던 2 쪽이 새 문서 1 쪽으로 따라가고 변경 +1.
  // 대상 select 끝에는 문서 수와 무관하게 "새 문서" 가 있다.
  const splittable = documents.find(doc => doc.pages >= 2);
  if (!splittable) {
    skip("move-pages-new-document", "2 쪽 이상 문서가 없음");
  } else {
    const changeCount = async () => {
      const badge = page.getByTestId("job-review-change-count");
      if ((await badge.count()) === 0) return 0;
      return Number.parseInt((await badge.textContent()) ?? "0", 10) || 0;
    };
    const knownIds = new Set(documents.map(doc => doc.document_id));
    await reopen({ doc: splittable.document_id, page: "2" });
    await waitViewerPage(page, 2);
    const changesBefore = await changeCount();
    await button("move-pages").click();
    const dialog = page.getByTestId("job-review-move-pages-dialog");
    await dialog.waitFor();
    await page.getByTestId("job-review-move-pages-dialog-input-from").fill("2");
    await page.getByTestId("job-review-move-pages-dialog-input-to").fill("2");
    await page
      .getByTestId("job-review-move-pages-dialog-select-target")
      .click();
    await page
      .getByTestId("job-review-move-pages-dialog-option-new-document")
      .click();
    const labelSelect = page.getByTestId(
      "job-review-move-pages-dialog-label-select",
    );
    const labelInput = page.getByTestId(
      "job-review-move-pages-dialog-label-input",
    );
    const noPosition =
      (await page
        .getByTestId("job-review-move-pages-dialog-radio-end")
        .count()) === 0;
    let labelField = "none";
    if ((await labelSelect.count()) === 1) {
      labelField = "select";
      await labelSelect.click();
      await page.getByRole("option").nth(1).click();
    } else if ((await labelInput.count()) === 1) {
      labelField = "input";
      await labelInput.fill("smoke");
    }
    await page.getByTestId("job-review-move-pages-dialog-button-move").click();
    await dialog.waitFor({ state: "hidden" }).catch(() => {});
    const newDocumentSelected = await eventually(() => {
      const selection = urlSelection(page);
      return (
        selection.doc !== undefined &&
        selection.doc !== null &&
        !knownIds.has(selection.doc) &&
        selection.page === "1"
      );
    }, URL_SYNC_MS + 1500);
    const changed = await eventually(
      async () => (await changeCount()) === changesBefore + 1,
    );
    report(
      "move-pages-new-document",
      labelField !== "none" && noPosition && newDocumentSelected && changed,
      `라벨 필드 ${labelField}, 위치 없음 ${noPosition}, url ${JSON.stringify(urlSelection(page))}, 변경 ${changesBefore} → ${await changeCount()}`,
    );
  }

  // 나누기: 보던 쪽부터 새 문서가 되고 그 문서가 선택된다.
  if (!splittable) {
    skip("split-selects-new-document", "2 쪽 이상 문서가 없음");
    return;
  }
  await reopen({ doc: splittable.document_id, page: "2" });
  await waitViewerPage(page, 2);
  const current = splittable.document_id;
  await button("split").click();
  report(
    "split-selects-new-document",
    await eventually(async () => {
      const selection = urlSelection(page);
      return (
        selection.doc !== null &&
        selection.doc !== current &&
        selection.page === "1"
      );
    }, URL_SYNC_MS + 1500),
    JSON.stringify(urlSelection(page)),
  );
}

// ── structure-label ───────────────────────────────────────────────────────

/**
 * 구조 패널의 문서 라벨 칸: 라벨 select 로 고르면 변경이 하나 늘고(원래 라벨로 되돌려 둔다), 새 문서로
 * 분리 대화 상자에는 라벨 칸이 하나 있고 고른 뒤 취소하면 아무것도 바뀌지 않는다. 라벨 목록이 없는
 * 설정이면 자유 입력 칸이 되고, Enter 로 확정하면 다듬은 값이 남고 변경이 하나 늘며 칸이 다시
 * 만들어져 포커스가 칸에 남지 않는다. 상한(200 자)에서 잘리고 Esc 는 확정한 값으로 되돌린다.
 */
async function structureLabel(ctx) {
  const { page, report, skip } = ctx;
  const focusedTestId = () =>
    page.evaluate(
      () => document.activeElement?.getAttribute("data-testid") ?? null,
    );
  await openJob(ctx, {}, "document-classify");
  const select = page.getByTestId("job-review-structure-label-select");
  await select.waitFor();
  const options = page.locator(
    '[role="option"][data-testid^="job-review-structure-option-"]',
  );
  const original = ((await select.textContent()) ?? "").trim();
  const changesBefore = await changeCountOf(page);
  await select.click();
  await eventually(async () => (await options.count()) > 0, 2000);
  const target = options.and(page.locator(':not([aria-selected="true"])'));
  const picked = ((await target.first().textContent()) ?? "").trim();
  await target.first().click();
  const changed =
    (await eventually(
      async () => (await changeCountOf(page)) === changesBefore + 1,
    )) &&
    (await eventually(
      async () => ((await select.textContent()) ?? "").trim() === picked,
    ));
  report(
    "panel-select-changes-label",
    changed,
    `"${original}" → "${((await select.textContent()) ?? "").trim()}", 변경 ${changesBefore} → ${await changeCountOf(page)}`,
  );
  await select.click();
  await eventually(async () => (await options.count()) > 0, 2000);
  const back = options.filter({ hasText: original });
  if ((await back.count()) === 0) {
    // 라벨이 없던 문서는 라벨을 고른 뒤 "(라벨 없음)" 항목이 사라져 되돌릴 수 없다.
    await page.keyboard.press("Escape");
    skip("panel-select-restores-label", `되돌릴 항목 없음("${original}")`);
  } else {
    await back.first().click();
    report(
      "panel-select-restores-label",
      await eventually(
        async () => ((await select.textContent()) ?? "").trim() === original,
      ),
      `"${((await select.textContent()) ?? "").trim()}"`,
    );
  }

  // 새 문서로 분리 대화 상자: 라벨 칸 하나, 라벨을 고르고 취소하면 변경 수 그대로.
  const changesBeforeDialog = await changeCountOf(page);
  await page.getByTestId("job-review-structure-button-new-document").click();
  const dialog = page.getByTestId("job-review-new-document-dialog");
  await dialog.waitFor();
  const dialogSelect = page.getByTestId("job-review-new-document-label-select");
  const selects = await dialogSelect.count();
  const inputs = await page
    .getByTestId("job-review-new-document-label-input")
    .count();
  let chosen = null;
  if (selects === 1) {
    await dialogSelect.click();
    const dialogOptions = page.locator(
      '[role="option"][data-testid^="job-review-new-document-option-label-"]',
    );
    await eventually(async () => (await dialogOptions.count()) > 0, 2000);
    chosen = ((await dialogOptions.first().textContent()) ?? "").trim();
    await dialogOptions.first().click();
    await eventually(
      async () => ((await dialogSelect.textContent()) ?? "").trim() === chosen,
    );
  }
  const shown = ((await dialogSelect.textContent()) ?? "").trim();
  await page.getByTestId("job-review-new-document-button-cancel").click();
  const closed = await eventually(async () => (await dialog.count()) === 0);
  report(
    "new-document-label-select-cancel",
    selects === 1 &&
      inputs === 0 &&
      chosen !== null &&
      shown === chosen &&
      closed &&
      (await changeCountOf(page)) === changesBeforeDialog,
    `select ${selects}, input ${inputs}, 고른 값 "${chosen}" 표시 "${shown}", 닫힘 ${closed}, 변경 ${changesBeforeDialog} → ${await changeCountOf(page)}`,
  );

  // 라벨 목록이 없는 설정: 자유 입력 칸.
  await withoutLabelChoices(page);
  await openJob(ctx, {}, "document-classify");
  const input = page.getByTestId("job-review-structure-label-input");
  await input.waitFor();
  const handle = await input.elementHandle();
  const inputChangesBefore = await changeCountOf(page);
  const value = "smoke-label";
  await input.click();
  await input.fill(`  ${value}  `);
  await input.press("Enter");
  const committed =
    (await eventually(
      async () => (await changeCountOf(page)) === inputChangesBefore + 1,
    )) && (await eventually(async () => (await input.inputValue()) === value));
  const remounted = await handle.evaluate(element => !element.isConnected);
  const focused = await focusedTestId();
  report(
    "panel-input-enter-commits-and-remounts",
    committed && remounted && focused !== "job-review-structure-label-input",
    `값 "${await input.inputValue()}", 변경 ${inputChangesBefore} → ${await changeCountOf(page)}, 이전 칸 분리 ${remounted}, 포커스 ${focused}`,
  );
  await input.click();
  await input.fill("");
  await page.keyboard.insertText("x".repeat(LABEL_MAX_LENGTH + 1));
  const length = (await input.inputValue()).length;
  report(
    "panel-input-max-length",
    (await input.getAttribute("maxlength")) === String(LABEL_MAX_LENGTH) &&
      length === LABEL_MAX_LENGTH,
    `붙여 넣은 뒤 ${length} 자`,
  );
  await input.press("Escape");
  report(
    "panel-input-escape-restores",
    (await eventually(async () => (await input.inputValue()) === value)) &&
      (await changeCountOf(page)) === inputChangesBefore + 1,
    `값 "${await input.inputValue()}", 변경 ${await changeCountOf(page)}`,
  );
}

// ── values ────────────────────────────────────────────────────────────────

async function values(ctx) {
  const { page, config, report } = ctx;
  const long = longDocument(config.index);
  const resultId = extractResultId(long.index);
  const result = page.locator(`[data-result-id="${resultId}"]`);
  const positionInput = page.getByTestId("job-review-position-bar-input-page");
  const goToPage = async n => {
    await positionInput.fill(String(n));
    await positionInput.press("Enter");
    await eventually(
      async () => (await positionInput.inputValue()) === String(n),
    );
  };
  const itemPointers = () =>
    page.evaluate(
      prefix =>
        [...document.querySelectorAll("[data-node-id], [data-field-id]")]
          .map(
            element =>
              element.getAttribute("data-node-id") ??
              element.getAttribute("data-field-id"),
          )
          .filter(id => id.startsWith(prefix))
          .map(id => Number(id.slice(prefix.length).split("/")[0]))
          .filter(Number.isInteger),
      `${resultId}#/items/`,
    );
  /** 지금 그려진 이 결과의 하이라이트 pointer 중 `beyond` 번째 이상 항목(`items`) 또는 items 밖(`outside`) 하나. */
  const highlightOnPage = mode =>
    page.evaluate(
      ({ prefix, mode, batch }) =>
        [...document.querySelectorAll("path[data-highlight-id]")]
          .map(element => element.getAttribute("data-highlight-id"))
          .filter(id => id.startsWith(prefix))
          .map(id => id.slice(prefix.length))
          .find(pointer => {
            const match = /^\/items\/(\d+)\//.exec(pointer);
            return mode === "beyond"
              ? match !== null && Number(match[1]) >= batch
              : match === null;
          }) ?? null,
      { prefix: `${resultId}#`, mode, batch: ARRAY_BATCH },
    );
  const clickHighlight = pointer =>
    page
      .locator(`path[data-highlight-id="${resultId}#${pointer}"]`)
      .first()
      .dispatchEvent("click");

  await openJob(
    ctx,
    { doc: long.document_id, page: "1" },
    "information-extract",
  );
  await result.waitFor();
  await page.waitForSelector(byTestId("job-review-position-bar"));

  // 50 번째 뒤 항목의 하이라이트를 고르면 그 항목까지 보이고, 다른 값을 골라도 한도가 남는다.
  let chosen = null;
  for (let n = 2; n <= long.pages && !chosen; n += 1) {
    await goToPage(n);
    await sleep(150);
    chosen = await eventually(() => highlightOnPage("beyond"), 500);
  }
  if (!chosen) {
    report("select-beyond-batch", false, "50 번째 뒤 항목의 하이라이트가 없음");
    return;
  }
  const item = Number(/^\/items\/(\d+)\//.exec(chosen)[1]);
  await clickHighlight(chosen);
  report(
    "select-beyond-batch",
    await eventually(async () => (await itemPointers()).includes(item)),
    `${chosen} 를 골랐지만 항목 ${item} 이 없음`,
  );

  let other = null;
  for (let n = 1; n <= long.pages && !other; n += 1) {
    await goToPage(n);
    await sleep(150);
    other = await eventually(() => highlightOnPage("outside"), 500);
  }
  if (other) {
    await clickHighlight(other);
    await sleep(200);
    report(
      "limit-kept-after-reselect",
      (await itemPointers()).includes(item),
      `${other} 를 고른 뒤 항목 ${item} 이 사라짐`,
    );
  } else {
    report("limit-kept-after-reselect", false, "items 밖 하이라이트가 없음");
  }

  const showMore = result
    .getByTestId("job-review-tree-button-show-more")
    .first();
  if ((await showMore.count()) === 0) {
    report("show-more", false, "더 보기 버튼이 없음");
  } else {
    const shownBefore = Math.max(...(await itemPointers()));
    await showMore.click();
    report(
      "show-more",
      await eventually(
        async () =>
          Math.max(...(await itemPointers())) >=
          Math.min(shownBefore + 1, item + ARRAY_BATCH),
      ),
      `더 보기 뒤 최대 항목 ${Math.max(...(await itemPointers()))}`,
    );
  }

  // "현재 페이지 값만" 이 켜진 채 항목을 추가해도 새 항목이 보이고 포커스를 받는다.
  const pageFilter = page.getByTestId("job-review-values-filter-current-page");
  const setFilter = async (locator, on) => {
    const checked = (await locator.getAttribute("aria-pressed")) === "true";
    if (checked !== on) await locator.click();
    await eventually(
      async () =>
        ((await locator.getAttribute("aria-pressed")) === "true") === on,
    );
  };
  const itemsNode = page.locator(`[data-node-id="${resultId}#/items"]`);
  let added = false;
  for (let n = 1; n <= long.pages && !added; n += 1) {
    await goToPage(n);
    await setFilter(pageFilter, true);
    if ((await itemsNode.count()) === 0) continue;
    const countText =
      (await itemsNode
        .getByTestId("job-review-field-group-toggle")
        .first()
        .textContent()) ?? "";
    const length = Number(countText.match(/\d+/g)?.at(-1));
    await itemsNode
      .getByTestId("job-review-tree-button-add-item")
      .first()
      .click();
    const focused = await eventually(
      () =>
        page.evaluate(
          () =>
            document.activeElement
              ?.closest("[data-field-id]")
              ?.getAttribute("data-field-id") ?? null,
        ),
      1500,
    );
    report(
      "add-item-visible-while-filtered",
      focused !== null &&
        focused.startsWith(`${resultId}#/items/${length}/`) &&
        (await pageFilter.getAttribute("aria-pressed")) === "true",
      `포커스 ${focused}, 기대 /items/${length}/…`,
    );
    added = true;
  }
  if (!added)
    report(
      "add-item-visible-while-filtered",
      false,
      "items 묶음이 보이는 쪽이 없음",
    );
  await setFilter(pageFilter, false);

  // 숫자 입력 오류는 그 행의 오류 문구와 aria-invalid·aria-describedby 로 입력에 연결된다.
  const numberInput = page
    .locator(
      '[data-testid="job-review-field-input-value"][inputmode="decimal"]',
    )
    .first();
  if ((await numberInput.count()) === 0) {
    report("number-error-aria", false, "숫자 입력이 없음");
  } else {
    await numberInput.scrollIntoViewIfNeeded();
    const originalNumber = await numberInput.inputValue();
    await numberInput.fill("12abc");
    await numberInput.press("Enter");
    const numberRow = page
      .getByTestId("job-review-field-row")
      .filter({ has: numberInput });
    const alert = numberRow.getByTestId("job-review-field-row-error");
    const linked = await eventually(async () => {
      if (!(await alert.isVisible())) return false;
      const alertId = await alert.getAttribute("id");
      // 도움말이 있는 행은 도움말 id 도 함께 이어지므로 오류 id 가 들어 있는지만 본다.
      const describedBy =
        (await numberInput.getAttribute("aria-describedby")) ?? "";
      return (
        alertId !== null &&
        (await numberInput.getAttribute("aria-invalid")) === "true" &&
        describedBy.split(" ").includes(alertId)
      );
    });
    report(
      "number-error-aria",
      linked,
      `aria-invalid ${await numberInput.getAttribute("aria-invalid")}, aria-describedby ${await numberInput.getAttribute("aria-describedby")}, alert id ${(await alert.count()) > 0 ? await alert.getAttribute("id") : null}`,
    );
    // 원래 값으로 되돌려 오류를 지운다(변경 없음).
    await numberInput.fill(originalNumber);
    await numberInput.press("Enter");
    await eventually(async () => (await alert.count()) === 0);
  }

  // 배열 항목 칸의 입력 오류는 그 값에 묶인다: 오류를 낸 항목을 지우면 그 자리를 이어받은 다음
  // 항목에 오류 문구·aria-invalid 가 넘어가지 않는다(행은 index 를 key 로 다시 쓴다).
  const invalidCount = () =>
    result.locator(`[aria-invalid="true"], ${VALUE_ERRORS}`).count();
  const itemFieldId = await page.evaluate(
    prefix =>
      [
        ...document.querySelectorAll(
          '[data-testid="job-review-field-input-value"][inputmode="decimal"]',
        ),
      ]
        .map(
          input =>
            input.closest("[data-field-id]")?.getAttribute("data-field-id") ??
            null,
        )
        .find(
          id =>
            id !== null &&
            id.startsWith(prefix) &&
            /^\d+\/[^/]+$/.test(id.slice(prefix.length)),
        ) ?? null,
    `${resultId}#/items/`,
  );
  if (!itemFieldId) {
    report("array-error-not-inherited", false, "배열 항목의 숫자 칸이 없음");
  } else {
    const itemIndex = Number(
      itemFieldId.slice(`${resultId}#/items/`.length).split("/")[0],
    );
    const before = await invalidCount();
    const cellInput = page
      .locator(`[data-field-id="${itemFieldId}"]`)
      .getByTestId("job-review-field-input-value");
    await cellInput.scrollIntoViewIfNeeded();
    await cellInput.fill("12abc");
    await cellInput.press("Enter");
    const shown = await eventually(async () => (await invalidCount()) > before);
    const itemNode = page.locator(
      `[data-node-id="${resultId}#/items/${itemIndex}"]`,
    );
    // 표 행이면 행 끝 메뉴가 마지막이다(앞은 칸 메뉴).
    await itemNode.getByTestId("job-review-tree-button-menu").last().click();
    const remove = page.getByTestId("job-review-tree-menu-remove-item");
    const removable =
      (await remove.count()) > 0 && !(await remove.isDisabled());
    if (removable) await remove.click();
    else await page.keyboard.press("Escape");
    const cleared =
      removable &&
      (await eventually(async () => (await invalidCount()) === before));
    report(
      "array-error-not-inherited",
      shown && cleared,
      `오류 표시 ${shown}, 삭제 가능 ${removable}, 삭제 뒤 오류·aria-invalid ${await invalidCount()}개(처음 ${before}개)`,
    );
  }

  await selectDocumentRow(page, 0);
  const firstResultId = extractResultId(0);
  const firstResult = page.locator(`[data-result-id="${firstResultId}"]`);
  await firstResult.waitFor();
  const editor = page.getByTestId("job-review-json-dialog-editor-textarea");

  await valueTableCells(ctx, firstResultId, firstResult, editor);

  // 마지막 배열 항목을 메뉴로 지우면 포커스가 이전 항목으로 간다(메뉴 버튼이 함께 사라지므로).
  await firstResult.getByTestId("job-review-result-button-menu").click();
  await page.getByTestId("job-review-result-menu-edit-json").click();
  await editor.waitFor();
  const twoItems = JSON.parse(await editor.inputValue());
  if (!Array.isArray(twoItems.items) || twoItems.items.length < 2) {
    await page.keyboard.press("Escape");
    report("remove-last-item-focus", false, "items 가 2 개 미만");
  } else {
    twoItems.items = twoItems.items.slice(0, 2);
    await editor.fill(JSON.stringify(twoItems, null, 2));
    await page.getByTestId("job-review-json-dialog-button-apply").click();
    await page
      .getByTestId("job-review-json-dialog")
      .waitFor({ state: "hidden" });
    const lastItem = page.locator(`[data-node-id="${firstResultId}#/items/1"]`);
    await lastItem.waitFor();
    await lastItem.getByTestId("job-review-tree-button-menu").last().click();
    await page.getByTestId("job-review-tree-menu-remove-item").click();
    const focusedPrevious = await eventually(
      () =>
        page.evaluate(
          id =>
            Boolean(document.activeElement?.closest(`[data-node-id="${id}"]`)),
          `${firstResultId}#/items/0`,
        ),
      1500,
    );
    report(
      "remove-last-item-focus",
      focusedPrevious && (await lastItem.count()) === 0,
      `포커스 ${await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? document.activeElement?.tagName ?? null)}`,
    );
  }

  // 결과 JSON 편집으로 items 를 비우면 "바뀐 값만" 에서 빈 배열 머리가 보인다.
  await firstResult.getByTestId("job-review-result-button-menu").click();
  await page.getByTestId("job-review-result-menu-edit-json").click();
  await editor.waitFor();
  const content = JSON.parse(await editor.inputValue());
  content.items = [];
  await editor.fill(JSON.stringify(content, null, 2));
  await page.getByTestId("job-review-json-dialog-button-apply").click();
  await page.getByTestId("job-review-json-dialog").waitFor({ state: "hidden" });
  await setFilter(page.getByTestId("job-review-values-filter-changed"), true);
  report(
    "empty-array-shown-in-changed-only",
    await eventually(
      async () =>
        (await page
          .locator(`[data-node-id="${firstResultId}#/items"]`)
          .count()) === 1,
    ),
  );

  await setFilter(page.getByTestId("job-review-values-filter-changed"), false);

  // schema 에 없는 필드를 넣으면 저장 전에도 그 행에 오류가 보이고, 아주 긴 문자열은 입력칸 대신
  // 읽기 전용 요약이 된다.
  await firstResult.getByTestId("job-review-result-button-menu").click();
  await page.getByTestId("job-review-result-menu-edit-json").click();
  await editor.waitFor();
  const next = JSON.parse(await editor.inputValue());
  const longKey = Object.keys(next).find(key => typeof next[key] === "string");
  next.__smoke_unknown = 1;
  if (longKey) next[longKey] = "x".repeat(10_001);
  await editor.fill(JSON.stringify(next, null, 2));
  await page.getByTestId("job-review-json-dialog-button-apply").click();
  await page.getByTestId("job-review-json-dialog").waitFor({ state: "hidden" });
  const unknownRow = page.locator(
    `[data-field-id="${firstResultId}#/__smoke_unknown"]`,
  );
  report(
    "schema-error-on-row",
    await eventually(
      async () =>
        (await unknownRow.getByTestId("job-review-field-row-error").count()) ===
        1,
    ),
    `행 ${await unknownRow.count()}개`,
  );
  if (!longKey) {
    report("long-text-summary", false, "문자열 필드가 없음");
  } else {
    const longRow = page.locator(
      `[data-field-id="${firstResultId}#/${longKey}"]`,
    );
    report(
      "long-text-summary",
      await eventually(
        async () =>
          (await longRow.getByTestId("job-review-field-long-text").count()) ===
            1 &&
          (await longRow
            .locator(`${FIELD_INPUT}, ${FIELD_TEXTAREA}`)
            .count()) === 0 &&
          (await longRow
            .getByTestId("job-review-field-long-text-button-edit-json")
            .count()) === 1,
      ),
      `필드 ${longKey}`,
    );
  }

  await pinClearsOnOutsideClick(ctx, firstResultId);
  await displayToggles(ctx);
  await valueComposition(ctx);
}

/**
 * 배열 표 칸의 키보드·되돌리기·빠진 칸 추가. 칸은 `data-field-id`, 입력은 `data-field-input` 으로 찾는다.
 * Enter 는 값 패널 안 다음 입력(같은 행 다음 칸, 행 끝이면 다음 행 첫 칸)으로, Tab 은 브라우저 기본
 * 순서(칸 사이의 되돌리기·메뉴 버튼을 거친다)로 간다. mock 송장 `items` 의 네 필드는 모두 필수 숫자·
 * 문자열이라 칸 메뉴가 없고, 행 끝 칸에는 행 메뉴 버튼만 있다.
 */
async function valueTableCells(ctx, resultId, result, editor) {
  const { page, report } = ctx;
  const id = pointer => `${resultId}#${pointer}`;
  const cellOf = pointer => page.locator(`[data-field-id="${id(pointer)}"]`);
  const inputOf = pointer => cellOf(pointer).locator("[data-field-input]");
  const focused = () =>
    page.evaluate(() => {
      const element = document.activeElement;
      return {
        cell:
          element?.closest("[data-field-id]")?.getAttribute("data-field-id") ??
          null,
        row:
          element?.closest("tr[data-node-id]")?.getAttribute("data-node-id") ??
          null,
        input: element?.hasAttribute("data-field-input") ?? false,
        testId: element?.getAttribute("data-testid") ?? null,
      };
    });
  const describe = state =>
    `칸 ${state.cell}, 행 ${state.row}, 입력 ${state.input}, testid ${state.testId}`;

  const itemsNode = page.locator(`[data-node-id="${id("/items")}"]`);
  const toggle = itemsNode.getByTestId("job-review-field-group-toggle").first();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
  const first = inputOf("/items/0/description");
  if (
    !(await eventually(async () => (await first.count()) === 1)) ||
    (await result.getByTestId("job-review-tree-table").count()) === 0
  ) {
    report("table-enter-next-cell", false, "items 표가 없음");
    return;
  }
  await first.scrollIntoViewIfNeeded();

  await first.focus();
  await page.keyboard.press("Tab");
  const tabbed = await focused();
  report(
    "table-tab-next-cell",
    tabbed.cell === id("/items/0/qty") && tabbed.input,
    describe(tabbed),
  );

  await inputOf("/items/0/amount").focus();
  await page.keyboard.press("Tab");
  const rowEnd = await focused();
  report(
    "table-tab-row-end-menu",
    rowEnd.cell === null &&
      rowEnd.row === id("/items/0") &&
      rowEnd.testId === "job-review-tree-button-menu",
    describe(rowEnd),
  );

  await first.focus();
  await page.keyboard.press("Enter");
  const entered = await eventually(async () => {
    const state = await focused();
    return state.cell === id("/items/0/qty") && state.input ? state : null;
  }, 1500);
  report(
    "table-enter-next-cell",
    entered !== null,
    describe(entered ?? (await focused())),
  );

  await inputOf("/items/0/amount").focus();
  await page.keyboard.press("Enter");
  const nextRow = await eventually(async () => {
    const state = await focused();
    return state.cell === id("/items/1/description") && state.input
      ? state
      : null;
  }, 1500);
  report(
    "table-enter-next-row",
    nextRow !== null,
    describe(nextRow ?? (await focused())),
  );

  // 칸 값을 바꾸면 되돌리기 버튼이 생기고(Tab 이 입력 다음에 거기로 간다), 누르면 원래 값으로.
  const qty = inputOf("/items/0/qty");
  const original = await qty.inputValue();
  const changesBefore = await changeCountOf(page);
  const revert = cellOf("/items/0/qty").getByTestId(
    "job-review-tree-table-button-revert",
  );
  await qty.fill(String(Number(original) + 1));
  await qty.press("Enter");
  const shown =
    (await eventually(
      async () => (await changeCountOf(page)) === changesBefore + 1,
    )) && (await eventually(async () => (await revert.count()) === 1));
  await qty.focus();
  await page.keyboard.press("Tab");
  const toRevert = await focused();
  report(
    "table-tab-to-revert",
    shown &&
      toRevert.cell === id("/items/0/qty") &&
      toRevert.testId === "job-review-tree-table-button-revert",
    describe(toRevert),
  );
  if (shown) await revert.click();
  const reverted =
    shown &&
    (await eventually(
      async () =>
        (await qty.inputValue()) === original &&
        (await revert.count()) === 0 &&
        (await changeCountOf(page)) === changesBefore,
    ));
  report(
    "table-revert-cell",
    reverted,
    `값 ${original} → ${await qty.inputValue()}, 버튼 ${await revert.count()}, 변경 ${changesBefore} → ${await changeCountOf(page)}`,
  );

  // 한 항목에서 필드를 지우면 그 칸이 "+" 가 되고, 누르면 필드가 다시 생기며 새 칸 입력에 포커스.
  await result.getByTestId("job-review-result-button-menu").click();
  await page.getByTestId("job-review-result-menu-edit-json").click();
  await editor.waitFor();
  const content = JSON.parse(await editor.inputValue());
  delete content.items[0].amount;
  await editor.fill(JSON.stringify(content, null, 2));
  await page.getByTestId("job-review-json-dialog-button-apply").click();
  await page.getByTestId("job-review-json-dialog").waitFor({ state: "hidden" });
  const addCell = page
    .locator(`tr[data-node-id="${id("/items/0")}"]`)
    .getByTestId("job-review-tree-table-button-add-cell");
  const appeared = await eventually(async () => (await addCell.count()) === 1);
  if (appeared) await addCell.click();
  const added = appeared
    ? await eventually(async () => {
        const state = await focused();
        return state.cell === id("/items/0/amount") && state.input
          ? state
          : null;
      }, 1500)
    : null;
  report(
    "table-add-cell-focus",
    added !== null && (await addCell.count()) === 0,
    `＋ 버튼 ${appeared}, ${describe(added ?? (await focused()))}`,
  );
}

/**
 * 한글 조합 중(`compositionstart` ~ `compositionend`) Enter 는 값을 확정하지 않고, 조합이 끝난 뒤의 Enter 가
 * 확정한다(변경 사항 수로 확인). 조합 중 Enter 는 `isComposing` 을 단 keydown 을 직접 보내 흉내 낸다.
 */
async function valueComposition(ctx) {
  const { page, config, report } = ctx;
  await openJob(
    ctx,
    { doc: config.index.documents[0].document_id, page: "1" },
    "information-extract",
  );
  const input = page
    .locator(
      `[data-result-id="${extractResultId(0)}"] ${FIELD_INPUT}:not([inputmode="decimal"])`,
    )
    .first();
  await input.waitFor();
  const before = await changeCountOf(page);
  const typed = `${await input.inputValue()} 한`;
  await input.fill(typed);
  await input.evaluate(element => {
    element.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true, data: "" }),
    );
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        cancelable: true,
        isComposing: true,
      }),
    );
  });
  await sleep(300);
  report(
    "ime-enter-ignored",
    (await changeCountOf(page)) === before &&
      (await input.inputValue()) === typed &&
      (await input.evaluate(element => element === document.activeElement)),
    `변경 ${before}→${await changeCountOf(page)}`,
  );
  await input.evaluate(element =>
    element.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: "한" }),
    ),
  );
  await input.press("Enter");
  report(
    "enter-after-composition-commits",
    Boolean(
      await eventually(async () => (await changeCountOf(page)) === before + 1),
    ),
    `변경 ${before}→${await changeCountOf(page)}`,
  );
}

/**
 * 값 패널 오른쪽 스위치: Extract 는 "설명 보기"(schema 설명), Validate 는 "규칙 보기"(Job 응답의 Config
 * 규칙). 둘 다 기본 꺼짐이고 켜면 보이며, 다시 열어도 브라우저가 기억한다. 원본 판정 근거는 스위치와
 * 무관하게 늘 보인다. 끝나면 끈다.
 */
async function displayToggles(ctx) {
  const { page, report } = ctx;
  const descriptionSwitch = page.getByTestId(
    "job-review-values-switch-description",
  );
  const rulesSwitch = page.getByTestId("job-review-values-switch-rules");
  const descriptions = () =>
    page
      .locator(
        `[data-value-panel] ${byTestId("job-review-field-row-description")}`,
      )
      .filter({ hasText: /^YYYY-MM-DD$/ })
      .count();
  const rules = () =>
    page.getByTestId("job-review-validate-rules").locator("li").count();
  const checks = () => page.getByTestId("job-review-verdict-reason").count();
  const setSwitch = async (locator, on) => {
    if (((await locator.getAttribute("aria-checked")) === "true") !== on)
      await locator.click();
    return eventually(
      async () =>
        ((await locator.getAttribute("aria-checked")) === "true") === on,
    );
  };

  await openTab(ctx, "information-extract");
  await descriptionSwitch.waitFor();
  await setSwitch(descriptionSwitch, false);
  const hiddenByDefault = await eventually(
    async () => (await descriptions()) === 0,
  );
  await setSwitch(descriptionSwitch, true);
  const shown = await eventually(async () => (await descriptions()) >= 1);
  report(
    "description-toggle",
    hiddenByDefault && shown && (await rulesSwitch.count()) === 0,
    `꺼짐 ${hiddenByDefault}, 켬 ${shown}(설명 ${await descriptions()}개), 규칙 스위치 ${await rulesSwitch.count()}개`,
  );

  await openTab(ctx, "validate");
  await rulesSwitch.waitFor();
  await page.getByTestId("job-review-verdict").first().waitFor();
  await setSwitch(rulesSwitch, false);
  const rulesHidden = await eventually(async () => (await rules()) === 0);
  const checksWhenOff = await eventually(async () => (await checks()) >= 1);
  await setSwitch(rulesSwitch, true);
  const rulesShown = await eventually(async () => (await rules()) >= 1);
  const checksWhenOn = (await checks()) >= 1;
  report(
    "rules-toggle",
    rulesHidden &&
      rulesShown &&
      checksWhenOff &&
      checksWhenOn &&
      (await descriptionSwitch.count()) === 0,
    `꺼짐 ${rulesHidden}, 켬 ${rulesShown}(규칙 줄 ${await rules()}개), 원본 판정 근거 꺼짐 ${checksWhenOff}·켬 ${checksWhenOn}, 설명 스위치 ${await descriptionSwitch.count()}개`,
  );

  // 다시 열어도 켠 상태가 남는다.
  await openJob(ctx, {}, "validate");
  await rulesSwitch.waitFor();
  const rulesKept =
    (await rulesSwitch.getAttribute("aria-checked")) === "true" &&
    (await eventually(async () => (await rules()) >= 1));
  await openTab(ctx, "information-extract");
  await descriptionSwitch.waitFor();
  const descriptionKept =
    (await descriptionSwitch.getAttribute("aria-checked")) === "true" &&
    (await eventually(async () => (await descriptions()) >= 1));
  report(
    "display-toggles-remembered",
    rulesKept && descriptionKept,
    `규칙 ${rulesKept}, 설명 ${descriptionKept}`,
  );
  await setSwitch(descriptionSwitch, false);
  await openTab(ctx, "validate");
  await rulesSwitch.waitFor();
  await setSwitch(rulesSwitch, false);
}

/**
 * `selector` 첫 요소 안에서 눌러도 아무 조작도 일어나지 않는 빈 자리(링크·버튼·입력·하이라이트가
 * 아닌 곳)의 화면 좌표. 없으면 null.
 */
function blankPoint(page, selector) {
  return page.evaluate(selector => {
    const box = document.querySelector(selector);
    if (!box) return null;
    const rect = box.getBoundingClientRect();
    const interactive =
      "a, button, input, textarea, select, path, [role=button], [role=slider]";
    for (let fy = 0.1; fy < 1; fy += 0.1) {
      for (let fx = 0.05; fx < 1; fx += 0.05) {
        const x = rect.left + rect.width * fx;
        const y = rect.top + rect.height * fy;
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
        const hit = document.elementFromPoint(x, y);
        if (hit && box.contains(hit) && !hit.closest(interactive))
          return { x, y };
      }
    }
    return null;
  }, selector);
}

/**
 * 고정 하이라이트는 고른 값 행·인용 칩과 뷰어 안을 누르면 남고, 그 밖(머리글)을 누르면 풀린다.
 * Extract 탭이 열린 채로 시작한다.
 */
async function pinClearsOnOutsideClick(ctx, resultId) {
  const { page, report } = ctx;
  const pinnedRows = () =>
    page
      .locator('[data-testid="job-review-field-row"][data-selected="true"]')
      .count();
  const pinnedChips = () =>
    page.locator('[data-citation][data-selected="true"]').count();
  const clickBlank = async selector => {
    const point = await blankPoint(page, selector);
    if (!point) return false;
    await page.mouse.click(point.x, point.y);
    return true;
  };
  const check = async (name, pinned, select) => {
    if (!(await select())) {
      report(name, false, "고를 행·칩이 없음");
      return;
    }
    const selected = await eventually(async () => (await pinned()) === 1);
    const viewerClicked = await clickBlank("[data-highlight-keep]");
    await sleep(150);
    const keptInViewer = (await pinned()) === 1;
    const headerClicked = await clickBlank("header");
    const cleared = await eventually(async () => (await pinned()) === 0);
    report(
      name,
      selected && viewerClicked && keptInViewer && headerClicked && cleared,
      `선택 ${selected}, 뷰어 빈 곳 ${viewerClicked}/${keptInViewer}, 머리글 ${headerClicked}/${cleared}`,
    );
  };

  await check("pin-clears-on-outside-click", pinnedRows, async () => {
    const id = await page.evaluate(
      prefix =>
        [...document.querySelectorAll("path[data-highlight-id]")]
          .map(element => element.getAttribute("data-highlight-id"))
          .find(
            id =>
              id.startsWith(prefix) &&
              document.querySelector(
                `[data-field-id="${CSS.escape(id)}"] [data-field-input]`,
              ) !== null,
          ) ?? null,
      `${resultId}#`,
    );
    if (!id) return false;
    const input = page
      .locator(`[data-field-id="${id}"] [data-field-input]`)
      .first();
    await input.scrollIntoViewIfNeeded();
    await input.click();
    return true;
  });

  await openTab(ctx, "instruct");
  const chips = page.locator(
    '[data-testid="job-review-instruct-citation"]:not([aria-disabled])',
  );
  await check("instruct-pin-clears-on-outside-click", pinnedChips, async () => {
    if (!(await eventually(async () => (await chips.count()) > 0, 3000)))
      return false;
    await chips.first().scrollIntoViewIfNeeded();
    await chips.first().click();
    return true;
  });

  // 고정한 칩에서 다른 칩을 누르면 고정이 그 칩으로 옮겨 간다(바깥 클릭으로 풀리고 끝나지 않는다).
  if ((await chips.count()) < 2) {
    report(
      "instruct-pin-moves-to-other-chip",
      false,
      "누를 수 있는 칩이 2 개 미만",
    );
  } else {
    await chips.nth(0).click();
    await chips.nth(1).click();
    report(
      "instruct-pin-moves-to-other-chip",
      await eventually(
        async () =>
          (await chips.nth(1).getAttribute("data-selected")) === "true" &&
          (await pinnedChips()) === 1,
      ),
      `고정된 칩 ${await pinnedChips()}개`,
    );
  }

  // 칩에 포커스를 두고 Enter 로 고르면 칩이 다시 마운트되지 않아 포커스가 그 칩에 남고, Tab 은
  // 다음 칩으로 간다.
  const chipFocus = await page.evaluate(() => {
    const all = [
      ...document.querySelectorAll(
        '[data-testid="job-review-instruct-citation"]',
      ),
    ];
    const index = all.findIndex(
      (chip, i) =>
        !chip.hasAttribute("aria-disabled") &&
        i + 1 < all.length &&
        chip.closest("section") === all[i + 1].closest("section"),
    );
    if (index < 0) return null;
    all.forEach((chip, i) => chip.setAttribute("data-smoke-chip", String(i)));
    return index;
  });
  if (chipFocus === null) {
    report("instruct-chip-keeps-focus", false, "이웃 칩이 있는 칩이 없음");
  } else {
    const chip = page.locator(`[data-smoke-chip="${chipFocus}"]`);
    await chip.scrollIntoViewIfNeeded();
    await chip.focus();
    await page.keyboard.press("Enter");
    // 칩이 다시 마운트되면 표식 속성이 사라지므로 포커스 요소에 표식이 남아 있는지로 본다.
    const kept = await eventually(() =>
      page.evaluate(index => {
        const active = document.activeElement;
        return (
          active?.getAttribute("data-smoke-chip") === String(index) &&
          active.getAttribute("data-selected") === "true"
        );
      }, chipFocus),
    );
    const viewerSelected = await eventually(
      async () =>
        (await page
          .locator('path[data-highlight-id][data-selected="true"]')
          .count()) > 0,
    );
    await page.keyboard.press("Tab");
    const nextFocused = await page.evaluate(
      () => document.activeElement?.getAttribute("data-smoke-chip") ?? null,
    );
    report(
      "instruct-chip-keeps-focus",
      kept && viewerSelected && nextFocused === String(chipFocus + 1),
      `포커스 유지 ${kept}, 뷰어 선택 ${viewerSelected}, Tab 뒤 칩 ${nextFocused}(기대 ${chipFocus + 1})`,
    );
    // 고정을 풀어 다음 확인에 남기지 않는다.
    const point = await blankPoint(page, "header");
    if (point) await page.mouse.click(point.x, point.y);
  }
}

// ── draft ─────────────────────────────────────────────────────────────────

async function draft(ctx) {
  const { page, config, report } = ctx;
  const { collection, job } = config.index.ids;
  const key = `review-draft:${collection}:${job}`;
  const drafts = () =>
    page.evaluate(storageKey => {
      const raw = window.localStorage.getItem(storageKey);
      return raw === null ? null : (JSON.parse(raw).drafts?.length ?? null);
    }, key);
  const fields = page.locator(
    `[data-result-id="${extractResultId(0)}"] ${FIELD_INPUT}`,
  );
  const edit = async (nth, suffix) => {
    const input = fields.nth(nth);
    await input.fill(`${await input.inputValue()} ${suffix}`);
    await input.press("Tab");
  };
  const open = async () => {
    await openJob(
      ctx,
      { doc: config.index.documents[0].document_id, page: "1" },
      "information-extract",
    );
    await fields.first().waitFor();
  };
  const banner = page.getByTestId("job-review-draft-banner");

  await open();
  await edit(0, "smoke-a");
  await sleep(300);
  await edit(1, "smoke-b");
  await sleep(300);
  report(
    "debounced-while-editing",
    (await drafts()) === null,
    `drafts ${await drafts()}`,
  );
  report(
    "saved-after-debounce",
    await eventually(
      async () => (await drafts()) === 2,
      DRAFT_DEBOUNCE_MS + 1000,
    ),
    `drafts ${await drafts()}`,
  );

  await edit(2, "smoke-c");
  await dispatchPageHide(page);
  report(
    "pagehide-flushes",
    (await drafts()) === 3,
    `drafts ${await drafts()}`,
  );

  await page.reload();
  await open();
  report(
    "banner-after-reload",
    (await eventually(async () => (await banner.count()) === 1)) &&
      (await page.getByTestId("job-review-draft-hint").count()) === 1,
  );
  await edit(0, "smoke-d");
  report(
    "first-edit-dismisses-banner",
    await eventually(async () => (await banner.count()) === 0),
  );
  report(
    "first-edit-replaces-draft",
    await eventually(
      async () => (await drafts()) === 1,
      DRAFT_DEBOUNCE_MS + 1000,
    ),
    `drafts ${await drafts()}`,
  );

  await page.reload();
  await open();
  await banner.waitFor();
  await page.getByTestId("job-review-draft-button-restore").click();
  report(
    "restore",
    (await eventually(async () => (await banner.count()) === 0)) &&
      (await page.getByTestId("job-review-change-count").count()) === 1 &&
      (await drafts()) === 1,
    `drafts ${await drafts()}`,
  );

  await page.reload();
  await open();
  await banner.waitFor();
  await page.getByTestId("job-review-draft-button-discard").click();
  report(
    "discard",
    (await eventually(async () => (await banner.count()) === 0)) &&
      (await eventually(
        async () => (await drafts()) === null,
        DRAFT_DEBOUNCE_MS + 1000,
      )),
    `drafts ${await drafts()}`,
  );
}

// ── save ──────────────────────────────────────────────────────────────────

/**
 * BFF 로 가져오기를 만들고 끝날 때까지 polling 해 마지막 리소스를 돌려준다(화면 조작 없이 같은 origin
 * fetch). 끝나지 않으면 `null`.
 */
function importDirect(page, collection, body) {
  return page.evaluate(
    async ({ collection, body }) => {
      const base = `/api/search-collections/${encodeURIComponent(collection)}/review-imports`;
      const created = await fetch(base, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `smoke-${crypto.randomUUID()}`,
        },
        body: JSON.stringify(body),
      });
      if (!created.ok) return { status: `http_${created.status}` };
      let resource = await created.json();
      const terminal = [
        "applied",
        "partially_applied",
        "no_change",
        "failed",
        "cancelled",
      ];
      for (let n = 0; n < 20 && !terminal.includes(resource.status); n += 1) {
        await new Promise(done => setTimeout(done, 300));
        const polled = await fetch(
          `${base}/${encodeURIComponent(resource.id)}`,
        );
        if (!polled.ok) return { status: `http_${polled.status}` };
        resource = await polled.json();
      }
      return resource;
    },
    { collection, body },
  );
}

/** 이 Job 의 검수 JSON(BFF `review-document`). */
function reviewDocumentDirect(page, collection, job) {
  return page.evaluate(
    async ({ collection, job }) => {
      const response = await fetch(
        `/api/search-collections/${encodeURIComponent(collection)}/review-document?job_ids=${encodeURIComponent(job)}`,
        { cache: "no-store" },
      );
      return response.ok ? response.json() : null;
    },
    { collection, job },
  );
}

/**
 * 저장 왕복: 첫 문서 Extract 결과의 문자열 칸 하나를 고쳐 헤더 "저장" → 저장됨 → 새로 고침 뒤에도 바뀐
 * 값 → 원래 값으로 되돌려 다시 저장. 그 뒤 `base_version` 을 하나 낮춘 본문을 BFF 에 직접 보내
 * `base_version_conflict` 로 끝나는지 본다. 끝에(실패해도) mock 서버 `POST /__mock/reset` 으로
 * 저장한 상태를 되돌린다 — 뒤 시나리오가 처음 데이터를 보도록.
 */
async function saveRoundTrip(ctx) {
  const { page, config, report } = ctx;
  const { collection, job } = config.index.ids;
  const resultId = extractResultId(0);
  const fields = page.locator(
    `[data-result-id="${resultId}"] ${FIELD_INPUT}:not([inputmode="decimal"])`,
  );
  const changeCount = page.getByTestId("job-review-change-count");
  // 저장 버전은 저장됨 문구의 `title` 에만 실린다(locale 과 무관하게 이것으로 저장됨을 본다).
  const savedStatus = page.locator(
    `${byTestId("job-review-save-status")} span[title]`,
  );
  const open = async () => {
    await openJob(
      ctx,
      { doc: config.index.documents[0].document_id, page: "1" },
      "information-extract",
    );
    await fields.first().waitFor();
  };
  /** 칸을 `value` 로 바꾸고 변경 1 이 될 때까지 기다린 뒤 저장하고, 저장됨이 보이면 참. */
  const editAndSave = async (input, value) => {
    await input.fill(value);
    await input.press("Tab");
    const counted = await eventually(
      async () =>
        (await changeCount.count()) === 1 &&
        (await changeCount.textContent())?.trim() === "1",
    );
    if (!counted) return `변경 수 ${await changeCount.textContent()}`;
    await page.getByTestId("job-review-button-save").click();
    const saved = await eventually(
      async () =>
        (await savedStatus.count()) === 1 && (await changeCount.count()) === 0,
      10_000,
    );
    return saved
      ? null
      : `저장 상태 ${await page.getByTestId("job-review-save-status").textContent()}`;
  };

  try {
    await open();
    const fieldId = await fields
      .first()
      .evaluate(
        element =>
          element.closest("[data-field-id]")?.getAttribute("data-field-id") ??
          null,
      );
    if (fieldId === null) {
      report("save-applied", false, "문자열 칸의 data-field-id 가 없음");
      return;
    }
    const input = page.locator(`[data-field-id="${fieldId}"] ${FIELD_INPUT}`);
    const original = await input.inputValue();
    const edited = `${original} smoke-save`;

    const applied = await editAndSave(input, edited);
    report("save-applied", applied === null, applied);
    if (applied !== null) return;

    await page.reload();
    await open();
    await input.waitFor();
    report(
      "save-reload-keeps-value",
      (await input.inputValue()) === edited,
      `${fieldId} = ${JSON.stringify(await input.inputValue())}`,
    );

    const reverted = await editAndSave(input, original);
    report("save-revert-applied", reverted === null, reverted);

    // 충돌: 지금 문서의 결과 version 을 하나 낮춰 보내면 아무것도 반영하지 않고 충돌로 끝난다.
    const reviewDoc = await reviewDocumentDirect(page, collection, job);
    const result = reviewDoc?.jobs?.[0]?.output?.find(
      item => item?.id === resultId,
    );
    if (!result) {
      report("save-conflict", false, "review-document 에서 결과를 찾지 못함");
    } else {
      const resource = await importDirect(page, collection, {
        format: reviewDoc.format,
        collection_id: reviewDoc.collection_id,
        configs: reviewDoc.configs,
        steps: reviewDoc.steps,
        jobs: [
          {
            id: job,
            output: [
              {
                id: result.id,
                step_id: result.step_id,
                base_version: result.base_version - 1,
                content: result.content,
              },
            ],
          },
        ],
      });
      const conflicts = resource?.error?.details?.conflicts ?? [];
      report(
        "save-conflict",
        resource?.status === "failed" &&
          resource.error?.code === "base_version_conflict" &&
          conflicts.some(
            item =>
              item?.target?.kind === "value" &&
              item.target.occurrence_id === resultId &&
              item.base === result.base_version - 1 &&
              item.current === result.base_version,
          ),
        `${resource?.status} ${resource?.error?.code ?? ""}`,
      );
    }
  } finally {
    let status = null;
    try {
      const response = await fetch(`${config.mock}/__mock/reset`, {
        method: "POST",
        headers: { Authorization: "Bearer smoke" },
      });
      status = response.status;
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
    }
    report("mock-reset", status === 204, `${config.mock} → ${status}`);
  }
}

// ── history ───────────────────────────────────────────────────────────────

/** 변경 이력 목록 한 쪽 행 수(`cursor-block.ts` 의 `PAGE_SIZE`). */
const HISTORY_PAGE_SIZE = 20;
/** 이력 목록이 한 번에 받는 행 수(`PAGE_SIZE × CURSOR_BLOCK_PAGES`). */
const HISTORY_BLOCK_ROWS = 100;

const historyRows = page => page.getByTestId("job-review-history-row");

/** 지금 쪽 행의 `data-revision-id` 목록. */
const historyRowIds = page =>
  historyRows(page).evaluateAll(rows =>
    rows.map(row => row.getAttribute("data-revision-id")),
  );

/** 목록 `<ol>` 직계 항목의 testid 목록(머리줄 · 행 · 기계 행 순서). */
/** 목록 항목 종류를 화면 순서대로(묶음 상자 안의 머리줄 · 행도 펼쳐서). */
const historyItemKinds = page =>
  page
    .getByTestId("job-review-history-list")
    .evaluate(list =>
      [
        ...list.querySelectorAll(
          '[data-testid="job-review-history-group"], [data-testid="job-review-history-row"], [data-testid="job-review-history-machine-row"]',
        ),
      ].map(item => item.getAttribute("data-testid")),
    );

/** `fn()` 이 바꾼 뒤 지금 쪽 행 id 가 `before` 와 달라질 때까지 기다려 새 목록을 돌려준다. */
async function changedRowIds(page, before) {
  const key = before.join(",");
  let ids = before;
  await eventually(async () => {
    ids = await historyRowIds(page);
    return ids.length > 0 && ids.join(",") !== key;
  }, 5000);
  return ids;
}

/** 헤더 "변경 이력" 을 눌러 시트가 열리고 행(또는 빈 목록·오류)이 보일 때까지 기다린다. */
async function openHistory(page) {
  await page.getByTestId("job-review-history-button-open").click();
  await page.getByTestId("job-review-history-sheet").waitFor();
  await eventually(
    async () =>
      (await historyRows(page).count()) > 0 ||
      (await page.getByTestId("job-review-history-empty").count()) > 0 ||
      (await page.getByTestId("job-review-history-error").count()) > 0,
    8000,
  );
}

async function closeHistory(page) {
  await page.getByTestId("job-review-history-button-close").click();
  await page.getByTestId("job-review-history-sheet").waitFor({
    state: "detached",
  });
}

/** 목록 요청(단건 GET 제외)의 URL 을 모은다. */
function trackRevisionLists(page) {
  const urls = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (/\/source-jobs\/[^/]+\/revisions$/.test(url.pathname)) {
      urls.push(url);
    }
  });
  return urls;
}

async function mockPost(config, path) {
  try {
    const response = await fetch(`${config.mock}${path}`, {
      method: "POST",
      headers: { Authorization: "Bearer smoke" },
    });
    return response.status;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** `src/messages/<locale>.json` 의 `review.tray.origin.*` 문구를 그 문구만 맞추는 정규식으로(ICU 인자는 아무 값). */
function trayOriginPatterns(locale) {
  const messages = JSON.parse(
    readFileSync(
      new URL(`../../src/messages/${locale}.json`, import.meta.url),
      "utf8",
    ),
  );
  const toPattern = template =>
    new RegExp(
      template
        .split(/\{[^}]*\}/)
        .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join(".+?"),
    );
  const origin = messages.review.tray.origin;
  return {
    original: toPattern(origin.original),
    revision: toPattern(origin.revision),
  };
}

/** 최초 원본 요청(`order=asc&limit=1`, 목록 경로)인가. */
const isOriginalRequest = url =>
  url.pathname.endsWith("/revisions") &&
  url.searchParams.get("order") === "asc" &&
  url.searchParams.get("limit") === "1";

/** 결과 대상의 최초 원본 요청인가(문서 구성 대상은 기계 행을 펼칠 때 따로 받는다). */
const isMachineRequest = url =>
  isOriginalRequest(url) && url.searchParams.get("type") !== "structure";

/** 문서 구성 대상의 최초 원본 요청인가. */
const isStructureOriginalRequest = url =>
  isOriginalRequest(url) && url.searchParams.get("type") === "structure";

/**
 * 최초 원본 요청을 `release()` 할 때까지(상한 10 초) 붙잡는다 — mock 에는 지연 수단이 없어 Playwright
 * `page.route` 로 받는 동안을 만든다. 끝나면 `dispose()` 로 놓아주고 route 를 걷는다.
 */
async function holdMachineRequests(page) {
  let release = () => {};
  const gate = new Promise(resolveGate => {
    release = resolveGate;
  });
  const hold = { held: 0 };
  const handler = async route => {
    hold.held += 1;
    await Promise.race([gate, sleep(10_000)]);
    // 그 사이 브라우저가 요청을 끊었으면(시트 닫기) 이어 보낼 것이 없다.
    await route.continue().catch(() => {});
  };
  await page.route(isMachineRequest, handler);
  hold.release = () => release();
  hold.dispose = async () => {
    release();
    await page.unroute(isMachineRequest, handler);
  };
  return hold;
}

/**
 * 시트를 열고 오래된 순으로 바꾼 뒤 최초 원본 행을 펼쳐 그 영역을 돌려준다. 펼치면 문서 구성 대상을
 * 받아 두므로(대상이 있을 때) 그 응답까지 기다린다 — 뒤 단계의 요청 가로채기·실패 주입과 겹치지 않게.
 */
async function openMachineTargets(page) {
  await openHistory(page);
  const before = await historyRowIds(page);
  await page.getByTestId("job-review-history-sort-button-oldest").click();
  await changedRowIds(page, before);
  const structureFetched = page
    .waitForResponse(
      response => isStructureOriginalRequest(new URL(response.url())),
      { timeout: 3000 },
    )
    .catch(() => null);
  await page.getByTestId("job-review-history-machine-toggle").click();
  const region = page.locator("#job-review-history-machine-detail");
  await region.waitFor();
  await structureFetched;
  return region;
}

/**
 * `rows` 가운데 현재 반영본이 아닌 값 행을 차례로 펼쳐, "편집에 불러오기" 가 처음 활성인 행을 누른다.
 * 누른 행이 없으면 `null`.
 */
async function loadFirstRow(page, rows) {
  const candidates = rows.filter({
    hasNot: page.getByTestId("job-review-history-row-badge-current"),
  });
  for (let n = 0; n < (await candidates.count()); n += 1) {
    const row = candidates.nth(n);
    if ((await row.getAttribute("data-type")) !== "result") continue;
    const toggle = row.getByTestId("job-review-history-row-toggle");
    if ((await toggle.getAttribute("aria-expanded")) !== "true") {
      await toggle.click();
    }
    const load = row.getByTestId("job-review-history-row-button-load");
    const ready = await eventually(
      async () =>
        (await row.getByTestId("job-review-history-row-load-blocked").count()) >
          0 ||
        ((await load.count()) > 0 && (await load.isEnabled())),
      5000,
    );
    if (ready && (await load.count()) > 0 && (await load.isEnabled())) {
      await load.click();
      return {
        id: await row.getAttribute("data-revision-id"),
        occurrenceId: await row.getAttribute("data-occurrence-id"),
        row,
      };
    }
  }
  return null;
}

/** 트레이를 열어(열려 있으면 그대로) 항목 글자를 돌려준다. 트레이는 열어 둔다. */
async function trayItemTexts(page) {
  if ((await page.getByTestId("job-review-tray").count()) === 0) {
    await page.getByTestId("job-review-tray-button-open").click();
  }
  const tray = page.getByTestId("job-review-tray");
  await tray.waitFor();
  return tray.getByTestId("job-review-tray-body-item").allInnerTexts();
}

/** 시트가 열려 있으면 닫고, 트레이 "모두 되돌리기" 로 변경 수를 0 으로 만든다. 0 이 되면 참. */
async function revertAllEdits(page) {
  const changeCount = page.getByTestId("job-review-change-count");
  if ((await page.getByTestId("job-review-history-sheet").count()) > 0) {
    await closeHistory(page);
  }
  if ((await changeCount.count()) === 0) return true;
  if ((await page.getByTestId("job-review-tray").count()) === 0) {
    await page.getByTestId("job-review-tray-button-open").click();
  }
  await page.getByTestId("job-review-tray-button-revert-all").click();
  await page.getByTestId("job-review-tray-button-revert-all-confirm").click();
  const reverted = await eventually(
    async () => (await changeCount.count()) === 0,
  );
  const tray = page.getByTestId("job-review-tray");
  if ((await tray.count()) > 0) {
    await page.getByTestId("job-review-tray-button-close").click();
    await tray.waitFor({ state: "detached" });
  }
  return reverted;
}

const changeCountOf = async page => {
  const count = page.getByTestId("job-review-change-count");
  return (await count.count()) === 0
    ? 0
    : Number(((await count.textContent()) ?? "").trim());
};

/** 이력을 볼 수 없는 Collection(capabilities `revisions_supported: false`): 헤더 버튼·결과 메뉴 항목 비활성. */
async function historyUnavailable(ctx) {
  const { context, page: firstPage, report } = ctx;
  const page = await context.newPage();
  try {
    await page.route("**/review-capabilities**", async route => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({
        response,
        json: { ...body, revisions_supported: false },
      });
    });
    await openJob({ ...ctx, page }, {}, "information-extract");
    const button = page.getByTestId("job-review-history-button-open");
    await button.waitFor();
    report("unavailable-button-disabled", await button.isDisabled());
    await page.getByTestId("job-review-history-button-open-wrapper").hover();
    const tooltip = page.getByTestId("job-review-history-unavailable-tooltip");
    const shown = await eventually(
      async () => (await tooltip.count()) > 0 && (await tooltip.isVisible()),
    );
    report(
      "unavailable-tooltip",
      shown && ((await tooltip.first().textContent()) ?? "").trim() !== "",
    );
    await page.mouse.move(0, 0);
    await page.getByTestId("job-review-result-button-menu").first().click();
    const item = page.getByTestId("job-review-result-menu-history");
    await item.waitFor();
    report(
      "unavailable-menu-item-disabled",
      (await item.getAttribute("data-disabled")) !== null,
    );
    await page.keyboard.press("Escape");
  } finally {
    await page.close();
    await firstPage.bringToFront();
  }
}

/** 번호 쪽 이동(`--history 60` 이상): 받은 범위 안 이동은 요청 없음, 마지막 쪽 끝에 기계 행. */
async function historyPages(ctx, requests) {
  const { page, config, report } = ctx;
  const total = config.index.history.rows;
  const first = await historyRowIds(page);
  report(
    "pages-first-full",
    first.length === HISTORY_PAGE_SIZE,
    `행 ${first.length}`,
  );
  const before = requests.length;
  await page.getByTestId("job-review-history-pagination-page-2").click();
  const second = await changedRowIds(page, first);
  report(
    "pages-goto-2",
    second.length > 0 && !second.some(id => first.includes(id)),
    `${second[0]} …`,
  );
  await page.getByTestId("job-review-history-pagination-next").click();
  const third = await changedRowIds(page, second);
  await page.getByTestId("job-review-history-pagination-previous").click();
  const back = await changedRowIds(page, third);
  report(
    "pages-next-previous",
    back.join(",") === second.join(","),
    `${third[0]} → ${back[0]}`,
  );
  report(
    "pages-no-request-inside-block",
    requests.length === before,
    `요청 ${requests.length - before}`,
  );

  const loadedPages = Math.ceil(
    Math.min(total, HISTORY_BLOCK_ROWS) / HISTORY_PAGE_SIZE,
  );
  if (total <= HISTORY_BLOCK_ROWS) {
    await page
      .getByTestId(`job-review-history-pagination-page-${loadedPages}`)
      .click();
    const last = await changedRowIds(page, back);
    const kinds = await historyItemKinds(page);
    report(
      "pages-last-machine-row",
      kinds.at(-1) === "job-review-history-machine-row" &&
        last.length === total - (loadedPages - 1) * HISTORY_PAGE_SIZE,
      `행 ${last.length}, 끝 ${kinds.at(-1)}`,
    );
    report(
      "pages-next-disabled-at-end",
      await page.getByTestId("job-review-history-pagination-next").isDisabled(),
    );
    return;
  }

  // 받은 블록의 마지막 쪽에서 "다음" 이면 다음 블록을 한 번 받아 이어 붙이고, 돌아갈 때는 다시 받지 않는다.
  await page
    .getByTestId(`job-review-history-pagination-page-${loadedPages}`)
    .click();
  const lastLoaded = await changedRowIds(page, back);
  const beforeBlock = requests.length;
  await page.getByTestId("job-review-history-pagination-next").click();
  const nextBlock = await changedRowIds(page, lastLoaded);
  const blockRequests = requests.slice(beforeBlock);
  report(
    "pages-next-block-request",
    blockRequests.length === 1 &&
      blockRequests[0].searchParams.get("after") !== null,
    blockRequests.map(url => url.search).join(" "),
  );
  report(
    "pages-next-block-page",
    nextBlock.length > 0 &&
      (await page
        .getByTestId(`job-review-history-pagination-page-${loadedPages + 1}`)
        .getAttribute("aria-current")) === "page",
    `행 ${nextBlock.length}`,
  );
  const beforeBack = requests.length;
  await page.getByTestId("job-review-history-pagination-previous").click();
  const returned = await changedRowIds(page, nextBlock);
  report(
    "pages-back-without-request",
    returned.join(",") === lastLoaded.join(",") &&
      requests.length === beforeBack,
    `요청 ${requests.length - beforeBack}`,
  );
}

/** 같은 저장 묶음 머리줄(seed `rvop_seed_2`, 값 2 건)의 "모두 불러오기". 시트가 닫힌 채 시작하고 닫힌 채 끝난다. */
async function historyGroupLoad(ctx) {
  const { page, config, report, skip } = ctx;
  const operation = "rvop_seed_2";
  await openHistory(page);
  // seed 묶음은 가장 오래된 저장이라 오래된 순 1 쪽에 있다.
  const before = await historyRowIds(page);
  await page.getByTestId("job-review-history-sort-button-oldest").click();
  await changedRowIds(page, before);
  const button = page.locator(
    `${byTestId("job-review-history-group-button-load-all")}[data-operation-id="${operation}"]`,
  );
  if ((await button.count()) === 0) {
    skip("group-load-all", `${operation} 묶음 "모두 불러오기" 버튼이 없음`);
    await closeHistory(page);
    return;
  }
  await button.click();
  const summary = page.locator(
    `${byTestId("job-review-history-group")}[data-operation-id="${operation}"] ${byTestId("job-review-history-group-load-summary")}`,
  );
  const shown = await eventually(async () => (await summary.count()) > 0, 8000);
  const loaded = shown ? Number(await summary.getAttribute("data-loaded")) : 0;
  const total = shown ? Number(await summary.getAttribute("data-total")) : 0;
  const count = await changeCountOf(page);
  // 같은 저장의 둘 중 하나(contract v2)는 지금 반영본이라 하나만 들어간다.
  report(
    "group-load-all",
    shown && total === 2 && loaded === 1 && count === loaded,
    `${loaded}/${total} 변경 수 ${count}`,
  );
  await closeHistory(page);
  const texts = await trayItemTexts(page);
  const origin = trayOriginPatterns(config.locale);
  report(
    "group-load-origin-note",
    texts.length === count && texts.every(text => origin.revision.test(text)),
    texts.join(" | "),
  );
  report("group-load-reverted", await revertAllEdits(page));
}

/**
 * 최초 원본 행(펼친 `region`, 오래된 순): 한 번 클릭 → 같은 값이라 버튼 막힘 → 트레이 출처 → 되돌리기, 그리고
 * 받는 동안(`page.route` 로 붙잡음) 같은 결과를 이력 행으로 바꾸면 넣지 않고 안내 · 접으면 넣지 않음 · 시트를
 * 닫으면 요청을 끊음, 429 카운트다운 뒤 다시 시도, 문서 구성 대상(영향 요약). 단계마다 되돌리고 시트를 닫는다.
 */
async function historyMachine(ctx, region) {
  const { page, config, report, skip } = ctx;
  const loadId = byTestId("job-review-history-machine-button-load");
  const first = region.locator(`${loadId}[data-occurrence-id]`).first();
  if (!((await first.count()) > 0 && (await first.isEnabled()))) {
    skip("machine-load-one-click", "최초 원본 불러오기 버튼 없음/비활성");
    await closeHistory(page);
    return;
  }
  const occurrenceId = await first.getAttribute("data-occurrence-id");
  // 받기 오류면 버튼이 사라지므로 대상 줄은 순번으로 찾는다(대상 순서는 고정).
  const lineIndex = await region
    .locator(":scope > ul > li")
    .evaluateAll(
      (lines, id) =>
        lines.findIndex(line =>
          line.querySelector(`[data-occurrence-id="${id}"]`),
        ),
      occurrenceId,
    );
  const lineOf = root => root.locator(":scope > ul > li").nth(lineIndex);
  const buttonOf = root => lineOf(root).locator(loadId);
  const loadedIn = locator =>
    locator.getByTestId("job-review-history-row-loaded").count();
  const origin = trayOriginPatterns(config.locale);
  const sameResultRows = () =>
    historyRows(page).and(
      page.locator(`[data-occurrence-id="${occurrenceId}"]`),
    );
  const machineArrived = () =>
    page
      .waitForResponse(response => isMachineRequest(new URL(response.url())), {
        timeout: 8000,
      })
      .catch(() => null);

  // 한 번 누르면 받기가 끝나는 대로 편집에 들어가고, 같은 대상은 이제 현재 값과 같아 막힌다.
  await first.click();
  report(
    "machine-load-one-click",
    await eventually(
      async () =>
        (await changeCountOf(page)) === 1 && (await loadedIn(region)) > 0,
      8000,
    ),
    `변경 수 ${await changeCountOf(page)}`,
  );
  report(
    "machine-load-same",
    (await buttonOf(region).isDisabled()) &&
      (await loadedIn(lineOf(region))) === 1,
  );
  await closeHistory(page);
  const texts = await trayItemTexts(page);
  report(
    "machine-load-origin-note",
    texts.length === 1 && origin.original.test(texts[0]),
    texts.join(" | "),
  );
  report("machine-load-reverted", await revertAllEdits(page));

  // 받는 동안 같은 결과를 이력 행으로 바꾸면, 늦게 온 최초 원본은 넣지 않고 안내만 → 다시 누르면 불러온다.
  let target = await openMachineTargets(page);
  let hold = await holdMachineRequests(page);
  try {
    await buttonOf(target).click();
    await eventually(() => hold.held > 0, 3000);
    const row = await loadFirstRow(page, sameResultRows());
    if (!row) {
      skip("machine-load-race-skip", "같은 결과의 불러올 수 있는 이력 행 없음");
    } else {
      await eventually(async () => (await loadedIn(row.row)) > 0);
      const arrived = machineArrived();
      hold.release();
      await arrived;
      const skipped = await eventually(
        async () =>
          (await target
            .getByTestId("job-review-history-machine-skipped")
            .count()) > 0,
        5000,
      );
      report(
        "machine-load-race-skip",
        skipped &&
          (await changeCountOf(page)) === 1 &&
          (await loadedIn(row.row)) > 0 &&
          (await loadedIn(lineOf(target))) === 0,
        `${row.id} 변경 수 ${await changeCountOf(page)}`,
      );
      // 받아 둔 출력으로 바로 넣는다(다시 받지 않음) — 이력 행 변경 위에 교체가 한 건 더 쌓인다.
      await buttonOf(target).click();
      report(
        "machine-load-race-reload",
        (await eventually(
          async () =>
            (await loadedIn(lineOf(target))) > 0 &&
            (await loadedIn(row.row)) === 0 &&
            (await changeCountOf(page)) === 2,
          5000,
        )) && hold.held === 1,
        `요청 ${hold.held} 변경 수 ${await changeCountOf(page)}`,
      );
    }
  } finally {
    await hold.dispose();
  }
  await revertAllEdits(page);

  // 받는 동안 최초 원본 행을 접으면 넣지 않고, 다시 펼쳐 버튼을 누르면 불러온다.
  target = await openMachineTargets(page);
  hold = await holdMachineRequests(page);
  try {
    await buttonOf(target).click();
    await eventually(() => hold.held > 0, 3000);
    await page.getByTestId("job-review-history-machine-toggle").click();
    await target.waitFor({ state: "detached" });
    const arrived = machineArrived();
    hold.release();
    await arrived;
    await sleep(300);
    const untouched = (await changeCountOf(page)) === 0;
    await page.getByTestId("job-review-history-machine-toggle").click();
    await target.waitFor();
    await eventually(() => buttonOf(target).isEnabled(), 5000);
    await buttonOf(target).click();
    report(
      "machine-load-collapse",
      untouched &&
        (await eventually(async () => (await changeCountOf(page)) === 1, 8000)),
      `접은 동안 ${untouched ? "변경 없음" : "변경 생김"}, 요청 ${hold.held}`,
    );
  } finally {
    await hold.dispose();
  }
  await revertAllEdits(page);

  // 받는 동안 시트를 닫으면 요청을 끊고, 늦게 온 응답도 편집에 넣지 않는다.
  target = await openMachineTargets(page);
  hold = await holdMachineRequests(page);
  const failed = [];
  const onFailed = request => {
    if (isMachineRequest(new URL(request.url()))) {
      failed.push(request.failure()?.errorText ?? "failed");
    }
  };
  page.on("requestfailed", onFailed);
  try {
    await buttonOf(target).click();
    await eventually(() => hold.held > 0, 3000);
    await closeHistory(page);
    hold.release();
    await eventually(() => failed.length > 0, 2000);
    await sleep(300);
    report(
      "machine-load-abort-on-close",
      failed.length > 0 && (await changeCountOf(page)) === 0,
      `${failed.join(" ") || "끊기지 않음"}, 변경 수 ${await changeCountOf(page)}`,
    );
  } finally {
    page.off("requestfailed", onFailed);
    await hold.dispose();
  }
  await revertAllEdits(page);

  // 429: 남은 초가 1 초마다 줄고 그동안 다시 시도는 비활성 → 활성이 되면 눌러 불러온다.
  target = await openMachineTargets(page);
  const injected = await mockPost(
    config,
    "/__mock/revisions-fail?status=429&count=1&retry_after=2",
  );
  await buttonOf(target).click();
  const alert = lineOf(target).getByRole("alert");
  const retry = lineOf(target).getByTestId(
    "job-review-history-detail-button-retry",
  );
  // 알림 글과 다시 시도 활성 여부를 같은 시점의 DOM 에서 한 번에 읽는다. 따로 읽으면 그 사이에
  // 1 초 카운트다운이 넘어가거나 알림이 사라져 글 읽기가 기다림에 걸린다.
  const countdownState = () =>
    lineOf(target).evaluate(line => {
      const shown = line.querySelector('[role="alert"]');
      const button = line.querySelector(
        '[data-testid="job-review-history-detail-button-retry"]',
      );
      return {
        alertText: shown === null ? null : (shown.textContent ?? ""),
        retryEnabled:
          button !== null &&
          button.matches(":enabled") &&
          button.getAttribute("aria-disabled") !== "true",
      };
    });
  await eventually(async () => (await alert.count()) > 0, 5000);
  const seen = [];
  let waitedDisabled = true;
  for (const deadline = Date.now() + 5000; Date.now() < deadline;) {
    const { alertText, retryEnabled: enabled } = await countdownState();
    if (alertText === null) break;
    const seconds = /\d+/.exec(alertText)?.[0];
    if (seconds === undefined) {
      if (enabled) break;
    } else {
      if (seen.at(-1) !== Number(seconds)) seen.push(Number(seconds));
      if (enabled) waitedDisabled = false;
    }
    await sleep(100);
  }
  report(
    "machine-load-429-countdown",
    injected === 204 &&
      seen[0] === 2 &&
      seen.at(-1) === 1 &&
      seen.length === 2 &&
      waitedDisabled,
    `${injected} 초 ${seen.join("→")}`,
  );
  const retryReady = (await retry.count()) > 0 && (await retry.isEnabled());
  if (retryReady) await retry.click();
  report(
    "machine-load-429-retry",
    retryReady &&
      (await eventually(
        async () =>
          (await changeCountOf(page)) === 1 &&
          (await loadedIn(lineOf(target))) > 0,
        8000,
      )),
  );
  await revertAllEdits(page);

  // 문서 구성 대상: 펼칠 때 받아 두므로 누르기 전에 영향 경고(문서 집합이 바뀔 때) → 누르면 트레이에
  // 구조 항목 하나와 불러온 뒤 영향 요약.
  target = await openMachineTargets(page);
  const structure = target.locator(`${loadId}:not([data-occurrence-id])`);
  if (!((await structure.count()) > 0 && (await structure.isEnabled()))) {
    skip("machine-load-structure", "문서 구성 대상이 없거나 비활성");
    await closeHistory(page);
    return;
  }
  const pending = target.locator(
    `${byTestId("job-review-history-machine-impact")}[data-state="pending"]`,
  );
  const warnedBefore = (await pending.count()) > 0;
  if (warnedBefore) {
    report(
      "machine-impact-before-load",
      (await changeCountOf(page)) === 0 &&
        ((await pending.textContent()) ?? "").trim() !== "",
    );
  } else {
    skip(
      "machine-impact-before-load",
      "최초 원본 문서 구성이 문서 집합을 바꾸지 않음",
    );
  }
  await structure.click();
  const structureLoaded = await eventually(
    async () =>
      (await changeCountOf(page)) >= 1 && (await loadedIn(target)) > 0,
    8000,
  );
  const impact = target.locator(
    `${byTestId("job-review-history-machine-impact")}[data-state="applied"]`,
  );
  if ((await impact.count()) > 0) {
    report(
      "machine-impact",
      ((await impact.textContent()) ?? "").trim() !== "",
    );
  } else {
    skip("machine-impact", "최초 원본 문서 구성이 문서 집합을 바꾸지 않음");
  }
  await closeHistory(page);
  const structureTexts = await trayItemTexts(page);
  report(
    "machine-load-structure",
    structureLoaded &&
      structureTexts.length === 1 &&
      origin.original.test(structureTexts[0]),
    structureTexts.join(" | "),
  );
  await revertAllEdits(page);
}

/**
 * 저장 뒤 다시 받아도 보던 쪽(1 부터)으로 돌아온다. 그 쪽까지 이동(받지 않은 블록이면 "다음" 으로 받음) →
 * 값 행 하나 불러오기 → 시트를 연 채 ⌘/Ctrl+S → 새 행이 맨 위에 붙어 그 쪽 행이 한 칸 밀린 채 같은 쪽.
 */
async function historyRestorePage(ctx, requests, pageNumber) {
  const { page, report, skip } = ctx;
  const check = `restore-page-${pageNumber}`;
  const pageButton = n =>
    page.getByTestId(`job-review-history-pagination-page-${n}`);
  const isCurrent = async n =>
    (await pageButton(n).count()) > 0 &&
    (await pageButton(n).getAttribute("aria-current")) === "page";
  await openHistory(page);
  for (let step = 0; step < pageNumber && !(await isCurrent(pageNumber));) {
    step += 1;
    const before = await historyRowIds(page);
    if ((await pageButton(pageNumber).count()) > 0) {
      await pageButton(pageNumber).click();
    } else {
      await page.getByTestId("job-review-history-pagination-next").click();
    }
    await changedRowIds(page, before);
  }
  if (!(await isCurrent(pageNumber))) {
    report(check, false, `${pageNumber} 쪽으로 이동하지 못함`);
    await closeHistory(page);
    return;
  }
  const loaded = await loadFirstRow(page, historyRows(page));
  if (!loaded) {
    skip(check, `${pageNumber} 쪽에 불러올 수 있는 값 행이 없음`);
    await revertAllEdits(page);
    return;
  }
  await eventually(async () => (await changeCountOf(page)) === 1);
  const before = await historyRowIds(page);
  const beforeRequests = requests.length;
  await page.keyboard.press("ControlOrMeta+s");
  const restored = await eventually(async () => {
    if ((await changeCountOf(page)) !== 0) return false;
    if (requests.length === beforeRequests) return false;
    const ids = await historyRowIds(page);
    return (
      ids.length > 0 &&
      ids.join(",") !== before.join(",") &&
      (await isCurrent(pageNumber))
    );
  }, 15_000);
  const after = await historyRowIds(page);
  report(
    check,
    restored && after[1] === before[0],
    `${loaded.id} 저장, 요청 ${requests.length - beforeRequests}, 첫 행 ${before[0]} → ${after[1]}`,
  );
  await closeHistory(page);
}

/**
 * Job 변경 이력 시트: 헤더 버튼(지원하지 않으면 비활성 + 이유 툴팁) → 목록 · 묶음 상자 · 번호 쪽 →
 * 묶음 "모두 불러오기" → 상세 · JSON → 편집에 불러오기 → 닫기 포커스 → 저장 뒤 현재 반영본 → 오래된 순과
 * 최초 원본 행(한 번 클릭 · 출처 · 받는 동안 경합 · 접기 · 닫기 · 429 카운트다운 · 문서 구성) → 결과 메뉴에서
 * 결과 필터로 열기 → 429 대기 → 같은 저장 묶음 머리줄 → 저장 뒤 보던 쪽 유지. 끝에(실패해도) `POST /__mock/reset`.
 */
async function history(ctx) {
  const { page, config, report } = ctx;
  const { collection, job } = config.index.ids;
  const total = config.index.history.rows;
  const requests = trackRevisionLists(page);
  const changeCount = page.getByTestId("job-review-change-count");
  const savedStatus = page.locator(
    `${byTestId("job-review-save-status")} span[title]`,
  );
  try {
    await historyUnavailable(ctx);

    // ① 헤더 버튼 → ② 목록
    await openJob(ctx, {}, "information-extract");
    const button = page.getByTestId("job-review-history-button-open");
    await button.waitFor();
    report("button-enabled", await button.isEnabled());
    await openHistory(page);
    const firstIds = await historyRowIds(page);
    report(
      "sheet-rows",
      firstIds.length === Math.min(total, HISTORY_PAGE_SIZE),
      `행 ${firstIds.length} / ${total}`,
    );
    const pagination = page.locator(
      '[data-testid^="job-review-history-pagination-"]',
    );
    report(
      "pagination-visibility",
      (await pagination.count()) > 0 === total > HISTORY_PAGE_SIZE,
      `버튼 ${await pagination.count()}`,
    );
    // 머리줄이 있는 묶음은 상자로 감싸고, 머리줄 옆 ! 에 설명 툴팁이 뜬다.
    const box = page.getByTestId("job-review-history-group-box").first();
    if ((await box.count()) > 0) {
      const boxed = await box.getByTestId("job-review-history-row").count();
      report("group-box", boxed > 0, `상자 안 행 ${boxed}`);
      const info = box
        .locator('[data-testid^="job-review-history-group-info-"]')
        .first();
      await info.hover();
      report(
        "group-info-tooltip",
        await eventually(
          async () =>
            ((await page.getByRole("tooltip").first().textContent()) ?? "")
              .length > 0,
          3000,
        ),
      );
      await page.mouse.move(0, 0);
    }
    if (total > HISTORY_PAGE_SIZE) await historyPages(ctx, requests);
    await closeHistory(page);
    await historyGroupLoad(ctx);
    await openHistory(page);

    // ③ 상세 · ④ JSON
    const valueRow = historyRows(page).and(
      page.locator('[data-type="result"]'),
    );
    await valueRow.first().getByTestId("job-review-history-row-toggle").click();
    const detail = valueRow.first().getByTestId("job-review-history-detail");
    const detailRows = await eventually(
      async () =>
        (await detail.count()) > 0 &&
        (await detail.locator('[role="row"]').count()) > 1,
      5000,
    );
    report("detail-table", detailRows);
    await detail.getByTestId("job-review-history-detail-button-json").click();
    report(
      "detail-json",
      await eventually(async () => (await detail.locator("pre").count()) > 0),
    );

    // ⑤ 현재 반영본이 아닌 값 행을 편집에 불러온다.
    const loaded = await loadFirstRow(page, historyRows(page));
    if (!loaded) {
      report("load-into-edits", false, "불러올 수 있는 값 행이 없음");
      return;
    }
    const loadedShown = await eventually(
      async () =>
        (await loaded.row
          .getByTestId("job-review-history-row-loaded")
          .count()) > 0,
    );
    report(
      "load-into-edits",
      loadedShown &&
        (await page.getByTestId("job-review-history-sheet").isVisible()) &&
        (await page.getByTestId("job-review-tray").count()) === 0 &&
        ((await changeCount.textContent()) ?? "").trim() === "1",
      `${loaded.id} 변경 수 ${await changeCount.textContent()}`,
    );
    const previousCurrent = await historyRows(page)
      .filter({ has: page.getByTestId("job-review-history-row-badge-current") })
      .and(page.locator(`[data-occurrence-id="${loaded.occurrenceId}"]`))
      .first()
      .getAttribute("data-revision-id")
      .catch(() => null);

    // ⑥ 닫으면 헤더 버튼으로 포커스가 돌아온다.
    await closeHistory(page);
    report(
      "close-focus-returns",
      await eventually(() =>
        page.evaluate(
          () =>
            document.activeElement?.getAttribute("data-testid") ===
            "job-review-history-button-open",
        ),
      ),
    );

    // ⑦ 저장 → 맨 위 새 행이 현재 반영본, 그 결과의 이전 반영본은 뱃지를 잃는다.
    await page.getByTestId("job-review-button-save").click();
    const saved = await eventually(
      async () =>
        (await savedStatus.count()) === 1 && (await changeCount.count()) === 0,
      10_000,
    );
    report("save-loaded", saved);
    await openHistory(page);
    const top = historyRows(page).first();
    const topId = await top.getAttribute("data-revision-id");
    report(
      "save-top-current",
      !firstIds.includes(topId) &&
        (await top.getAttribute("data-occurrence-id")) ===
          loaded.occurrenceId &&
        (await top
          .getByTestId("job-review-history-row-badge-current")
          .count()) === 1,
      topId,
    );
    if (previousCurrent) {
      const old = page.locator(
        `${byTestId("job-review-history-row")}[data-revision-id="${previousCurrent}"]`,
      );
      report(
        "save-previous-not-current",
        (await old.count()) === 0 ||
          (await old
            .getByTestId("job-review-history-row-badge-current")
            .count()) === 0,
        previousCurrent,
      );
    }

    // ⑧ 오래된 순: 서버에 order=asc 로 받고 1 쪽 처음이 최초 원본 행.
    const beforeSort = requests.length;
    await page.getByTestId("job-review-history-sort-button-oldest").click();
    const oldest = await changedRowIds(page, await historyRowIds(page));
    const kinds = await historyItemKinds(page);
    report(
      "oldest-request-asc",
      requests
        .slice(beforeSort)
        .some(url => url.searchParams.get("order") === "asc"),
    );
    report(
      "oldest-machine-first",
      kinds[0] === "job-review-history-machine-row" && oldest.length > 0,
      kinds.slice(0, 2).join(" "),
    );
    report(
      "oldest-first-v0",
      /v0→v1/.test(
        (await historyRows(page)
          .first()
          .getByTestId("job-review-history-row-toggle")
          .textContent()) ?? "",
      ),
    );
    await page.getByTestId("job-review-history-machine-toggle").click();
    const machineRegion = page.locator("#job-review-history-machine-detail");
    await machineRegion.waitFor();
    report(
      "machine-targets",
      (await machineRegion
        .getByTestId("job-review-history-machine-button-load")
        .count()) > 0 || ((await machineRegion.textContent()) ?? "") !== "",
    );
    await historyMachine(ctx, machineRegion);

    // ⑨ 결과 메뉴 → 그 결과의 이력(결과 칩, 모든 행이 같은 결과) → 칩 지우기
    const resultId = loaded.occurrenceId;
    const docIndex = Number(/_(\d+)$/.exec(resultId)?.[1] ?? 1) - 1;
    await openJob(
      ctx,
      { doc: config.index.documents[docIndex].document_id, page: "1" },
      "information-extract",
    );
    const menuButton = page.locator(
      `[data-result-id="${resultId}"] ${byTestId("job-review-result-button-menu")}`,
    );
    await menuButton.click();
    await page.getByTestId("job-review-result-menu-history").click();
    await page.getByTestId("job-review-history-sheet").waitFor();
    await eventually(async () => (await historyRows(page).count()) > 0, 8000);
    const occurrenceIds = await historyRows(page).evaluateAll(rows =>
      rows.map(row => row.getAttribute("data-occurrence-id")),
    );
    report(
      "result-menu-filter",
      (await page.getByTestId("job-review-history-result-chip").count()) ===
        1 &&
        occurrenceIds.length > 0 &&
        occurrenceIds.every(id => id === resultId),
      `${occurrenceIds.length} 행`,
    );
    // 칩을 지우면 결과 조건 없이 다시 받는다(첫 쪽이 모두 같은 결과일 수도 있어 요청으로 본다).
    const beforeClear = requests.length;
    await page.getByTestId("job-review-history-result-chip-clear").click();
    const unfiltered = await eventually(() =>
      requests
        .slice(beforeClear)
        .some(url => !url.searchParams.has("occurrence_id")),
    );
    report(
      "result-chip-clear",
      (await page.getByTestId("job-review-history-result-chip").count()) ===
        0 &&
        unfiltered &&
        (await eventually(async () => (await historyRows(page).count()) > 0)),
    );
    await closeHistory(page);
    report(
      "result-menu-focus-returns",
      await eventually(() =>
        menuButton.evaluate(element => document.activeElement === element),
      ),
    );
    report(
      "body-pointer-events",
      await page.evaluate(() => document.body.style.pointerEvents !== "none"),
    );

    // ⑩ 429: 안내 + 다시 시도 비활성 → Retry-After 뒤 활성 → 성공
    const injected = await mockPost(
      config,
      "/__mock/revisions-fail?status=429&count=1&retry_after=1",
    );
    report("busy-inject", injected === 204, String(injected));
    await openHistory(page);
    const retry = page.getByTestId("job-review-history-button-retry");
    report(
      "busy-error",
      (await page.getByTestId("job-review-history-error").count()) === 1 &&
        (await retry.isDisabled()),
    );
    const retryReady = await eventually(() => retry.isEnabled(), 5000);
    if (retryReady) await retry.click();
    report(
      "busy-retry",
      retryReady &&
        (await eventually(async () => (await historyRows(page).count()) > 0)),
    );
    await closeHistory(page);

    // ⑪ 결과 둘을 한 번에 저장하면 같은 저장 머리줄이 맨 위에 붙는다.
    const reviewDoc = await reviewDocumentDirect(page, collection, job);
    const outputs = (reviewDoc?.jobs?.[0]?.output ?? []).filter(item =>
      config.index.history.results.includes(item?.id),
    );
    if (outputs.length < 2) {
      ctx.skip("group-same", "이력이 있는 값 결과가 둘 미만");
    } else {
      const resource = await importDirect(page, collection, {
        format: reviewDoc.format,
        collection_id: reviewDoc.collection_id,
        configs: reviewDoc.configs,
        steps: reviewDoc.steps,
        jobs: [
          {
            id: job,
            output: outputs.slice(0, 2).map(item => ({
              id: item.id,
              step_id: item.step_id,
              base_version: item.base_version,
              content: item.content,
            })),
          },
        ],
      });
      await page.reload();
      await openJob(ctx, {}, "information-extract");
      await openHistory(page);
      const head = await historyItemKinds(page);
      const group = page.getByTestId("job-review-history-group").first();
      report(
        "group-same",
        resource?.status === "applied" &&
          head[0] === "job-review-history-group" &&
          !((await group.getAttribute("data-operation-id")) ?? "").startsWith(
            "rvop_seed",
          ),
        `${resource?.status} ${head.slice(0, 3).join(" ")}`,
      );
      await closeHistory(page);
    }

    // ⑫ 저장 뒤 다시 받아도 보던 쪽으로 돌아온다(블록 경계를 넘는 쪽 포함).
    if (total > HISTORY_PAGE_SIZE * 2) {
      await historyRestorePage(ctx, requests, 3);
    }
    if (total > HISTORY_BLOCK_ROWS) {
      await historyRestorePage(
        ctx,
        requests,
        HISTORY_BLOCK_ROWS / HISTORY_PAGE_SIZE + 1,
      );
    }
  } finally {
    const status = await mockPost(config, "/__mock/reset");
    report("mock-reset", status === 204, `${config.mock} → ${status}`);
  }
}

// ── highlights-retry ──────────────────────────────────────────────────────

/** 앱이 하이라이트를 받는 묶음 크기(파일 로컬 쪽, `large-job.ts` 의 `HIGHLIGHT_CHUNK`). */
const HIGHLIGHT_CHUNK = 20;
/** 시나리오가 여는 긴 문서의 쪽(문서 안 1 부터). */
const RETRY_DOCUMENT_PAGE = 10;

/**
 * 긴 문서 `RETRY_DOCUMENT_PAGE` 쪽이 속한 하이라이트 묶음 `{ fileId, range }`(`range` 는 `pages=a-b`).
 * 병합 쪽 번호를 `index.json` `files[]`(병합 순서)의 쪽수로 파일 로컬 쪽으로 바꾸고, 묶음 끝은 파일
 * 쪽수를 넘지 않는다.
 */
function retryRange(index) {
  const merged = longDocument(index).first + RETRY_DOCUMENT_PAGE - 1;
  let offset = 0;
  for (const file of index.files ?? []) {
    if (merged <= offset + file.num_pages) {
      const local = merged - offset;
      const from =
        Math.floor((local - 1) / HIGHLIGHT_CHUNK) * HIGHLIGHT_CHUNK + 1;
      return {
        fileId: file.id,
        range: `${from}-${Math.min(from + HIGHLIGHT_CHUNK - 1, file.num_pages)}`,
      };
    }
    offset += file.num_pages;
  }
  return null;
}

async function highlightsRetry(ctx) {
  const { page, config, report } = ctx;
  const long = longDocument(config.index);
  const target = retryRange(config.index);
  if (target === null) {
    report(
      "retry-range",
      false,
      "index.json files[] 에서 긴 문서 쪽을 찾지 못함",
    );
    return;
  }
  const { fileId, range } = target;
  let requests = 0;
  await page.route(
    url =>
      url.pathname.endsWith(
        `/files/${encodeURIComponent(fileId)}/highlights`,
      ) && url.searchParams.get("pages") === range,
    async route => {
      requests += 1;
      if (requests === 1) await route.fulfill({ status: 500, body: "smoke" });
      else await route.continue();
    },
  );
  // 긴 문서 10 쪽을 Parse 탭으로 보면 그 쪽이 속한 묶음(`range`)을 받는다.
  await openJob(
    ctx,
    { doc: long.document_id, page: String(RETRY_DOCUMENT_PAGE) },
    "document-parse",
  );
  const status = page.getByTestId("job-review-viewer-highlights-status");
  const retry = page.getByTestId("job-review-viewer-button-highlights-retry");
  report(
    "failure-shows-retry",
    (await eventually(async () => (await retry.count()) === 1, 10_000)) &&
      (await status.count()) === 1,
    `요청 ${requests}`,
  );
  if ((await retry.count()) === 0) return;
  await retry.click();
  report(
    "retry-recovers",
    await eventually(
      async () => (await retry.count()) === 0 && (await status.count()) === 0,
      10_000,
    ),
  );
  await sleep(300);
  report("retried-once", requests === 2, `${range} 요청 ${requests} 회`);
}

// ── parse ─────────────────────────────────────────────────────────────────

/**
 * 둘째 이후 입력 파일마다, 첫 쪽이 그 파일에 있는 문서 하나와 그 쪽의 파일 로컬 번호. `index.json`
 * `files[]` 는 병합 순서다.
 */
function documentsPerLaterFile(index) {
  const out = [];
  let offset = 0;
  (index.files ?? []).forEach((file, at) => {
    const doc = index.documents.find(
      item => item.first > offset && item.first <= offset + file.num_pages,
    );
    if (at > 0 && doc) {
      out.push({ file: at + 1, doc, local: doc.first - offset });
    }
    offset += file.num_pages;
  });
  return out;
}

/**
 * Parse 탭 표 요소: 허용 목록으로 다시 만든 표가 보이고(mock 표 `html` 의 script·이벤트 속성·링크·그림은
 * 그리지 않는다), 전환 버튼으로 `html` 원문 글자 ↔ 표를 오가며, 표 영역을 누르면 그 행이 선택된다.
 */
async function parseTable(ctx, list) {
  const { page, report } = ctx;
  const tableSelector = `${byTestId("job-review-parse-table")} table`;
  const firstTableRow = page
    .locator(`${list} [data-item-id]`)
    .filter({ has: page.locator(tableSelector) })
    .first();
  const shown = await eventually(
    async () => (await firstTableRow.count()) > 0,
    5000,
  );
  // 원문 보기에서는 표가 사라지므로 행은 id 로 고정해 찾는다.
  const rowId = shown ? await firstTableRow.getAttribute("data-item-id") : "";
  const row = page.locator(`${list} [data-item-id="${rowId}"]`);
  const region = row.locator(byTestId("job-review-parse-table"));
  const audit = shown
    ? await region.evaluate(element => ({
        forbidden: element.querySelectorAll(
          "script, a, img, style, iframe, [onclick], [onerror], [style], [id], [href], [src]",
        ).length,
        colspan: element.querySelectorAll("td[colspan]").length,
        alt: element.querySelectorAll("td > span").length,
        xss: window.__parseTableXss,
      }))
    : null;
  report(
    "table-renders",
    shown && audit.alt > 0,
    shown ? `그림 대체 글자 ${audit.alt}` : "표 행 없음",
  );
  report(
    "table-allowlist",
    shown && audit.forbidden === 0 && audit.xss === undefined,
    shown
      ? `금지 요소·속성 ${audit.forbidden}, xss ${audit.xss}`
      : "표 행 없음",
  );
  report(
    "table-colspan",
    shown && audit.colspan > 0,
    shown ? `td[colspan] ${audit.colspan}` : "표 행 없음",
  );

  // 전환: 표 → 원문(본문에 html 소스 글자) → 표.
  let toSource = false;
  let backToTable = false;
  let detail = "표 행 없음";
  if (shown) {
    const toggle = row.getByTestId("job-review-parse-table-toggle");
    const body = row.locator('[data-slot="document-element-list-body"]');
    await toggle.click();
    toSource = await eventually(
      async () =>
        (await row.locator(tableSelector).count()) === 0 &&
        (await toggle.getAttribute("aria-pressed")) === "true" &&
        ((await body.textContent()) ?? "").includes("<table"),
      3000,
    );
    await toggle.click();
    backToTable = await eventually(
      async () =>
        (await row.locator(tableSelector).count()) === 1 &&
        (await toggle.getAttribute("aria-pressed")) === "false",
      3000,
    );
    detail = `원문 ${toSource}, 표 복귀 ${backToTable}`;
  }
  report("table-source-toggle", toSource && backToTable, detail);

  // 표 영역을 누르면 그 행이 선택된다(보조 자리지만 표 영역은 행 선택으로 잇는다).
  let selected = false;
  if (shown) {
    await region.click();
    selected = await eventually(
      async () => (await row.getAttribute("data-selected")) === "true",
      3000,
    );
  }
  report("table-click-selects", selected, `행 선택 ${selected}`);
}

async function parse(ctx) {
  const { page, report } = ctx;
  const list = byTestId("job-review-parse");
  const selectedPath = 'path[data-highlight-id][data-selected="true"]';
  let tableChecked = false;
  for (const { file, doc, local } of documentsPerLaterFile(ctx.config.index)) {
    await openJob(ctx, { doc: doc.document_id, page: "1" }, "document-parse");
    await page.waitForSelector(list);
    const items = page.locator(`${list} [data-item-id]`);
    await eventually(async () => (await items.count()) > 0, 10_000);
    // 1. 목록 항목(그 문서 1 쪽 = 파일 로컬 `local` 쪽)을 누르면 뷰어가 같은 id 의 영역을 고른다.
    const key = new RegExp(`^parse:.+:p${local}-\\d+$`);
    const ids = await items.evaluateAll(elements =>
      elements.map(element => element.getAttribute("data-item-id")),
    );
    const itemId = ids.find(id => key.test(id ?? "")) ?? null;
    let viewerId = null;
    if (itemId) {
      await page
        .locator(`${list} [data-item-id="${itemId}"]`)
        .locator('[data-slot="document-element-list-label"]')
        .click();
      viewerId = await eventually(
        () =>
          page.evaluate(
            selector =>
              document
                .querySelector(selector)
                ?.getAttribute("data-highlight-id") ?? null,
            selectedPath,
          ),
        5000,
      );
    }
    report(
      `file${file}-list-to-viewer`,
      itemId !== null && viewerId === itemId,
      `${doc.document_id}(로컬 ${local} 쪽) 항목 ${itemId} → 뷰어 ${viewerId}`,
    );

    // 2. 같은 쪽의 다른 뷰어 영역(목록 끝 쪽)을 누르면 목록이 그 항목을 고르고 보이게 스크롤한다.
    const otherId = await page.evaluate(
      ({ pattern, skip }) => {
        const key = new RegExp(pattern);
        const candidates = [
          ...document.querySelectorAll("path[data-highlight-id]"),
        ]
          .map(element => element.getAttribute("data-highlight-id"))
          .filter(
            id =>
              id !== skip &&
              key.test(id ?? "") &&
              document.querySelector(`[data-item-id="${CSS.escape(id)}"]`),
          );
        return candidates.at(-1) ?? null;
      },
      { pattern: key.source, skip: itemId },
    );
    let listSelected = false;
    let inView = false;
    if (otherId) {
      await page
        .locator(`path[data-highlight-id="${otherId}"]`)
        .first()
        .dispatchEvent("click");
      const row = page.locator(`${list} [data-item-id="${otherId}"]`);
      listSelected = await eventually(
        async () => (await row.getAttribute("data-selected")) === "true",
        5000,
      );
      inView = await eventually(
        () =>
          row.evaluate(element => {
            const rect = element.getBoundingClientRect();
            return rect.bottom > 0 && rect.top < window.innerHeight;
          }),
        3000,
      );
    }
    report(
      `file${file}-viewer-to-list`,
      otherId !== null && listSelected && inView,
      `뷰어 ${otherId} → 목록 선택 ${listSelected}, 보임 ${inView}`,
    );

    if (!tableChecked) {
      tableChecked = true;
      await parseTable(ctx, list);
    }
  }
}

// ── small-job ─────────────────────────────────────────────────────────────

async function smallJob(ctx) {
  const { page, config, report } = ctx;
  const documents = config.index.documents;
  await openJob(ctx, {}, "document-classify");
  await page.waitForSelector(byTestId("job-review-filmstrip"));
  report(
    "filmstrip-shows-all-strips",
    (await page.locator(byTestId("job-review-filmstrip-scroller")).count()) ===
      0 &&
      (await page
        .locator(`${byTestId("job-review-filmstrip")} [data-document-id]`)
        .count()) === documents.length,
  );
  report(
    "document-list-not-windowed",
    (await page
      .locator(byTestId("job-review-document-list-viewport"))
      .count()) === 0 &&
      (await page
        .getByTestId("job-review-document-list-button-select")
        .count()) === documents.length,
  );
  // 값 탭의 짧은 문서는 뷰어 위 띠(위치 바)가 없다(쪽 이동은 뷰어 아래 툴바의 "n / m"). 뷰어 툴바가 그
  // 문서의 쪽수를 보일 때까지 기다린 뒤에 위치 바를 센다(그 전에 세면 아직 안 그려져 늘 0 이다).
  await openTab(ctx, "information-extract");
  const first = documents[0];
  await page.waitForSelector(byTestId("job-review-viewer-column"));
  const pageTotal = page.getByTestId("job-review-viewer-toolbar-page-total");
  const viewerTotal = async () =>
    (await pageTotal.count()) > 0
      ? ((await pageTotal.first().textContent()) ?? "").trim()
      : null;
  const viewerReady = await eventually(
    async () => (await viewerTotal()) === String(first.pages),
    10_000,
  );
  const positionBars = await page
    .locator(byTestId("job-review-position-bar"))
    .count();
  report(
    "short-doc-no-page-band",
    first.pages >= POSITION_BAR_FROM || (viewerReady && positionBars === 0),
    `문서 ${first.pages}쪽, 뷰어 쪽수 ${await viewerTotal()}, 위치 바 ${positionBars}`,
  );
}

// ── header-actions-one-row ────────────────────────────────────────────────

/** 머리 줄이 세 열 grid 가 되는 가장 좁은 폭(Tailwind `xl`). */
const HEADER_GRID_FROM = 1280;
/** 동작 묶음이 Step 트랙과 같은 줄인지 볼 때 허용하는 top 차이(px, 버튼 32 · 트랙 48 높이 차 포함). */
const HEADER_ROW_TOLERANCE = 12;

/**
 * 머리 줄이 grid 가 되는 가장 좁은 폭에서, Step 탭이 가장 많은 문서를 골라도 저장·검수 완료 버튼이
 * 한 줄에 있고 그 줄이 Step 트랙 줄과 같은지 본다(탭 이름이 말줄임되어 트랙이 줄어든다). 끝나면 뷰포트를 되돌린다.
 */
async function headerActionsOneRow(ctx) {
  const { page, report } = ctx;
  const original = page.viewportSize();
  const tabs = page.locator('[data-testid^="job-review-step-tab-"]');
  try {
    await page.setViewportSize({
      width: HEADER_GRID_FROM,
      height: original?.height ?? 1000,
    });
    await openJob(ctx);
    await tabs.first().waitFor();
    // 문서 목록 앞쪽에서 탭이 가장 많은 문서(문서 종류마다 Extract·Validate 탭 유무가 다르다).
    const select = page.getByTestId("job-review-document-list-button-select");
    const candidates = Math.min(await select.count(), 6);
    let best = 0;
    let bestTabs = -1;
    for (let at = 0; at < candidates; at += 1) {
      await select.nth(at).click();
      await page.waitForTimeout(300);
      const count = await tabs.count();
      if (count > bestTabs) {
        bestTabs = count;
        best = at;
      }
    }
    await select.nth(best).click();
    const top = async testId => {
      const box = await page.getByTestId(testId).first().boundingBox();
      return box ? Math.round(box.y) : null;
    };
    const measure = async () => {
      const firstTab = await tabs.first().boundingBox();
      return {
        save: await top("job-review-button-save"),
        complete: await top("job-review-button-complete"),
        tab: firstTab ? Math.round(firstTab.y) : null,
      };
    };
    // 문서를 바꾼 뒤 탭 수가 바뀌면 배치가 다시 잡히므로 두 번 연속 같은 값이 나올 때까지 본다.
    let last = null;
    const tops =
      (await eventually(
        async () => {
          const now = await measure();
          const settled =
            last !== null && JSON.stringify(now) === JSON.stringify(last);
          last = now;
          return settled ? now : null;
        },
        5000,
        200,
      )) ?? last;
    const detail = `폭 ${HEADER_GRID_FROM} · 문서 ${best + 1} · 탭 ${bestTabs} · 저장 ${tops?.save} · 검수 완료 ${tops?.complete} · 첫 탭 ${tops?.tab}`;
    report(
      "save-complete-same-row",
      tops?.save !== null &&
        tops?.save !== undefined &&
        tops.save === tops.complete,
      detail,
    );
    report(
      "actions-on-step-row",
      tops?.complete !== null &&
        tops?.tab !== null &&
        tops !== null &&
        Math.abs(tops.complete - tops.tab) <= HEADER_ROW_TOLERANCE,
      detail,
    );
  } finally {
    if (original) await page.setViewportSize(original);
  }
}

// ── defaults ──────────────────────────────────────────────────────────────

/** 설정 메뉴를 열어 부가 기능 하나를 켜거나 끄고 닫는다. */
async function toggleFeature(page, feature) {
  await page.getByTestId("app-header-button-settings").click();
  await page.getByTestId(`settings-menu-checkbox-${feature}`).click();
  await page.keyboard.press("Escape");
  await page
    .getByTestId(`settings-menu-checkbox-${feature}`)
    .waitFor({ state: "detached" });
}

/**
 * 설정을 건드리지 않은 기본 화면(localStorage 비어 있음). 페이지 썸네일 토글은 기본으로 보이고(기본
 * 켜짐) 띠는 문서가 나뉜 Job 이면 펼친 채, 아니면 접힌 채 시작한다. 페이지 편집 도구, 페이지 정리, JSON 메뉴, 변경 이력, 보기 전용 단계는 숨는다. 기능을 끈 뒤에도 제외한
 * 문서는 되돌릴 수 있고, 페이지 썸네일까지 끄면 제외한 페이지는 안내에서 페이지 썸네일을 켜 되돌릴 수 있다.
 */
async function defaults(ctx) {
  const { page, config, report } = ctx;
  const { index } = config;
  await openJob(ctx);
  const tabCount = type =>
    page.getByTestId(`job-review-step-tab-${stepIdOf(index, type)}`).count();
  report(
    "view-only-steps-hidden",
    (await tabCount("document-parse")) === 0 &&
      (await tabCount("instruct")) === 0 &&
      (await tabCount("information-extract")) === 1 &&
      (await tabCount("document-classify")) === 1,
  );
  report(
    "json-menu-hidden",
    (await page.getByTestId("job-review-json-menu-trigger").count()) === 0,
  );
  report(
    "history-hidden",
    (await page.getByTestId("job-review-history-button-open").count()) === 0 &&
      (await page
        .getByTestId("job-review-history-button-open-wrapper")
        .count()) === 0,
  );

  await openTab(ctx, "document-classify");
  await page.waitForSelector(byTestId("job-review-structure-label-select"));
  const counts = async ids =>
    Object.fromEntries(
      await Promise.all(
        ids.map(async id => [id, await page.getByTestId(id).count()]),
      ),
    );
  const hidden = await counts([
    "job-review-structure-toolbar",
    "job-review-structure-button-exclude",
    "job-review-structure-button-new-document",
    "job-review-viewer-button-organizer",
  ]);
  report(
    "page-tools-hidden",
    Object.values(hidden).every(count => count === 0),
    JSON.stringify(hidden),
  );
  report(
    "filmstrip-toggle-shown",
    (await page.getByTestId("job-review-viewer-button-filmstrip").count()) ===
      1,
  );
  // 띠 펼침 기억값이 없으면 문서가 나뉜 Job 은 펼친 채, 나뉘지 않은 Job 은 접힌 채 시작한다.
  const splitData = index.options?.split !== false;
  const filmstripToggle = page.getByTestId(
    "job-review-viewer-button-filmstrip",
  );
  const bandCount = splitData ? 1 : 0;
  const expanded = splitData ? "true" : "false";
  const bandAsExpected = await eventually(
    async () =>
      (await page.locator(byTestId("job-review-filmstrip")).count()) ===
        bandCount &&
      (await filmstripToggle.getAttribute("aria-expanded")) === expanded,
  );
  report(
    splitData ? "filmstrip-open-by-default" : "filmstrip-closed-by-default",
    bandAsExpected,
  );

  // 페이지 편집 도구를 잠시 켜서 첫 문서의 페이지 하나와 문서를 제외한 뒤 다시 끈다.
  await toggleFeature(page, "pageTools");
  await page.getByTestId("job-review-structure-toolbar-button-exclude").click();
  await page.getByTestId("job-review-structure-button-exclude").click();
  await page.waitForSelector(byTestId("job-review-structure-button-restore"));
  await toggleFeature(page, "pageTools");
  report(
    "excluded-document-restorable",
    (await page.getByTestId("job-review-structure-button-restore").count()) ===
      1 &&
      (await page
        .getByTestId("job-review-structure-button-exclude")
        .count()) === 0,
  );

  // 페이지 썸네일도 끄면 토글이 사라지고, 제외한 페이지를 되돌릴 길은 안내만 남는다.
  await toggleFeature(page, "filmstrip");
  report(
    "filmstrip-off-hides-toggle",
    (await page.getByTestId("job-review-viewer-button-filmstrip").count()) ===
      0,
  );

  const hint = page.getByTestId("job-review-excluded-pages-hint");
  const hintShown = await eventually(async () => (await hint.count()) === 1);
  await page
    .getByTestId("job-review-excluded-pages-hint-button-enable")
    .click();
  const restorable = await eventually(
    async () =>
      (await hint.count()) === 0 &&
      (await page.getByTestId("job-review-viewer-button-filmstrip").count()) ===
        1 &&
      (await page.getByTestId("job-review-filmstrip-excluded").count()) > 0,
    5000,
  );
  report(
    "excluded-pages-hint-opens-filmstrip",
    hintShown && restorable,
    `안내 ${hintShown}, 썸네일과 제외 칸 ${restorable}`,
  );
}

// ── organizer ─────────────────────────────────────────────────────────────

async function organizer(ctx) {
  const { page, config, report, skip } = ctx;
  const documents = config.index.documents;
  const total = config.index.totalPages;
  const long = longDocument(config.index);
  await openJob(ctx, { doc: long.document_id, page: "1" }, "document-classify");
  await page.waitForSelector(byTestId("job-review-filmstrip"));

  // 열면 작업 패널 자리에 격자가 들어가고 필름스트립 띠·띠 토글은 숨는다.
  const toggle = page.getByTestId("job-review-viewer-button-organizer");
  await toggle.click();
  const grid = page.getByTestId("job-review-organizer");
  await grid.waitFor();
  report(
    "organizer-visible",
    (await grid.count()) === 1 &&
      (await page.locator(byTestId("job-review-filmstrip")).count()) === 0 &&
      (await page
        .locator(byTestId("job-review-viewer-button-filmstrip"))
        .count()) === 0 &&
      (await toggle.getAttribute("aria-expanded")) === "true",
  );
  // 띠를 펼쳐 둔 채 열어도 띠가 숨으므로 화면은 창 높이에 맞는다.
  report(
    "viewport-fit",
    (await page.locator('[data-viewport-fit="true"]').count()) === 1,
  );

  // 보이는 행(위·아래 여유 포함)만 그린다.
  const cells = page.getByTestId("job-review-organizer-cell-select");
  const rendered = await eventually(async () => {
    const count = await cells.count();
    return count > 0 ? count : 0;
  });
  report("windowed", rendered > 0 && rendered < total, `${rendered}/${total}`);

  // 끝까지 내려도 셀 수는 그대로 상한 안이고 마지막 문서 머리가 보인다.
  const viewport = page.getByTestId("job-review-organizer-viewport");
  await viewport.evaluate(element => {
    element.scrollTop = element.scrollHeight;
  });
  const last = documents.at(-1);
  const lastHeader = page.locator(
    `${byTestId("job-review-organizer-header")}[data-document-id="${last.document_id}"]`,
  );
  const lastVisible = await eventually(
    async () => (await lastHeader.count()) === 1,
  );
  report(
    "scroll-end-still-windowed",
    lastVisible && (await cells.count()) < total,
    `마지막 머리 ${await lastHeader.count()}, 셀 ${await cells.count()}/${total}`,
  );

  // 셀을 누르면 뷰어가 그 문서·페이지로 간다(마크 source=organizer, 주소창 doc·page).
  await clearSelectPageMarks(page);
  await page
    .locator(
      `${byTestId("job-review-organizer")} [role="presentation"][data-document-id="${last.document_id}"] ${byTestId("job-review-organizer-cell-select")}`,
    )
    .first()
    .click();
  const landed = await eventually(() => {
    const selection = urlSelection(page);
    return selection.doc === last.document_id && selection.page === "1";
  }, URL_SYNC_MS + 1500);
  const marks = await selectPageMarks(page);
  report(
    "click-selects-page",
    landed && marks.includes("1/organizer"),
    `url ${JSON.stringify(urlSelection(page))}, marks ${marks.join(" → ")}`,
  );

  // S → M 으로 셀이 커지고(열 수가 줄고) 다시 S 로 돌아온다.
  const cellWidth = () =>
    cells.first().evaluate(element => element.getBoundingClientRect().width);
  const sizeM = page.getByTestId("job-review-organizer-size-m");
  const sizeS = page.getByTestId("job-review-organizer-size-s");
  await sizeM.click();
  const grewM = await eventually(async () => (await cellWidth()) >= 100);
  const storedM = await page.evaluate(() =>
    window.localStorage.getItem("review-organizer-size"),
  );
  await sizeS.click();
  const backS = await eventually(async () => (await cellWidth()) < 100);
  report(
    "size-m",
    grewM &&
      storedM === "m" &&
      backS &&
      (await sizeS.getAttribute("aria-pressed")) === "true",
    `M 폭 ${grewM}, 기억 ${storedM}, S 복귀 ${backS}`,
  );

  // ── 조작: 셀 메뉴·메뉴 제외/복귀·합성 DnD·머리 메뉴·라벨 ─────────────────
  // 끝 가까이의 3 쪽 이상 문서(뒤 문서 있음)를 고른다. 끝까지 내리면 그 문서의 셀·뒤 문서 머리·제외
  // 칸 머리가 한 창에 그려진다(합성 DnD 는 출발·도착 요소가 둘 다 DOM 에 있어야 한다).
  const at = documents.findLastIndex(
    (doc, i) => i + 1 < documents.length && doc.pages >= 3,
  );
  const subject = documents[at];
  const after = documents[at + 1];
  const groupOf = doc => doc.group ?? "single";
  /** 되돌리기 하위 메뉴는 같은 파일 그룹 문서만 배치 순으로 보인다 — 그 안에서 `subject` 의 순번. */
  const restoreAt =
    at < 0
      ? -1
      : documents
          .filter(doc => groupOf(doc) === groupOf(subject))
          .findIndex(doc => doc.document_id === subject.document_id);
  const gridRoot = byTestId("job-review-organizer");
  /** 문서(`null` 이면 제외 칸)의 셀 뿌리(`draggable` 요소). */
  const cellRoots = documentId =>
    page.locator(
      documentId === null
        ? `${gridRoot} [role="presentation"]:not([data-document-id]) [data-page-grid-page][draggable="true"]`
        : `${gridRoot} [role="presentation"][data-document-id="${documentId}"] [data-page-grid-page]`,
    );
  const countOf = documentId => cellRoots(documentId).count();
  const headerOf = documentId =>
    page.locator(
      `${byTestId("job-review-organizer-header")}[data-document-id="${documentId}"]`,
    );
  // 여러 장 선택 헬퍼 — DnD 절과 선택 절이 함께 쓴다.
  const bar = page.getByTestId("job-review-organizer-selection");
  const barCount = page.getByTestId("job-review-organizer-selection-count");
  const pressed = page.locator(
    `${gridRoot} ${byTestId("job-review-organizer-cell-select")}[aria-pressed="true"]`,
  );
  const barGone = () => eventually(async () => (await bar.count()) === 0);
  /** 그려진 문서 셀(문서 순·문서 안 순). 제외 칸 셀은 빠진다. */
  const documentCells = page.locator(
    `${gridRoot} [role="presentation"][data-document-id] ${byTestId("job-review-organizer-cell-select")}`,
  );
  const cellOf = (documentId, nth) =>
    cellRoots(documentId)
      .nth(nth)
      .getByTestId("job-review-organizer-cell-select");
  // 스크롤 이벤트로 창(그릴 행)이 다시 계산될 때까지 두 프레임 기다린다 — 바로 세면 직전 위치의
  // 행이 남아 첫 행이 빠진 채로 셀 수 조건을 통과할 수 있다.
  const toTop = async () => {
    await viewport.evaluate(
      element =>
        new Promise(resolve => {
          element.scrollTop = 0;
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }),
    );
    await eventually(async () => (await documentCells.count()) > 8);
  };
  const toggleClick = locator =>
    locator.click({ modifiers: ["ControlOrMeta"] });
  const changeCount = async () => {
    const badge = page.getByTestId("job-review-change-count");
    if ((await badge.count()) === 0) return 0;
    return Number.parseInt((await badge.textContent()) ?? "0", 10) || 0;
  };
  /** 격자 바닥 상태 줄(끄는 장 수·드롭 거부 사유). */
  const dropStatus = page.getByTestId("job-review-organizer-drop-rejected");
  const statusText = async () =>
    ((await dropStatus.textContent()) ?? "").trim();
  /** 문서의 그려진 셀 키(문서 안 순). */
  const keysOf = documentId =>
    cellRoots(documentId).evaluateAll(elements =>
      elements.map(element => element.dataset.pageGridPage),
    );
  const menuItems = page.locator(
    '[role="menuitem"][data-testid^="job-review-organizer-cell-menu-"]',
  );
  const restoreTargets = page.getByTestId(
    "job-review-organizer-cell-menu-restore-select",
  );
  const menuClosed = () =>
    eventually(async () => (await menuItems.count()) === 0, 2000);
  /**
   * 제외 칸의 `key` 페이지 셀 메뉴 "문서로 되돌리기 ▸" 에서 `subject`(같은 그룹 문서는 배치 순) 를
   * 고른다. 하위 항목은 포인터를 옮기면 Radix 하위 메뉴가 닫히므로 click 이벤트를 바로 보낸다.
   * 실패하면 이유를 돌려준다(시나리오를 중단하지 않는다).
   */
  const restoreToSubject = async key => {
    try {
      await page
        .locator(
          `${gridRoot} [role="presentation"]:not([data-document-id]) [data-page-grid-page="${key}"]`,
        )
        .getByTestId("job-review-organizer-cell-menu-open")
        .click();
      await page.getByTestId("job-review-organizer-cell-menu-restore").click();
      await eventually(
        async () => (await restoreTargets.count()) > restoreAt,
        2000,
      );
      await restoreTargets.nth(restoreAt).dispatchEvent("click");
      await menuClosed();
      return null;
    } catch (error) {
      await page.keyboard.press("Escape").catch(() => {});
      return String(error?.message ?? error).split("\n")[0];
    }
  };
  const toBottom = () =>
    viewport.evaluate(element => {
      element.scrollTop = element.scrollHeight;
    });
  /** 끝까지 내린 뒤 조금씩 올려 `subject` 의 셀이 그려질 때까지. */
  const revealSubject = async () => {
    await toBottom();
    for (let step = 0; step < 40; step += 1) {
      if (
        await eventually(
          async () => (await countOf(subject.document_id)) > 0,
          300,
        )
      ) {
        return true;
      }
      await viewport.evaluate(element => {
        element.scrollTop = Math.max(0, element.scrollTop - 60);
      });
    }
    return false;
  };
  /**
   * `subject` 의 셀 행을 창 맨 위에 둔다. 그러면 그 셀(클릭해도 창이 움직이지 않음)·뒤 문서 머리·
   * 제외 칸 머리가 한 창(위·아래 여유 포함)에 그려진다.
   */
  const subjectToTop = async () => {
    if (!(await revealSubject())) return false;
    const top = await page
      .locator(
        `${gridRoot} [role="presentation"][data-document-id="${subject.document_id}"]`,
      )
      .first()
      .evaluate(element => {
        const scroller = element.closest(
          '[data-testid="job-review-organizer-viewport"]',
        );
        return (
          element.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top +
          scroller.scrollTop
        );
      });
    await viewport.evaluate((element, value) => {
      element.scrollTop = Math.max(0, value - 8);
    }, top);
    return eventually(async () => (await countOf(subject.document_id)) > 0);
  };

  if (at < 0 || !(await subjectToTop())) {
    report(
      "cell-menu-five-items",
      false,
      "뒤 문서가 있는 3 쪽 이상 문서를 창에 그리지 못함",
    );
  } else {
    // 문서 셀 ⋯ 메뉴는 앞으로·뒤로·다른 문서로 ▸·이 페이지 앞에서 나누기·제외 다섯.
    await cellRoots(subject.document_id)
      .first()
      .getByTestId("job-review-organizer-cell-menu-open")
      .click();
    await eventually(async () => (await menuItems.count()) > 0, 2000);
    const five = await menuItems.count();
    await page.keyboard.press("Escape");
    await menuClosed();
    report("cell-menu-five-items", five === 5, `${five} 개`);

    // 메뉴 "이 페이지 제외" → 제외 칸 셀 +1(맨 아래) → 그 셀 메뉴 "문서로 되돌리기 ▸ 원래 문서" → 원복.
    await toBottom();
    const excludedBefore = await countOf(null);
    await subjectToTop();
    const firstKey = await cellRoots(subject.document_id)
      .first()
      .getAttribute("data-page-grid-page");
    await cellRoots(subject.document_id)
      .first()
      .getByTestId("job-review-organizer-cell-menu-open")
      .click();
    await page.getByTestId("job-review-organizer-cell-menu-exclude").click();
    await menuClosed();
    const subjectShrank = await eventually(
      async () => (await countOf(subject.document_id)) === subject.pages - 1,
    );
    await toBottom();
    const excludedGrew = await eventually(
      async () => (await countOf(null)) === excludedBefore + 1,
    );
    const restoreError = await restoreToSubject(firstKey);
    const excludedBack = await eventually(
      async () => (await countOf(null)) === excludedBefore,
    );
    await subjectToTop();
    const subjectBack = await eventually(
      async () => (await countOf(subject.document_id)) === subject.pages,
    );
    report(
      "menu-exclude-then-restore",
      subjectShrank &&
        excludedGrew &&
        restoreError === null &&
        excludedBack &&
        subjectBack,
      `제외 뒤 ${subjectShrank}/${excludedGrew}, 복귀 ${restoreError ?? "ok"}, ${subject.document_id} ${await countOf(subject.document_id)}/${subject.pages}, 제외 칸 ${excludedBack}`,
    );

    // 아직 온전한 `subject`(3 쪽 이상이라 두 장을 빼도 문서가 남는다)에서 두 장을 ⌘/Ctrl+클릭으로
    // 고르고 그중 하나를 제외 칸 머리에 끌면 둘 다 제외된다(원본 문서 하나라 변경 +1). 끄는 동안 바닥
    // 줄에 장 수가 보이고, 놓으면 선택이 빈다. 두 장은 셀 메뉴로 되돌린다.
    await subjectToTop();
    const pairKeys = (await keysOf(subject.document_id)).slice(0, 2);
    const changesBeforePair = await changeCount();
    await toggleClick(cellOf(subject.document_id, 0));
    await toggleClick(cellOf(subject.document_id, 1));
    const pairPicked = await eventually(
      async () =>
        (await bar.count()) === 1 &&
        ((await barCount.textContent()) ?? "").includes("2"),
    );
    let pairStatus = "";
    await syntheticDrag(
      page,
      cellRoots(subject.document_id).first(),
      page.getByTestId("job-review-organizer-excluded"),
      async () => {
        pairStatus = await statusText();
      },
    );
    const pairExcluded = await eventually(
      async () => (await countOf(subject.document_id)) === subject.pages - 2,
    );
    const pairBarGone = await barGone();
    const pairChanges = await eventually(
      async () => (await changeCount()) === changesBeforePair + 1,
    );
    await toBottom();
    const pairInExcluded = await eventually(
      async () => (await countOf(null)) === excludedBefore + 2,
    );
    const pairRestoreErrors = [];
    for (const key of pairKeys) {
      await toBottom();
      const error = await restoreToSubject(key);
      if (error !== null) pairRestoreErrors.push(error);
    }
    const pairExcludedBack = await eventually(
      async () => (await countOf(null)) === excludedBefore,
    );
    await subjectToTop();
    const pairSubjectBack = await eventually(
      async () => (await countOf(subject.document_id)) === subject.pages,
    );
    report(
      "multi-drag-to-excluded",
      pairPicked &&
        pairStatus.includes("2") &&
        pairExcluded &&
        pairBarGone &&
        pairChanges &&
        pairInExcluded &&
        pairRestoreErrors.length === 0 &&
        pairExcludedBack &&
        pairSubjectBack,
      `2 장 ${pairPicked}, 끄는 중 "${pairStatus}", ${subject.document_id} 제외 뒤 ${pairExcluded}, 바 사라짐 ${pairBarGone}, 변경 ${changesBeforePair} → ${await changeCount()}, 제외 칸 +2 ${pairInExcluded}, 복귀 ${pairRestoreErrors.join(" / ") || "ok"} ${pairExcludedBack}/${pairSubjectBack}`,
    );

    // 둘째 셀을 뒤 문서 머리 행에 놓으면 그 문서 끝으로 간다.
    const afterBefore = await countOf(after.document_id);
    await syntheticDrag(
      page,
      cellRoots(subject.document_id).nth(1),
      headerOf(after.document_id),
    );
    const movedByDrop = await eventually(
      async () =>
        (await countOf(subject.document_id)) === subject.pages - 1 &&
        (await countOf(after.document_id)) === afterBefore + 1,
    );
    report(
      "dnd-page-to-next-document",
      movedByDrop,
      `${subject.document_id} ${await countOf(subject.document_id)}/${subject.pages - 1}, ${after.document_id} ${await countOf(after.document_id)}/${afterBefore + 1}`,
    );

    // 첫 셀을 제외 칸 머리에 놓으면 제외되고, 그 셀 메뉴로 원래 문서에 되돌린다.
    await subjectToTop();
    const droppedKey = await cellRoots(subject.document_id)
      .first()
      .getAttribute("data-page-grid-page");
    await syntheticDrag(
      page,
      cellRoots(subject.document_id).first(),
      page.getByTestId("job-review-organizer-excluded"),
    );
    const subjectShrank2 = await eventually(
      async () => (await countOf(subject.document_id)) === subject.pages - 2,
    );
    await toBottom();
    const excludedGrew2 = await eventually(
      async () => (await countOf(null)) === excludedBefore + 1,
    );
    const restoreError2 = await restoreToSubject(droppedKey);
    const excludedBack2 = await eventually(
      async () => (await countOf(null)) === excludedBefore,
    );
    await subjectToTop();
    const subjectBack2 = await eventually(
      async () => (await countOf(subject.document_id)) === subject.pages - 1,
    );
    report(
      "dnd-page-to-excluded",
      subjectShrank2 &&
        excludedGrew2 &&
        restoreError2 === null &&
        excludedBack2 &&
        subjectBack2,
      `제외 뒤 ${subjectShrank2}/${excludedGrew2}, 복귀 ${restoreError2 ?? "ok"}, ${subject.document_id} ${await countOf(subject.document_id)}/${subject.pages - 1}, 제외 칸 ${excludedBack2}`,
    );
    await toBottom();
  }

  // 머리 메뉴 "위치 지정…" 은 같은 파일 그룹 블록(단일 그룹 mock 은 1–문서 수) 안의 번호만 받는다.
  // 그룹이 여럿이면 블록 번호 표기가 데이터마다 달라 범위 문구는 보지 않는다.
  await lastHeader.getByTestId("job-review-organizer-header-menu-open").click();
  await page.getByTestId("job-review-organizer-header-menu-position").click();
  const dialog = page.getByTestId("job-review-document-position-dialog");
  await dialog.waitFor();
  const dialogText = (await dialog.textContent()) ?? "";
  const groupSize =
    new Set(documents.map(doc => doc.group ?? "single")).size === 1
      ? documents.length
      : null;
  report(
    "header-position-dialog-range",
    groupSize === null || dialogText.includes(`1–${groupSize}`),
    `설명 "${dialogText.slice(0, 120)}"`,
  );
  await page
    .getByTestId("job-review-document-position-dialog-button-cancel")
    .click();
  await dialog.waitFor({ state: "hidden" });

  // 머리 라벨 select 를 다른 값으로 바꾸면 변경 사항이 하나 는다.
  const changesBefore = await changeCount();
  const labelSelect = lastHeader.getByTestId(
    "job-review-organizer-label-select",
  );
  const currentLabel = await labelSelect.inputValue();
  const otherLabel = (
    await labelSelect.evaluate(select =>
      [...select.options].map(option => option.value),
    )
  ).find(value => value !== currentLabel && value !== "\u0000");
  await labelSelect.selectOption(otherLabel);
  report(
    "label-select-changes",
    (await eventually(
      async () => (await labelSelect.inputValue()) === otherLabel,
    )) &&
      (await eventually(
        async () => (await changeCount()) === changesBefore + 1,
      )),
    `라벨 ${currentLabel} → ${otherLabel}, 변경 ${changesBefore} → ${await changeCount()}`,
  );

  // ── 여러 장 선택: Shift 범위·일괄 제외·문서를 넘는 ⌘/Ctrl 토글 → 새 문서로·옮기기…·Esc ──────

  // 셀 하나를 누르고 두 칸 뒤를 Shift+클릭하면(첫 문서 끝 → 둘째 문서 첫 장, 문서 경계를 넘는다) 3 장.
  await toTop();
  const firstPages = documents[0].pages;
  const rangeFrom = Math.max(firstPages - 2, 0);
  await documentCells.nth(rangeFrom).click();
  await documentCells.nth(rangeFrom + 2).click({ modifiers: ["Shift"] });
  const rangeOk = await eventually(
    async () =>
      (await bar.count()) === 1 &&
      ((await barCount.textContent()) ?? "").includes("3") &&
      (await pressed.count()) === 3,
  );
  report(
    "shift-range-selects",
    rangeOk,
    `바 "${(await barCount.textContent().catch(() => "")) ?? ""}", 눌림 ${await pressed.count()}`,
  );

  // 일괄 바 "제외" → 제외 칸 셀 +3, 선택이 비어 바가 사라진다.
  await toBottom();
  const excludedBeforeBatch = await countOf(null);
  const changesBeforeBatch = await changeCount();
  await page
    .getByTestId("job-review-organizer-selection-button-exclude")
    .click();
  const batchBarGone = await barGone();
  await toBottom();
  const excludedAfterBatch = await eventually(
    async () => (await countOf(null)) === excludedBeforeBatch + 3,
  );
  report(
    "batch-exclude",
    batchBarGone && excludedAfterBatch,
    `바 사라짐 ${batchBarGone}, 제외 칸 ${excludedBeforeBatch} → ${await countOf(null)}`,
  );

  // 일괄 제외(문서 2 개 → 변경 +2)는 트레이에서 한 줄이고, 그 줄을 되돌리면 두 항목이 함께 빠진다.
  // 그 전 항목은 모두 개별 항목이라 트레이 줄 수 = 제외 전 변경 개수 + 1.
  const batchChanges = await eventually(
    async () => (await changeCount()) === changesBeforeBatch + 2,
  );
  await page.getByTestId("job-review-tray-button-open").click();
  const tray = page.getByTestId("job-review-tray");
  await tray.waitFor();
  const trayItems = tray.getByTestId("job-review-tray-body-item");
  const trayGrouped = await eventually(
    async () => (await trayItems.count()) === changesBeforeBatch + 1,
  );
  const trayCount = await trayItems.count();
  const batchItem = trayItems.filter({
    hasText:
      /문서 \d+개의 \d+장 제외|Excluded .+ from \d+ documents|\d+ 件のドキュメントの \d+ ページを除外/,
  });
  const batchItemFound = (await batchItem.count()) === 1;
  if (batchItemFound) {
    await batchItem.getByTestId("job-review-tray-body-button-revert").click();
  }
  const batchReverted =
    batchItemFound &&
    (await eventually(
      async () => (await changeCount()) === changesBeforeBatch,
    ));
  await page.getByTestId("job-review-tray-button-close").click();
  await tray.waitFor({ state: "hidden" }).catch(() => {});
  await toBottom();
  const excludedRestored = await eventually(
    async () => (await countOf(null)) === excludedBeforeBatch,
  );
  report(
    "batch-tray-grouped",
    batchChanges &&
      trayGrouped &&
      batchItemFound &&
      batchReverted &&
      excludedRestored,
    `변경 ${changesBeforeBatch} → +2 ${batchChanges}, 트레이 줄 ${trayCount}/${changesBeforeBatch + 1}, 묶음 줄 ${batchItemFound}, 되돌린 뒤 변경 ${await changeCount()}, 제외 칸 ${await countOf(null)}/${excludedBeforeBatch}`,
  );

  // 두 문서의 첫 장을 ⌘/Ctrl+클릭으로 고르고 "새 문서로" → 변경 +2, 뷰어가 새 문서 1 쪽.
  await toTop();
  const knownIds = new Set(documents.map(doc => doc.document_id));
  const [docA, docB] = documents;
  const changesBeforeNew = await changeCount();
  await toggleClick(cellOf(docA.document_id, 0));
  await toggleClick(cellOf(docB.document_id, 0));
  const twoPicked = await eventually(
    async () =>
      (await bar.count()) === 1 &&
      ((await barCount.textContent()) ?? "").includes("2"),
  );
  await page
    .getByTestId("job-review-organizer-selection-button-new-document")
    .click();
  // "새 문서로 분리…" 는 새 문서를 미리 고른 대화 상자를 연다 — 라벨 필드만 확인하고 그대로 옮긴다.
  const splitDialog = page.getByTestId("job-review-move-pages-dialog");
  await splitDialog.waitFor();
  const labelFieldShown =
    (await splitDialog
      .getByTestId("job-review-move-pages-dialog-label-select")
      .count()) +
      (await splitDialog
        .getByTestId("job-review-move-pages-dialog-label-input")
        .count()) ===
    1;
  await splitDialog
    .getByTestId("job-review-move-pages-dialog-button-move")
    .click();
  await splitDialog.waitFor({ state: "hidden" }).catch(() => {});
  const newDocumentSelected = await eventually(() => {
    const selection = urlSelection(page);
    return (
      selection.doc !== undefined &&
      selection.doc !== null &&
      !knownIds.has(selection.doc) &&
      selection.page === "1"
    );
  }, URL_SYNC_MS + 1500);
  const newDocumentChanges = await eventually(
    async () => (await changeCount()) === changesBeforeNew + 2,
  );
  report(
    "toggle-across-documents-new-document",
    twoPicked &&
      labelFieldShown &&
      newDocumentSelected &&
      newDocumentChanges &&
      (await barGone()),
    `2 장 ${twoPicked}, 라벨 필드 ${labelFieldShown}, url ${JSON.stringify(urlSelection(page))}, 변경 ${changesBeforeNew} → ${await changeCount()}`,
  );

  // 셋째 원래 문서에서 2 장(클릭 + Shift+클릭) → "다른 문서로 옮기기…" 대화상자는 범위 입력 대신 요약을
  // 보이고, 첫 대상(첫 문서) 끝으로 옮기면 그 문서 셀이 +2.
  await toTop();
  const docC = documents[2];
  const targetBefore = await countOf(docA.document_id);
  await cellOf(docC.document_id, 0).click();
  await cellOf(docC.document_id, 1).click({ modifiers: ["Shift"] });
  await page.getByTestId("job-review-organizer-selection-button-move").click();
  const moveDialog = page.getByTestId("job-review-move-pages-dialog");
  await moveDialog.waitFor();
  const noRangeInput =
    (await moveDialog
      .getByTestId("job-review-move-pages-dialog-input-from")
      .count()) === 0;
  const summaryText =
    (await moveDialog
      .getByTestId("job-review-move-pages-dialog-summary")
      .textContent()
      .catch(() => null)) ?? "";
  await moveDialog
    .getByTestId("job-review-move-pages-dialog-radio-end")
    .check();
  await moveDialog
    .getByTestId("job-review-move-pages-dialog-button-move")
    .click();
  await moveDialog.waitFor({ state: "hidden" }).catch(() => {});
  await toTop();
  const movedToTarget = await eventually(
    async () => (await countOf(docA.document_id)) === targetBefore + 2,
  );
  report(
    "batch-move-dialog",
    noRangeInput && summaryText.length > 0 && movedToTarget,
    `범위 입력 없음 ${noRangeInput}, 요약 "${summaryText}", ${docA.document_id} ${targetBefore} → ${await countOf(docA.document_id)}`,
  );

  // 셋째 문서에서 2 장(클릭 + Shift+클릭)을 고르고 첫 장을 둘째 문서 머리에 끌면 두 장이 함께 그 문서
  // 끝으로 간다(원본 하나라 변경 +1). 놓으면 선택이 비고 뷰어는 대상 문서(모인 첫 페이지)로 간다.
  await toTop();
  const docBHeader = headerOf(docB.document_id);
  const docBBefore = await countOf(docB.document_id);
  const docCBefore = await countOf(docC.document_id);
  const changesBeforeMulti = await changeCount();
  await cellOf(docC.document_id, 0).click();
  await cellOf(docC.document_id, 1).click({ modifiers: ["Shift"] });
  const multiPicked = await eventually(
    async () =>
      (await bar.count()) === 1 &&
      ((await barCount.textContent()) ?? "").includes("2"),
  );
  let movingText = "";
  if ((await docBHeader.count()) === 1) {
    await syntheticDrag(
      page,
      cellRoots(docC.document_id).first(),
      docBHeader,
      async () => {
        movingText = await statusText();
      },
    );
  }
  const multiMoved = await eventually(
    async () =>
      (await countOf(docB.document_id)) === docBBefore + 2 &&
      (await countOf(docC.document_id)) === docCBefore - 2,
  );
  const multiChanges = await eventually(
    async () => (await changeCount()) === changesBeforeMulti + 1,
  );
  const multiViewer = await eventually(
    () => urlSelection(page).doc === docB.document_id,
    URL_SYNC_MS + 1500,
  );
  report(
    "multi-drag-to-document",
    multiPicked &&
      movingText.includes("2") &&
      multiMoved &&
      multiChanges &&
      multiViewer &&
      (await barGone()),
    `2 장 ${multiPicked}, 끄는 중 "${movingText}", ${docB.document_id} ${docBBefore} → ${await countOf(docB.document_id)}, ${docC.document_id} ${docCBefore} → ${await countOf(docC.document_id)}, 변경 ${changesBeforeMulti} → ${await changeCount()}, url ${JSON.stringify(urlSelection(page))}`,
  );

  // 같은 문서의 둘째·넷째 장을 고르고 둘째 장을 첫 장 자리에 끌면 두 장이 문서 순서대로 맨 앞에 모인다.
  await toTop();
  let docG = null;
  for (const doc of documents.slice(0, 3)) {
    if ((await countOf(doc.document_id)) >= 4) {
      docG = doc;
      break;
    }
  }
  if (docG === null) {
    skip("multi-drag-gather", "앞 3 문서에 4 쪽 이상 문서가 없음");
    skip("multi-drag-unchanged-ignored", "앞 3 문서에 4 쪽 이상 문서가 없음");
  } else {
    const gatherId = docG.document_id;
    const keysBefore = await keysOf(gatherId);
    const changesBeforeGather = await changeCount();
    await toggleClick(cellOf(gatherId, 1));
    await toggleClick(cellOf(gatherId, 3));
    const gatherPicked = await eventually(
      async () =>
        (await bar.count()) === 1 &&
        ((await barCount.textContent()) ?? "").includes("2"),
    );
    await syntheticDrag(
      page,
      cellRoots(gatherId).nth(1),
      cellRoots(gatherId).first(),
    );
    const [k0, k1, k2, k3, ...rest] = keysBefore;
    const expected = [k1, k3, k0, k2, ...rest].join(",");
    const gathered = await eventually(
      async () => (await keysOf(gatherId)).join(",") === expected,
    );
    const gatherChanges = await eventually(
      async () => (await changeCount()) === changesBeforeGather + 1,
    );
    report(
      "multi-drag-gather",
      gatherPicked && gathered && gatherChanges && (await barGone()),
      `2 장 ${gatherPicked}, 순서 ${(await keysOf(gatherId)).slice(0, 4).join(",")} (기대 ${[k1, k3, k0, k2].join(",")}), 변경 ${changesBeforeGather} → ${await changeCount()}`,
    );

    // 이제 맨 앞 두 장을 고르고 첫 장을 제자리(첫 장 위)에 끌면 자리가 그대로라 안내 없이 무시하고
    // (상태 줄은 거부 문구 없이 끄는 장 수 그대로), 놓아도 순서·변경이 그대로이며 선택도 남는다.
    await toTop();
    const keysBeforeSame = await keysOf(gatherId);
    const changesBeforeSame = await changeCount();
    await toggleClick(cellOf(gatherId, 0));
    await toggleClick(cellOf(gatherId, 1));
    const samePicked = await eventually(
      async () =>
        (await bar.count()) === 1 &&
        ((await barCount.textContent()) ?? "").includes("2"),
    );
    let sameStatus = "";
    let sameDestructive = false;
    await syntheticDrag(
      page,
      cellRoots(gatherId).first(),
      cellRoots(gatherId).first(),
      async () => {
        sameStatus = await statusText();
        sameDestructive = (
          (await dropStatus.getAttribute("class")) ?? ""
        ).includes("text-destructive");
      },
    );
    await sleep(200);
    const sameKept =
      (await keysOf(gatherId)).join(",") === keysBeforeSame.join(",") &&
      (await changeCount()) === changesBeforeSame;
    const sameBarKept =
      (await bar.count()) === 1 &&
      ((await barCount.textContent()) ?? "").includes("2");
    report(
      "multi-drag-unchanged-ignored",
      samePicked &&
        !sameDestructive &&
        (sameStatus === "" ||
          sameStatus === movingText ||
          sameStatus.includes("2")) &&
        sameKept &&
        sameBarKept,
      `2 장 ${samePicked}, 상태 줄 "${sameStatus}"(거부 표시 ${sameDestructive}), 순서·변경 그대로 ${sameKept}, 바 남음 ${sameBarKept}`,
    );
    await page.keyboard.press("Escape");
    await barGone();
  }

  // 고른 뒤 격자 안 포커스에서 Esc → 선택이 비어 바가 사라진다.
  await toTop();
  await cellOf(docC.document_id, 0).click();
  await toggleClick(cellOf(docC.document_id, 1));
  const barShown = await eventually(async () => (await bar.count()) === 1);
  await page.keyboard.press("Escape");
  report("escape-clears", barShown && (await barGone()), `바 표시 ${barShown}`);

  // 선택이 없을 때도 바 자리에 힌트 줄이 있어, 셀을 고르거나 비워도 격자의 셀이 위아래로 밀리지 않는다.
  await toTop();
  const barEmpty = page.getByTestId("job-review-organizer-selection-empty");
  const stableCell = documentCells.first();
  const cellY = async () => (await stableCell.boundingBox())?.y ?? null;
  const emptyBefore = await eventually(
    async () => (await barEmpty.count()) === 1,
  );
  const yBefore = await cellY();
  await toggleClick(stableCell);
  const barUp = await eventually(async () => (await bar.count()) === 1);
  const yPicked = await cellY();
  await page.keyboard.press("Escape");
  const emptyAfter =
    (await barGone()) &&
    (await eventually(async () => (await barEmpty.count()) === 1));
  const yCleared = await cellY();
  report(
    "selection-bar-stable",
    emptyBefore &&
      barUp &&
      emptyAfter &&
      yBefore !== null &&
      yPicked === yBefore &&
      yCleared === yBefore,
    `힌트 ${emptyBefore}/${emptyAfter}, 바 ${barUp}, 셀 y ${yBefore} → ${yPicked} → ${yCleared}`,
  );

  // 셀 사이 ✂: 문서 첫 셀에는 없고 둘째 셀부터 왼쪽 틈에 있다. ✂ 에서 누른 채 끌어도 셀 끌기가
  // 시작되지 않고, 누르면 그 쪽 앞에서 나뉘어(그 문서는 첫 쪽만 남고 바로 뒤에 새 문서 머리) 변경 +1,
  // 선택(눌린 셀)은 그대로다. 트레이에서 그 나누기를 되돌려 뒤 그룹 확인에 영향을 주지 않는다.
  await toTop();
  const splitOf = (documentId, nth) =>
    cellRoots(documentId)
      .nth(nth)
      .getByTestId("job-review-organizer-cell-split");
  const headerIds = () =>
    page
      .locator(byTestId("job-review-organizer-header"))
      .evaluateAll(elements =>
        elements.map(element => element.dataset.documentId),
      );
  let splitDoc = null;
  for (const id of await headerIds()) {
    if ((await countOf(id)) >= 3 && (await splitOf(id, 1).count()) === 1) {
      splitDoc = id;
      break;
    }
  }
  if (splitDoc === null) {
    skip("cell-split-placement", "위쪽에 ✂ 가 있는 3 쪽 이상 문서가 없음");
    skip("cell-split-no-drag", "위쪽에 ✂ 가 있는 3 쪽 이상 문서가 없음");
    skip("cell-split", "위쪽에 ✂ 가 있는 3 쪽 이상 문서가 없음");
    skip("cell-split-reverted", "위쪽에 ✂ 가 있는 3 쪽 이상 문서가 없음");
  } else {
    const firstHasNone = (await splitOf(splitDoc, 0).count()) === 0;
    const splitButton = splitOf(splitDoc, 1);
    const splitLabel = (await splitButton.getAttribute("aria-label")) ?? "";
    const splitTab = await splitButton.getAttribute("tabindex");
    report(
      "cell-split-placement",
      firstHasNone &&
        (await splitOf(splitDoc, 2).count()) === 1 &&
        splitLabel.length > 0 &&
        splitTab === "-1",
      `첫 셀 없음 ${firstHasNone}, 라벨 "${splitLabel}", tabindex ${splitTab}`,
    );

    // ✂ 위에서 누른 채 끌면(실제 마우스) 셀 끌기가 시작되지 않는다 — 끄는 중이면 ✂ 가 숨는다.
    const keysBeforeSplit = await keysOf(splitDoc);
    const changesBeforeSplit = await changeCount();
    const box = await splitButton.boundingBox();
    let splitsWhileDragging = -1;
    if (box !== null) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + 80, box.y + 40, { steps: 8 });
      await sleep(150);
      splitsWhileDragging = await page
        .locator(byTestId("job-review-organizer-cell-split"))
        .count();
      await page.mouse.up();
      await sleep(200);
    }
    report(
      "cell-split-no-drag",
      splitsWhileDragging > 0 &&
        (await statusText()) === "" &&
        (await keysOf(splitDoc)).join(",") === keysBeforeSplit.join(",") &&
        (await changeCount()) === changesBeforeSplit,
      `끄는 중 ✂ ${splitsWhileDragging}, 상태 줄 "${await statusText()}", 순서 그대로 ${(await keysOf(splitDoc)).join(",") === keysBeforeSplit.join(",")}, 변경 ${changesBeforeSplit} → ${await changeCount()}`,
    );

    const splitItems = () =>
      page
        .getByTestId("job-review-tray")
        .getByTestId("job-review-tray-body-item")
        .filter({
          hasText: /쪽 뒤에서 분리|Split .+ after page|\d+ ページの後で分割/,
        });
    /** 트레이를 열어 나누기 줄 문구를 읽고 닫는다. */
    const splitItemTexts = async () => {
      await page.getByTestId("job-review-tray-button-open").click();
      await page.getByTestId("job-review-tray").waitFor();
      const texts = await splitItems().allTextContents();
      await page.getByTestId("job-review-tray-button-close").click();
      await page
        .getByTestId("job-review-tray")
        .waitFor({ state: "hidden" })
        .catch(() => {});
      return texts;
    };
    const splitTextsBefore = await splitItemTexts();
    const idsBefore = new Set(await headerIds());
    const pressedBefore = await pressed.count();
    await splitButton.hover();
    await splitButton.click();
    const splitDone = await eventually(
      async () =>
        (await countOf(splitDoc)) === 1 &&
        (await changeCount()) === changesBeforeSplit + 1,
    );
    const ids = await headerIds();
    const nextId = ids[ids.indexOf(splitDoc) + 1];
    const newHeader = nextId !== undefined && !idsBefore.has(nextId);
    const newKeys = newHeader ? await keysOf(nextId) : [];
    report(
      "cell-split",
      splitDone &&
        newHeader &&
        newKeys[0] === keysBeforeSplit[1] &&
        (await pressed.count()) === pressedBefore &&
        (await bar.count()) === 0,
      `나뉨 ${splitDone}, 새 머리 ${nextId}(${newHeader}), 새 문서 첫 쪽 ${newKeys[0]}/${keysBeforeSplit[1]}, 눌림 ${pressedBefore} → ${await pressed.count()}, 변경 ${changesBeforeSplit} → ${await changeCount()}`,
    );

    // 트레이에서 방금 나누기 줄(나누기 전에 없던 나누기 문구 줄)을 되돌린다 — 트레이는 문서별로
    // 묶여 줄 순서가 시간순이 아니므로 줄 문구로 찾는다.
    const splitTexts = await splitItemTexts();
    const addedAt = splitTexts.findIndex(
      (text, i) =>
        splitTexts.slice(0, i + 1).filter(t => t === text).length >
        splitTextsBefore.filter(t => t === text).length,
    );
    const splitTray = page.getByTestId("job-review-tray");
    await page.getByTestId("job-review-tray-button-open").click();
    await splitTray.waitFor();
    if (addedAt >= 0) {
      await splitItems()
        .nth(addedAt)
        .getByTestId("job-review-tray-body-button-revert")
        .click();
    }
    const splitReverted = await eventually(
      async () =>
        (await changeCount()) === changesBeforeSplit &&
        (await countOf(splitDoc)) === keysBeforeSplit.length,
    );
    await page.getByTestId("job-review-tray-button-close").click();
    await splitTray.waitFor({ state: "hidden" }).catch(() => {});
    report(
      "cell-split-reverted",
      addedAt >= 0 && splitReverted,
      `트레이 줄 ${addedAt}, 변경 ${await changeCount()}/${changesBeforeSplit}, 셀 ${await countOf(splitDoc)}/${keysBeforeSplit.length}`,
    );
  }

  // ── 파일 그룹이 둘 이상인 데이터(--files 3 --groups 2): 그룹 경계·그룹 섞인 선택·다른 그룹 drop 거부 ──
  const GROUP_CHECKS = [
    "group-boundary-separator",
    "mixed-groups-blocks-move",
    "multi-drag-mixed-rejected",
    "cross-group-drop-rejected",
  ];
  const secondAt = documents.findIndex(
    doc => groupOf(doc) !== groupOf(documents[0]),
  );
  if (secondAt < 0) {
    for (const check of GROUP_CHECKS) {
      skip(check, "단일 그룹 — --files 3 --groups 2 데이터가 필요함");
    }
  } else {
    // 둘째 그룹 첫 문서를 열면 격자가 그 행을 드러내 앞 그룹 마지막 문서의 셀도 함께 그려진다.
    const second = documents[secondAt];
    const before = documents[secondAt - 1];
    await openJob(
      ctx,
      { doc: second.document_id, page: "1" },
      "document-classify",
    );
    if ((await grid.count()) === 0) await toggle.click();
    await grid.waitFor();
    const secondHeader = headerOf(second.document_id);
    await eventually(async () => (await secondHeader.count()) === 1);

    // 1. 그룹 경계 표시는 하나이고 둘째 그룹 첫 문서의 머리 행에 있다.
    const separators = page.locator(`${gridRoot} [role="separator"]`);
    const separatorCount = await separators.count();
    const separatorDocument =
      separatorCount === 1
        ? await separators
            .first()
            .evaluate(
              element =>
                element
                  .closest("[data-document-id]")
                  ?.getAttribute("data-document-id") ?? null,
            )
        : null;
    report(
      "group-boundary-separator",
      separatorCount === 1 && separatorDocument === second.document_id,
      `경계 ${separatorCount} 개, 머리 ${separatorDocument}/${second.document_id}`,
    );

    // 2. 앞 그룹 마지막 문서의 끝 장과 둘째 그룹 첫 장을 함께 고르면 옮기기·새 문서로는 막히고
    //    제외만 된다.
    const lastOfBefore = () => cellRoots(before.document_id).last();
    if ((await countOf(before.document_id)) === 0) {
      const rowHeight = await secondHeader.evaluate(
        element => element.getBoundingClientRect().height,
      );
      await viewport.evaluate((element, delta) => {
        element.scrollTop = Math.max(0, element.scrollTop - delta);
      }, rowHeight);
      await eventually(async () => (await countOf(before.document_id)) > 0);
    }
    const mixed = page.getByTestId("job-review-organizer-selection-mixed");
    const barButton = id =>
      page.getByTestId(`job-review-organizer-selection-button-${id}`);
    await toggleClick(
      lastOfBefore().getByTestId("job-review-organizer-cell-select"),
    );
    await toggleClick(cellOf(second.document_id, 0));
    const mixedPicked = await eventually(
      async () =>
        (await bar.count()) === 1 &&
        ((await barCount.textContent()) ?? "").includes("2") &&
        (await mixed.count()) === 1,
    );
    const moveBlocked =
      mixedPicked &&
      (await barButton("move").isDisabled()) &&
      (await barButton("new-document").isDisabled()) &&
      (await barButton("exclude").isEnabled());
    // 그 섞인 선택인 채 앞 그룹 장을 둘째 그룹 문서 머리에 끌면 거부 사유가 보이고, 놓아도 변경·두
    // 문서 셀 수·선택이 그대로다.
    const changesBeforeMixed = await changeCount();
    const beforeCellsMixed = await countOf(before.document_id);
    const secondCellsMixed = await countOf(second.document_id);
    let mixedRejected = "";
    await syntheticDrag(page, lastOfBefore(), secondHeader, async () => {
      mixedRejected = await statusText();
    });
    await sleep(200);
    report(
      "multi-drag-mixed-rejected",
      mixedPicked &&
        mixedRejected.length > 0 &&
        (await changeCount()) === changesBeforeMixed &&
        (await countOf(before.document_id)) === beforeCellsMixed &&
        (await countOf(second.document_id)) === secondCellsMixed &&
        (await bar.count()) === 1 &&
        ((await barCount.textContent()) ?? "").includes("2"),
      `거부 "${mixedRejected}", 변경 ${changesBeforeMixed} → ${await changeCount()}, ${before.document_id} ${beforeCellsMixed} → ${await countOf(before.document_id)}, ${second.document_id} ${secondCellsMixed} → ${await countOf(second.document_id)}, 바 "${(await barCount.textContent().catch(() => "")) ?? ""}"`,
    );
    await page.keyboard.press("Escape");
    const mixedCleared = await barGone();
    report(
      "mixed-groups-blocks-move",
      mixedPicked && moveBlocked && mixedCleared,
      `2 장·안내 ${mixedPicked}, 옮기기·새 문서로 막힘·제외 가능 ${moveBlocked}, Esc ${mixedCleared}`,
    );

    // 3. 앞 그룹 셀을 둘째 그룹 문서 머리에 끌어 올리면 거부 사유가 보이고, 놓아도 변경이 없다.
    const changesBeforeDrop = await changeCount();
    const beforeCells = await countOf(before.document_id);
    const secondCells = await countOf(second.document_id);
    let rejectedText = "";
    await syntheticDrag(page, lastOfBefore(), secondHeader, async () => {
      rejectedText =
        (await page
          .getByTestId("job-review-organizer-drop-rejected")
          .textContent()) ?? "";
    });
    await sleep(200);
    report(
      "cross-group-drop-rejected",
      rejectedText.trim().length > 0 &&
        (await changeCount()) === changesBeforeDrop &&
        (await countOf(before.document_id)) === beforeCells &&
        (await countOf(second.document_id)) === secondCells,
      `거부 "${rejectedText.trim()}", 변경 ${changesBeforeDrop} → ${await changeCount()}, ${before.document_id} ${beforeCells} → ${await countOf(before.document_id)}, ${second.document_id} ${secondCells} → ${await countOf(second.document_id)}`,
    );
  }

  // 셀을 끌어 창 아래 가장자리에 머물면 자동 스크롤로 그 행이 창 밖에 나가도, dragstart 때 잡은 요소가
  // 그대로 DOM 에 남는다(선택자 재조회가 아니라 그 handle 로 본다). 그 요소로 dragend(Esc 취소)가 오면
  // 끌기가 끝나 ✂ 가 다시 보인다. dragend 없이 끝난 끌기도 다음 포인터 이동에서 정리된다.
  await toTop();
  const splitButtons = page.locator(
    byTestId("job-review-organizer-cell-split"),
  );
  const sourceHandle = await documentCells
    .first()
    .evaluateHandle(element => element.closest("[data-page-grid-page]"));
  const offscreenTransfer = await page.evaluateHandle(() => new DataTransfer());
  await sourceHandle.dispatchEvent("dragstart", {
    dataTransfer: offscreenTransfer,
  });
  const splitsHidden = await eventually(
    async () => (await splitButtons.count()) === 0,
  );
  const viewportBox = await viewport.boundingBox();
  const clientHeight = await viewport.evaluate(element => element.clientHeight);
  if (viewportBox !== null) {
    await viewport.dispatchEvent("dragover", {
      dataTransfer: offscreenTransfer,
      clientX: viewportBox.x + viewportBox.width / 2,
      clientY: viewportBox.y + viewportBox.height - 2,
    });
  }
  const scrolledAway = await eventually(
    () =>
      viewport.evaluate(
        (element, height) => element.scrollTop > height * 3,
        clientHeight,
      ),
    8000,
  );
  if (viewportBox !== null) {
    // 가운데로 옮겨 자동 스크롤을 멈춘다(끌기는 계속).
    await viewport.dispatchEvent("dragover", {
      dataTransfer: offscreenTransfer,
      clientX: viewportBox.x + viewportBox.width / 2,
      clientY: viewportBox.y + viewportBox.height / 2,
    });
  }
  await sleep(150);
  const sourceState = await sourceHandle.evaluate((element, box) => {
    const rect = element.getBoundingClientRect();
    return {
      connected: element.isConnected,
      offscreen: box !== null && rect.bottom < box.y,
    };
  }, viewportBox);
  report(
    "drag-source-kept-offscreen",
    splitsHidden &&
      scrolledAway &&
      sourceState.connected &&
      sourceState.offscreen,
    `끄는 중 ✂ 숨김 ${splitsHidden}, 자동 스크롤 ${scrolledAway}, 요소 연결 ${sourceState.connected}, 창 밖 ${sourceState.offscreen}`,
  );
  await sourceHandle.dispatchEvent("dragend", {
    dataTransfer: offscreenTransfer,
  });
  report(
    "drag-end-after-offscreen",
    await eventually(async () => (await splitButtons.count()) > 0),
    `✂ ${await splitButtons.count()}`,
  );
  await offscreenTransfer.dispose();
  await sourceHandle.dispose();

  // dragend 없이 끝난 끌기(끌던 요소가 사라진 경우): 다음 포인터 이동에서 정리되고 다음 끌기가 정상이다.
  const staleTransfer = await page.evaluateHandle(() => new DataTransfer());
  await documentCells
    .first()
    .evaluate(
      (element, dataTransfer) =>
        element
          .closest("[data-page-grid-page]")
          ?.dispatchEvent(
            new DragEvent("dragstart", { bubbles: true, dataTransfer }),
          ),
      staleTransfer,
    );
  const staleHidden = await eventually(
    async () => (await splitButtons.count()) === 0,
  );
  if (viewportBox !== null) {
    await page.mouse.move(
      viewportBox.x + viewportBox.width / 2,
      viewportBox.y + viewportBox.height / 2,
    );
    await page.mouse.move(
      viewportBox.x + viewportBox.width / 2 + 10,
      viewportBox.y + viewportBox.height / 2 + 10,
    );
  }
  const staleCleared = await eventually(
    async () => (await splitButtons.count()) > 0,
  );
  await staleTransfer.dispose();
  report(
    "stale-drag-cleared-by-pointer",
    staleHidden && staleCleared,
    `끄는 중 ✂ 숨김 ${staleHidden}, 포인터 이동 뒤 ✂ ${await splitButtons.count()}`,
  );

  // 뷰어 툴바 토글로 닫으면 구성 작업 패널(라벨, 페이지 범위)과 띠 토글이 돌아온다.
  const panelRestored = () =>
    eventually(
      async () =>
        (await grid.count()) === 0 &&
        (await page
          .locator(byTestId("job-review-structure-label-select"))
          .count()) === 1 &&
        (await page
          .locator(byTestId("job-review-viewer-button-filmstrip"))
          .count()) === 1,
    );
  await toggle.click();
  report(
    "close-restores-panel",
    (await panelRestored()) &&
      (await page.evaluate(() =>
        window.localStorage.getItem("review-organizer"),
      )) === "closed",
  );

  // 정리 화면 머리 줄의 "완료" 로 닫아도 같고, 포커스는 뷰어 툴바의 페이지 정리 토글로 돌아간다.
  await toggle.click();
  await grid.waitFor();
  await page.getByTestId("job-review-organizer-button-done").click();
  const doneRestored = await panelRestored();
  const focusedAfterDone = await page.evaluate(
    () => document.activeElement?.getAttribute("data-testid") ?? null,
  );
  report(
    "done-closes-organizer",
    doneRestored &&
      focusedAfterDone === "job-review-viewer-button-organizer" &&
      (await toggle.getAttribute("aria-expanded")) === "false",
    `패널 ${doneRestored}, 포커스 ${focusedAfterDone}`,
  );

  // 라벨 목록이 없는 설정이면 머리 행 라벨은 자유 입력이다.
  await withoutLabelChoices(page);
  await openJob(ctx, { doc: long.document_id, page: "1" }, "document-classify");
  await toggle.click();
  await grid.waitFor();
  // 창이 움직이면 "첫 머리" 가 다른 문서가 되므로 문서 id 로 고정한다.
  const labelHeader = await page
    .getByTestId("job-review-organizer-header")
    .first()
    .getAttribute("data-document-id");
  await checkLabelInput(
    ctx,
    page
      .locator(
        `${byTestId("job-review-organizer-header")}[data-document-id="${labelHeader}"]`,
      )
      .getByTestId("job-review-organizer-label-input"),
    changeCount,
  );
}

// ── 검수 상태 · 큐 ──────────────────────────────────────────────────────────

const QUEUE_JOBS = 3;
const needsJobs = index =>
  (index.jobs?.length ?? 1) >= QUEUE_JOBS
    ? null
    : `pnpm mock:gen -- --jobs ${QUEUE_JOBS} --pages 12 데이터가 필요함`;
/** `queue` 의 기대값(남은 수·배지·진행 막대·필터 행)은 Job 이 정확히 3 개일 때의 값이다. */
const needsExactQueueJobs = index =>
  (index.jobs?.length ?? 1) === QUEUE_JOBS
    ? null
    : `큐 시나리오는 Job 이 정확히 ${QUEUE_JOBS} 개일 때만 — pnpm mock:gen -- --jobs ${QUEUE_JOBS} --pages 12 데이터가 필요함`;

/** 필터 버튼을 누르고 `aria-pressed` 가 될 때까지 기다린다. */
async function pickReviewFilter(page, value) {
  const button = page.getByTestId(
    `collection-detail-filter-review-status-${value}`,
  );
  await button.click();
  await eventually(
    async () => (await button.getAttribute("aria-pressed")) === "true",
  );
}

/** 표가 다시 그려질 때까지 기다린 뒤 `{ rows, done }`(행 수·done 배지 수). */
async function settledTable(page, predicate, timeoutMs = 5000) {
  const read = async () => {
    const statuses = await tableReviewStatuses(page);
    return {
      rows: await page.getByTestId("job-rows-table-row-open").count(),
      done: statuses.filter(status => status === "done").length,
      inProgress: statuses.filter(status => status === "in_progress").length,
    };
  };
  await eventually(async () => predicate(await read()), timeoutMs);
  return read();
}

/**
 * 상세 요약 카드의 숫자 기준: 기본 보기에서 진행 기준 문구·전체 Job 정보 버튼·"표에 보이는 행" 보조 줄이
 * 보이고, 검수 상태 필터를 걸면 보조 줄이 사라진다(기본 보기에서만 셈).
 */
async function detailCountBasis(ctx) {
  const { page, config, report } = ctx;
  await page.goto(collectionUrl(config), { waitUntil: "domcontentloaded" });
  await page.waitForSelector(byTestId("job-rows-table"));
  const rowsLine = page.getByTestId(
    "collection-detail-stat-latestConfigJobs-rows",
  );
  const shown = await eventually(
    async () =>
      (await page.getByTestId("collection-detail-progress-basis").count()) ===
        1 && (await rowsLine.count()) === 1,
    8000,
  );
  const tableRows = await page.getByTestId("job-rows-table-row-open").count();
  const rowsText = (
    (await rowsLine.textContent().catch(() => "")) ?? ""
  ).trim();
  report(
    "detail-count-basis",
    Boolean(shown) &&
      (await page.getByTestId("collection-detail-stat-totalJobs").count()) ===
        1 &&
      (await page
        .getByTestId("collection-detail-stat-button-info-totalJobs")
        .count()) === 1 &&
      (await page
        .getByTestId("collection-detail-stat-button-info-latestConfigJobs")
        .count()) === 1 &&
      rowsText.includes(String(tableRows)),
    `보조 줄 "${rowsText}" · 표 행 ${tableRows}`,
  );
  await pickReviewFilter(page, "done");
  const hidden = await eventually(async () => (await rowsLine.count()) === 0);
  await pickReviewFilter(page, "all");
  const back = await eventually(async () => (await rowsLine.count()) === 1);
  report(
    "detail-rows-line-default-view-only",
    Boolean(hidden) && Boolean(back),
    `필터 뒤 사라짐 ${Boolean(hidden)} · 전체로 다시 ${Boolean(back)}`,
  );
}

async function reviewStatus(ctx) {
  const { page, config, report } = ctx;
  const jobs = config.index.jobs.length;
  await detailCountBasis(ctx);
  await openCollection(ctx, jobs);

  const rows = await page.getByTestId("job-rows-table-row-open").count();
  const statuses = await tableReviewStatuses(page);
  report(
    "rows-and-badges",
    rows === jobs &&
      statuses.length === jobs &&
      statuses.every(status => status !== null),
    `행 ${rows} · 배지 ${statuses.join(",")}`,
  );
  report(
    "progress-and-order",
    (await page.getByTestId("collection-detail-progress").count()) === 1 &&
      (await page.getByTestId("collection-detail-select-order").count()) === 1,
  );

  const doneBefore = statuses.filter(status => status === "done").length;
  await pickReviewFilter(page, "done");
  const filtered = await settledTable(
    page,
    ({ rows: count, done }) => count === doneBefore && done === doneBefore,
  );
  report(
    "filter-done",
    filtered.rows === doneBefore && filtered.done === doneBefore,
    `done 배지 ${doneBefore} · 거른 행 ${filtered.rows}`,
  );

  await pickReviewFilter(page, "all");
  const all = await settledTable(page, ({ rows: count }) => count === jobs);
  report("filter-all", all.rows === jobs, `행 ${all.rows}`);
}

const queueButton = (page, which) =>
  page.getByTestId(`job-review-queue-button-${which}`);

const isAriaDisabled = async locator =>
  (await locator.getAttribute("aria-disabled")) === "true";

const queueRemaining = async page =>
  (await page.getByTestId("job-review-queue-remaining").textContent())?.match(
    /\d+/,
  )?.[0] ?? null;

/** 주소창이 `jobId` 가 되고 배지가 정해질 때까지 기다린다. */
async function waitJob(page, jobId, timeoutMs = 8000) {
  await eventually(() => urlJobId(page) === jobId, timeoutMs);
  await page.waitForSelector(byTestId("job-review-viewer"));
  return settledReviewStatus(page);
}

/** Job 화면 검수 배지가 `status` 가 될 때까지 기다린다. */
async function waitBadge(page, status, timeoutMs = 5000) {
  return eventually(
    async () => (await reviewBadgeStatus(page)) === status,
    timeoutMs,
  );
}

/** `jobIds` 의 Job 을 차례로 열어 검수 완료면 되돌려 모두 검수 중으로 맞추고, 열었던 순서대로 배지 값을 돌려준다. */
async function normalizeInProgress(ctx, jobIds) {
  const { page } = ctx;
  const normalized = [];
  for (const jobId of jobIds) {
    let status = await openJobById(ctx, jobId);
    if (status === "done") {
      await page.getByTestId("job-review-button-reopen").click();
      status = (await waitBadge(page, "in_progress"))
        ? "in_progress"
        : await reviewBadgeStatus(page);
    }
    normalized.push(status);
  }
  return normalized;
}

/**
 * 큐 바가 공통 상단 바 자리(`app-header-slot`) 밖에 한 번이라도 붙으면 센다(`window.__queueOutsideSlot`).
 * 문서가 열릴 때마다 처음부터 지켜보므로 새로 고침 첫 프레임에 Job 화면 머리 안에 잠깐 그려지는 것도 잡는다.
 */
function watchQueueBarPlacement() {
  window.__queueOutsideSlot = 0;
  const check = () => {
    for (const bar of document.querySelectorAll(
      '[data-testid="job-review-queue"]',
    )) {
      if (!bar.closest('[data-testid="app-header-slot"]')) {
        window.__queueOutsideSlot += 1;
      }
    }
  };
  new MutationObserver(check).observe(document, {
    childList: true,
    subtree: true,
  });
}

/**
 * 큐 바와 완료 안내가 상단 바 자리 안에 있고 Job 화면 머리(`job-review-link-back` 이 든 `<header>`)
 * 안에는 없는지.
 */
const queueInHeaderSlot = page =>
  page.evaluate(() => {
    const slot = document.querySelector('[data-testid="app-header-slot"]');
    const jobHeader = document
      .querySelector('[data-testid="job-review-link-back"]')
      ?.closest("header");
    const placed = testId => {
      const element = document.querySelector(`[data-testid="${testId}"]`);
      return (
        element !== null &&
        slot !== null &&
        slot.contains(element) &&
        !(jobHeader?.contains(element) ?? false)
      );
    };
    return placed("job-review-queue") && placed("job-review-completion-notice");
  });

/**
 * 검수 완료를 누르기 전에 부른다. 검수 배지 `done`, 완료 안내 글자, 주소가 `fromPath` 에서 바뀐 때를
 * 처음 본 시각으로 `window.__completeOrder` 에 남긴다.
 */
const trackCompleteOrder = (page, fromPath) =>
  page.evaluate(path => {
    const seen = {};
    window.__completeOrder = seen;
    const check = () => {
      const at = performance.now();
      if (
        seen.done === undefined &&
        document.querySelector(
          '[data-testid="job-review-badge-review-status"][data-status="done"]',
        )
      ) {
        seen.done = at;
      }
      const notice = document.querySelector(
        '[data-testid="job-review-completion-notice"]',
      );
      if (
        seen.notice === undefined &&
        (notice?.textContent ?? "").trim() !== ""
      ) {
        seen.notice = at;
      }
      if (seen.url === undefined && window.location.pathname !== path) {
        seen.url = at;
      }
    };
    new MutationObserver(check).observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    const timer = setInterval(() => {
      check();
      if (seen.url !== undefined) clearInterval(timer);
    }, 5);
  }, fromPath);

const completionNoticeText = async page =>
  (
    (await page.getByTestId("job-review-completion-notice").textContent()) ?? ""
  ).trim();

async function queue(ctx) {
  try {
    await queueSteps(ctx);
  } finally {
    // 둘째 Job 을 "저장하고 완료" 로 저장했으므로 mock 서버 상태를 되돌린다(실패해도).
    const status = await mockPost(ctx.config, "/__mock/reset");
    ctx.report("mock-reset", status === 204, `${ctx.config.mock} → ${status}`);
  }
}

async function queueSteps(ctx) {
  const { page, context, config, report } = ctx;
  const jobIds = config.index.jobs;
  await context.addInitScript(watchQueueBarPlacement);

  // (1) 시작 상태: 모든 Job 을 검수 중으로 맞춘다(지난 실행의 검수 완료를 되돌림).
  const normalized = await normalizeInProgress(ctx, jobIds);
  report(
    "normalize-in-progress",
    normalized.every(status => status === "in_progress") &&
      (await page.getByTestId("job-review-queue").count()) === 0,
    `배지 ${normalized.join(",")}`,
  );

  // (2) 상세 → 차례로 검수하기 → 표 첫 행의 Job, 큐 바.
  await openCollection(ctx, jobIds.length);
  const order = await page
    .getByTestId("job-rows-table-link-open")
    .evaluateAll(links =>
      links.map(link =>
        decodeURIComponent(
          /\/jobs\/([^/?#]+)/.exec(link.getAttribute("href") ?? "")?.[1] ?? "",
        ),
      ),
    );
  await page.getByTestId("collection-detail-button-start-review").click();
  const firstStatus = await waitJob(page, order[0]);
  await page.waitForSelector(byTestId("job-review-queue"));
  report(
    "start-opens-first-row",
    urlJobId(page) === order[0] &&
      firstStatus === "in_progress" &&
      (await queueRemaining(page)) === String(jobIds.length - 1) &&
      (await isAriaDisabled(queueButton(page, "previous"))),
    `URL ${urlJobId(page)} · 표 ${order.join(",")} · 남은 ${await queueRemaining(page)}`,
  );
  report(
    "bar-in-header-slot",
    (await queueInHeaderSlot(page)) &&
      (await page.evaluate(() => window.__queueOutsideSlot)) === 0,
    `밖 ${await page.evaluate(() => window.__queueOutsideSlot)} 회`,
  );

  // 큐 안의 Job 을 새로 고쳐도 큐 바가 첫 프레임부터 상단 바 자리에만 붙는다.
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitJob(page, order[0]);
  await page.waitForSelector(byTestId("job-review-queue"));
  report(
    "bar-first-frame-in-slot",
    (await page.evaluate(() => window.__queueOutsideSlot)) === 0 &&
      (await queueInHeaderSlot(page)),
    `밖 ${await page.evaluate(() => window.__queueOutsideSlot)} 회`,
  );

  // (3) 완료 후 다음 Job → 둘째. 배지 done → 완료 안내 → 주소 순서, 안내는 다음 Job 에서도 남았다 사라진다.
  const complete = page.getByTestId("job-review-button-complete");
  await eventually(async () => await complete.isEnabled());
  const advanceFirst = await complete.getAttribute("data-advance");
  await trackCompleteOrder(page, new URL(page.url()).pathname);
  await complete.click();
  const secondStatus = await waitJob(page, order[1]);
  report(
    "complete-and-next",
    advanceFirst === "true" &&
      urlJobId(page) === order[1] &&
      secondStatus === "in_progress",
    `data-advance ${advanceFirst} · URL ${urlJobId(page)} · 배지 ${secondStatus}`,
  );
  const completeOrder = await page.evaluate(() => window.__completeOrder);
  report(
    "complete-order",
    completeOrder.done !== undefined &&
      completeOrder.notice !== undefined &&
      completeOrder.url !== undefined &&
      completeOrder.done <= completeOrder.notice &&
      completeOrder.notice <= completeOrder.url,
    JSON.stringify(completeOrder),
  );
  report(
    "notice-survives-navigation",
    (await completionNoticeText(page)) !== "" &&
      (await queueInHeaderSlot(page)),
    `안내 "${await completionNoticeText(page)}"`,
  );
  report(
    "notice-clears",
    Boolean(
      await eventually(
        async () => (await completionNoticeText(page)) === "",
        8000,
      ),
    ),
    `안내 "${await completionNoticeText(page)}"`,
  );

  // (4) 이전 → 첫 Job 은 검수 완료(되돌리기 버튼) → 다음 → 둘째.
  await queueButton(page, "previous").click();
  const backStatus = await waitJob(page, order[0]);
  report(
    "previous-shows-done",
    backStatus === "done" &&
      (await page.getByTestId("job-review-button-reopen").count()) === 1 &&
      (await page.getByTestId("job-review-button-complete").count()) === 0,
    `URL ${urlJobId(page)} · 배지 ${backStatus}`,
  );
  await queueButton(page, "next").click();
  report(
    "next-returns",
    (await waitJob(page, order[1])) === "in_progress" &&
      urlJobId(page) === order[1],
    `URL ${urlJobId(page)}`,
  );

  // (4b) 값을 고친 채 "다음 Job" → 앱 Dialog → 머무르기(같은 Job, 변경 유지) → 다시 "다음 Job" →
  // 나가기(셋째 Job) → 이전 Job 으로 돌아온다(변경 없음이라 묻지 않음).
  await openTab(ctx, "information-extract");
  const field = page
    .locator(`[data-result-id] ${FIELD_INPUT}:not([inputmode="decimal"])`)
    .first();
  await field.waitFor();
  await field.fill(`${await field.inputValue()} smoke-queue-leave`);
  await field.press("Tab");
  await eventually(async () => (await changeCountOf(page)) === 1);
  const leaveDialog = page.getByTestId("leave-confirm-dialog");
  await queueButton(page, "next").click();
  const askedStay = Boolean(
    await eventually(async () => (await leaveDialog.count()) === 1, 5000),
  );
  await page.getByTestId("leave-confirm-button-stay").click();
  await leaveDialog.waitFor({ state: "detached" });
  await sleep(500);
  const stayed =
    urlJobId(page) === order[1] && (await changeCountOf(page)) === 1;
  await queueButton(page, "next").click();
  const askedLeave = Boolean(
    await eventually(async () => (await leaveDialog.count()) === 1, 5000),
  );
  await page.getByTestId("leave-confirm-button-leave").click();
  const leftStatus = await waitJob(page, order[2]);
  report(
    "queue-next-confirm-dialog",
    askedStay &&
      stayed &&
      askedLeave &&
      urlJobId(page) === order[2] &&
      leftStatus === "in_progress",
    `머무르기 ${askedStay}/${stayed} · 나가기 ${askedLeave} · URL ${urlJobId(page)} · 배지 ${leftStatus}`,
  );
  await queueButton(page, "previous").click();
  await waitJob(page, order[1]);
  // 떠난 Job 의 임시 저장 복원 배너가 있으면 버린다(아래 편집이 새 변경 1 건이 되게).
  const discardDraft = page.getByTestId("job-review-draft-button-discard");
  if ((await discardDraft.count()) > 0) await discardDraft.click();

  // (5) 값을 고친 채 ⌘/Ctrl+Enter → 저장하고 완료 → 셋째(마지막): 다음 비활성, 남은 0, 완료만 →
  // "새 Job 확인" → 없음 안내.
  await openTab(ctx, "information-extract");
  await field.waitFor();
  await field.fill(`${await field.inputValue()} smoke-queue`);
  await field.press("Tab");
  await eventually(async () => (await changeCountOf(page)) === 1);
  await page.evaluate(() => document.activeElement?.blur());
  await eventually(async () => await complete.isEnabled());
  const saveFirst = await complete.getAttribute("data-save-first");
  const saveAdvance = await complete.getAttribute("data-advance");
  await page.keyboard.press("ControlOrMeta+Enter");
  await waitJob(page, order[2], 20_000);
  report(
    "save-and-next-shortcut",
    saveFirst === "true" &&
      saveAdvance === "true" &&
      urlJobId(page) === order[2],
    `data-save-first ${saveFirst} · data-advance ${saveAdvance} · URL ${urlJobId(page)}`,
  );
  await eventually(async () => await complete.isEnabled());
  const lastAdvance = await complete.getAttribute("data-advance");
  report(
    "last-job",
    urlJobId(page) === order[2] &&
      (await isAriaDisabled(queueButton(page, "next"))) &&
      (await queueRemaining(page)) === "0" &&
      lastAdvance === "false",
    `URL ${urlJobId(page)} · 남은 ${await queueRemaining(page)} · data-advance ${lastAdvance}`,
  );
  await complete.click();
  report(
    "complete-last",
    (await waitBadge(page, "done")) && urlJobId(page) === order[2],
    `배지 ${await reviewBadgeStatus(page)} · URL ${urlJobId(page)}`,
  );
  await queueButton(page, "refresh").click();
  const notice = page.getByTestId("job-review-queue-notice");
  report(
    "refresh-none-left",
    Boolean(
      await eventually(
        async () =>
          (await notice.isVisible()) &&
          ((await notice.textContent()) ?? "").trim() !== "",
        5000,
      ),
    ) && urlJobId(page) === order[2],
    `안내 "${((await notice.textContent()) ?? "").trim()}"`,
  );

  // (6) 검수 중으로 되돌리기.
  await page.getByTestId("job-review-button-reopen").click();
  report(
    "reopen",
    Boolean(await waitBadge(page, "in_progress")) &&
      (await page.getByTestId("job-review-button-complete").count()) === 1,
    `배지 ${await reviewBadgeStatus(page)}`,
  );

  // (7) 뒤로 → 상세: 검수 완료 2 · 검수 중 1, 진행 막대 2 / 3, 필터 done → 2 행.
  await page.getByTestId("job-review-link-back").click();
  await page.waitForSelector(byTestId("job-rows-table"));
  await showAllConfigs(page);
  const table = await settledTable(
    page,
    ({ rows, done, inProgress }) =>
      rows === jobIds.length && done === 2 && inProgress === 1,
  );
  report(
    "detail-badges",
    table.rows === jobIds.length && table.done === 2 && table.inProgress === 1,
    `행 ${table.rows} · done ${table.done} · in_progress ${table.inProgress}`,
  );
  const bar = page.getByTestId("collection-detail-progress-bar");
  await eventually(
    async () =>
      (await bar.count()) === 1 &&
      (await bar.getAttribute("aria-valuenow")) === "2",
    5000,
  );
  const now = (await bar.count())
    ? await bar.getAttribute("aria-valuenow")
    : null;
  const max = (await bar.count())
    ? await bar.getAttribute("aria-valuemax")
    : null;
  report(
    "progress-bar",
    now === "2" && max === String(jobIds.length),
    `aria-valuenow ${now} · aria-valuemax ${max}`,
  );
  await pickReviewFilter(page, "done");
  const doneRows = await settledTable(
    page,
    ({ rows, done }) => rows === 2 && done === 2,
  );
  report("filter-done-rows", doneRows.rows === 2, `행 ${doneRows.rows}`);
}

// ── shell ─────────────────────────────────────────────────────────────────

/** `action()` 동안(과 그 뒤 `settleMs`) 뜬 브라우저 확인 창 종류를 모으고 모두 취소한다. */
async function dialogsDuring(page, action, settleMs = 500) {
  const seen = [];
  const onDialog = dialog => {
    seen.push(dialog.type());
    void dialog.dismiss().catch(() => {});
  };
  page.on("dialog", onDialog);
  try {
    await action();
    await sleep(settleMs);
  } finally {
    page.off("dialog", onDialog);
  }
  return seen;
}

const LEAVE_DIALOG = byTestId("leave-confirm-dialog");

/**
 * `action()` 동안(과 그 뒤 `settleMs`) 브라우저 확인 창과 앱 이탈 확인 Dialog 가 떴는지 모은다.
 * 브라우저 창은 모두 취소한다. 앱 Dialog 는 `MutationObserver` 로 한 번이라도 그려졌는지 본다(클라이언트
 * 이동이라 `window` 가 유지된다).
 */
async function leavePromptsDuring(page, action, settleMs = 500) {
  await page.evaluate(selector => {
    window.__leaveDialogSeen = document.querySelector(selector) !== null;
    window.__leaveDialogObserver?.disconnect();
    window.__leaveDialogObserver = new MutationObserver(() => {
      if (document.querySelector(selector)) window.__leaveDialogSeen = true;
    });
    window.__leaveDialogObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }, LEAVE_DIALOG);
  const native = await dialogsDuring(page, action, settleMs);
  const app = await page.evaluate(() => {
    window.__leaveDialogObserver?.disconnect();
    return window.__leaveDialogSeen === true;
  });
  return { native, app };
}

/** `body` 가 Radix 모달의 `pointer-events: none` 에서 풀렸는지. */
const bodyInteractive = page =>
  page.evaluate(() => getComputedStyle(document.body).pointerEvents !== "none");

const readLocalStorage = (page, key) =>
  page.evaluate(storageKey => window.localStorage.getItem(storageKey), key);

/** 설정 메뉴를 열어 `testId` 체크 항목을 누르고 메뉴를 닫는다. */
async function toggleSettingsItem(page, testId) {
  await page.getByTestId("app-header-button-settings").click();
  await page.getByTestId(testId).click();
  await page.keyboard.press("Escape");
  await page.getByTestId(testId).waitFor({ state: "detached" });
}

/** 설정 메뉴 "검수할 단계" 의 Step 종류(`review-steps` 저장소 JSON 의 키). */
const REVIEW_STEP_KEYS = [
  "parse",
  "classify",
  "split",
  "extract",
  "validate",
  "match",
  "merge",
  "instruct",
  "export",
];

const writeLocalStorage = (page, key, value) =>
  page.evaluate(
    ([storageKey, storageValue]) => {
      if (storageValue === null) window.localStorage.removeItem(storageKey);
      else window.localStorage.setItem(storageKey, storageValue);
    },
    [key, value],
  );

/** 지금 화면의 Step 탭 testid(그린 순서). */
const stepTabIds = page =>
  page
    .locator('[data-testid^="job-review-step-tab-"]')
    .evaluateAll(tabs => tabs.map(tab => tab.getAttribute("data-testid")));

/**
 * 검수할 단계를 모두 끄면 빈 화면 대신 Job 의 Step 탭을 모두 그대로 보이고 안내를 띄운다.
 * 끝나면 `review-steps` 저장소를 원래 값으로 돌린다.
 */
async function stepsFallback(ctx) {
  const { page, report } = ctx;
  const fallback = page.getByTestId("job-review-steps-fallback");
  await openJob(ctx);
  const original = await readLocalStorage(page, "review-steps");
  const allSteps = on =>
    JSON.stringify(Object.fromEntries(REVIEW_STEP_KEYS.map(key => [key, on])));
  try {
    await writeLocalStorage(page, "review-steps", allSteps(true));
    await openJob(ctx);
    const allTabs = await stepTabIds(page);
    const fallbackWhenOn = await fallback.count();

    await writeLocalStorage(page, "review-steps", allSteps(false));
    await openJob(ctx);
    const shown = await eventually(async () => (await fallback.count()) === 1);
    const offTabs = await stepTabIds(page);
    report(
      "steps-fallback",
      fallbackWhenOn === 0 &&
        Boolean(shown) &&
        allTabs.length > 0 &&
        JSON.stringify(offTabs) === JSON.stringify(allTabs),
      `켬: 안내 ${fallbackWhenOn} · 탭 ${allTabs.length} / 끔: 안내 ${await fallback.count()} · 탭 ${offTabs.length}`,
    );
  } finally {
    await writeLocalStorage(page, "review-steps", original);
  }
  report(
    "steps-fallback-restored",
    (await readLocalStorage(page, "review-steps")) === original,
    `${original}`,
  );
}

/**
 * 앱 껍데기: 검수할 단계를 모두 끈 Step 탭 fallback, 홈 대시보드의 최근 검수 기록, 이탈 확인(상단 바
 * 홈 링크·설정 메뉴 언어·돌아가기 링크), Collection 상세 머리·진행 카드, 설정 토글의 즉시 반영과 저장소 값,
 * "완료하면 다음 Job 열기" 토글.
 */
async function shell(ctx) {
  const { page, config, report, skip } = ctx;
  const { index } = config;
  const { collection, job } = index.ids;
  const homePath = `/${config.locale}`;
  const collectionPath = `/${config.locale}/collections/${collection}`;
  const pathname = () => new URL(page.url()).pathname;

  await stepsFallback(ctx);

  // (a) Job 을 불러오면 이 브라우저의 최근 검수 기록에 남고, 홈 대시보드 최근 목록에 그 Job 이 보인다.
  await openJob(ctx);
  const recorded = await eventually(async () => {
    const list = JSON.parse(
      (await readLocalStorage(page, "review-recent-jobs")) ?? "[]",
    );
    return list.find(
      entry => entry.collectionId === collection && entry.jobId === job,
    );
  }, 5000);
  const title = (
    (await page.getByTestId("job-review-title").textContent()) ?? ""
  ).trim();
  report(
    "recent-recorded-when-ready",
    Boolean(recorded) &&
      typeof recorded.jobName === "string" &&
      title.startsWith(recorded.jobName),
    `기록 ${JSON.stringify(recorded ?? null)} · 제목 "${title}"`,
  );

  // 변경이 없으면 홈 링크는 묻지 않고(브라우저 창·앱 Dialog 모두 없음) 옮긴다.
  const cleanHome = await leavePromptsDuring(page, async () => {
    await page.getByTestId("app-header-link-home").click();
    await eventually(() => pathname() === homePath, 8000);
  });
  report(
    "home-link-no-confirm-when-clean",
    cleanHome.native.length === 0 && !cleanHome.app && pathname() === homePath,
    `창 ${cleanHome.native.join(",") || "없음"} · Dialog ${cleanHome.app} · ${pathname()}`,
  );
  const recentLink = page
    .getByTestId("home-dashboard-recent")
    .locator(`${byTestId("home-recent-link-job")}[href$="/jobs/${job}"]`);
  report(
    "home-dashboard-recent",
    Boolean(
      await eventually(
        async () =>
          (await page.getByTestId("home-dashboard").count()) === 1 &&
          (await recentLink.count()) >= 1,
        8000,
      ),
    ),
    `대시보드 ${await page.getByTestId("home-dashboard").count()} · 최근 링크 ${await recentLink.count()}`,
  );

  // 변경이 없으면 돌아가기 링크도 묻지 않는다. 옮겨 간 Collection 상세의 머리와 진행 카드 수.
  await openJob(ctx);
  const cleanBack = await leavePromptsDuring(page, async () => {
    await page.getByTestId("job-review-link-back").click();
    await eventually(() => pathname() === collectionPath, 8000);
  });
  report(
    "back-link-no-confirm-when-clean",
    cleanBack.native.length === 0 &&
      !cleanBack.app &&
      pathname() === collectionPath,
    `창 ${cleanBack.native.join(",") || "없음"} · Dialog ${cleanBack.app} · ${pathname()}`,
  );
  await page.waitForSelector(byTestId("job-rows-table"));
  const progress = page.getByTestId("collection-detail-progress");
  const progressText = async () =>
    (await progress.count()) === 1
      ? ((await progress.textContent()) ?? "")
      : "";
  const progressReady = await eventually(
    async () => /\d/.test(await progressText()),
    8000,
  );
  const bar = page.getByTestId("collection-detail-progress-bar");
  const barOk =
    (await bar.count()) === 0 ||
    Number(await bar.getAttribute("aria-valuenow")) <=
      Number(await bar.getAttribute("aria-valuemax"));
  report(
    "collection-detail",
    (await page.getByTestId("collection-detail-button-copy-id").count()) ===
      1 &&
      Boolean(progressReady) &&
      barOk,
    `진행 "${(await progressText()).trim().slice(0, 80)}"`,
  );

  // 전체 JSON 편집 창은 "지금 내용" 기준을 보인다: 열면 현재 편집본, "원본 불러오기" 뒤 원본.
  await openJob(ctx);
  await page.getByTestId("job-review-json-menu-trigger").click();
  await page.getByTestId("job-review-json-menu-edit").click();
  const basis = page.getByTestId("job-review-json-sheet-basis");
  await basis.waitFor();
  const openedBasis = [
    await basis.getAttribute("data-basis"),
    await basis.getAttribute("data-modified"),
  ];
  await page.getByTestId("job-review-json-sheet-button-load-original").click();
  const originalShown = await eventually(
    async () => (await basis.getAttribute("data-basis")) === "original",
  );
  report(
    "json-sheet-basis",
    openedBasis[0] === "edited" &&
      openedBasis[1] === "false" &&
      Boolean(originalShown) &&
      (await basis.getAttribute("data-modified")) === "false",
    `열 때 ${openedBasis.join("/")} · 원본 뒤 ${await basis.getAttribute("data-basis")}/${await basis.getAttribute("data-modified")}`,
  );
  await page.getByTestId("job-review-json-sheet-button-close").click();
  await page
    .getByTestId("job-review-json-sheet")
    .waitFor({ state: "detached" });

  // (b) 변경이 있으면 홈 링크·언어 바꾸기·돌아가기 링크가 앱 Dialog 를 띄우고(첫 포커스 "머무르기"),
  // 머무르면 주소·변경이 그대로이고 화면을 다시 누를 수 있다.
  await openJob(
    ctx,
    { doc: index.documents[0].document_id, page: "1" },
    "information-extract",
  );
  const field = page.locator(
    `[data-result-id="${extractResultId(0)}"] ${FIELD_INPUT}:not([inputmode="decimal"])`,
  );
  await field.first().waitFor();
  await field.first().fill(`${await field.first().inputValue()} smoke-shell`);
  await field.first().press("Tab");
  await eventually(async () => (await changeCountOf(page)) === 1);
  await page.evaluate(() => {
    window.__shellNoReload = true;
  });
  const stays = async (check, action) => {
    const before = page.url();
    let focused = null;
    const seen = await dialogsDuring(
      page,
      async () => {
        await action();
        await page.locator(LEAVE_DIALOG).waitFor({ timeout: 5000 });
        focused = await page.evaluate(
          () => document.activeElement?.getAttribute("data-testid") ?? null,
        );
        await page.getByTestId("leave-confirm-button-stay").click();
        await page.locator(LEAVE_DIALOG).waitFor({ state: "detached" });
      },
      800,
    );
    const interactive = await eventually(() => bodyInteractive(page), 2000);
    report(
      check,
      seen.length === 0 &&
        focused === "leave-confirm-button-stay" &&
        page.url() === before &&
        (await changeCountOf(page)) === 1 &&
        Boolean(interactive),
      `창 ${seen.join(",") || "없음"} · 포커스 ${focused} · ${page.url()} · 변경 ${await changeCountOf(page)} · body 조작 ${interactive}`,
    );
  };
  await stays("home-link-confirm-cancel", () =>
    page.getByTestId("app-header-link-home").click(),
  );
  await stays("locale-confirm-cancel", async () => {
    await page.getByTestId("app-header-button-settings").click();
    await page
      .getByTestId(`settings-menu-radio-locale-${otherLocale(config)}`)
      .click();
  });
  // 언어 항목을 골라도 메뉴가 닫히지 않았으면 닫는다.
  if ((await page.getByTestId("settings-menu-steps").count()) > 0) {
    await page.keyboard.press("Escape");
  }
  await stays("back-link-confirm-cancel", () =>
    page.getByTestId("job-review-link-back").click(),
  );
  // 머무른 뒤 설정 메뉴를 다시 열 수 있다(언어 전환 때 메뉴와 Dialog 가 겹쳐도 화면이 막히지 않음).
  await page.getByTestId("app-header-button-settings").click();
  const menuReopened = await eventually(
    async () => (await page.getByTestId("settings-menu-steps").count()) > 0,
    2000,
  );
  await page.keyboard.press("Escape");
  await page.getByTestId("settings-menu-steps").waitFor({ state: "detached" });
  report("menu-usable-after-stay", Boolean(menuReopened));

  // (c) 설정 토글은 새로 고침 없이 열린 Job 화면에 바로 반영되고 저장소에 기대한 JSON 으로 남는다.
  const jsonMenu = page.getByTestId("job-review-json-menu-trigger");
  const jsonBefore = await jsonMenu.count();
  await toggleSettingsItem(page, "settings-menu-checkbox-jsonMenu");
  report(
    "feature-toggle-live",
    jsonBefore === 1 &&
      Boolean(await eventually(async () => (await jsonMenu.count()) === 0)) &&
      (await readLocalStorage(page, "review-features")) ===
        JSON.stringify({
          pageTools: true,
          filmstrip: true,
          organizer: true,
          jsonMenu: false,
          history: true,
        }),
    `메뉴 ${jsonBefore}→${await jsonMenu.count()} · ${await readLocalStorage(page, "review-features")}`,
  );
  const parseTab = page.getByTestId(
    `job-review-step-tab-${stepIdOf(index, "document-parse")}`,
  );
  const parseBefore = await parseTab.count();
  await toggleSettingsItem(page, "settings-menu-checkbox-step-parse");
  report(
    "step-toggle-live",
    parseBefore === 1 &&
      Boolean(await eventually(async () => (await parseTab.count()) === 0)) &&
      (await readLocalStorage(page, "review-steps")) ===
        JSON.stringify({
          parse: false,
          classify: true,
          split: true,
          extract: true,
          validate: true,
          match: true,
          merge: true,
          instruct: true,
          export: true,
        }),
    `탭 ${parseBefore}→${await parseTab.count()} · ${await readLocalStorage(page, "review-steps")}`,
  );
  report(
    "toggles-without-reload",
    (await page.evaluate(() => window.__shellNoReload)) === true &&
      (await changeCountOf(page)) === 1,
  );

  // 변경이 있는 채 돌아가기 → Dialog "나가기" 면 Collection 상세로 옮긴다(브라우저 창 없음).
  const leaveBack = await dialogsDuring(page, async () => {
    await page.getByTestId("job-review-link-back").click();
    await page.locator(LEAVE_DIALOG).waitFor({ timeout: 5000 });
    await page.getByTestId("leave-confirm-button-leave").click();
    await eventually(() => pathname() === collectionPath, 8000);
  });
  report(
    "back-link-confirm-leave",
    leaveBack.length === 0 &&
      pathname() === collectionPath &&
      (await page.locator(LEAVE_DIALOG).count()) === 0,
    `창 ${leaveBack.join(",") || "없음"} · ${pathname()}`,
  );

  // (d) 큐 안의 Job 에서 "완료하면 다음 Job 열기" 를 끄면 주 동작이 바로 "검수 완료" 쪽으로 바뀐다.
  const needs = needsJobs(index);
  if (needs) {
    skip("advance-toggle", needs);
    return;
  }
  await normalizeInProgress(ctx, index.jobs);
  await openCollection(ctx, index.jobs.length);
  await page.getByTestId("collection-detail-button-start-review").click();
  await page.waitForSelector(byTestId("job-review-queue"));
  const complete = page.getByTestId("job-review-button-complete");
  await eventually(async () => await complete.isEnabled());
  const advanceBefore = await complete.getAttribute("data-advance");
  const labelBefore = ((await complete.textContent()) ?? "").trim();
  await toggleSettingsItem(page, "settings-menu-checkbox-advance");
  const switched = await eventually(
    async () => (await complete.getAttribute("data-advance")) === "false",
  );
  const labelAfter = ((await complete.textContent()) ?? "").trim();
  report(
    "advance-toggle",
    advanceBefore === "true" &&
      Boolean(switched) &&
      labelAfter !== labelBefore &&
      (await readLocalStorage(page, "review-queue-advance")) === "0",
    `data-advance ${advanceBefore}→${await complete.getAttribute("data-advance")} · "${labelBefore}"→"${labelAfter}" · ${await readLocalStorage(page, "review-queue-advance")}`,
  );
}

// ── 목록 ──────────────────────────────────────────────────────────────────

/** 목록 표 머리 칸 폭(px, 그린 순서). */
const listHeaderWidths = page =>
  page
    .locator(`${byTestId("collections-list-table")} thead th`)
    .evaluateAll(cells =>
      cells.map(cell => cell.getBoundingClientRect().width),
    );

/**
 * Collection 목록 출처 필터: 두 출처를 함께 고르면(고르는 동안 메뉴가 열려 있음) 주소가 `source=a,b`,
 * 트리거가 강조되고, 고르기 전후 머리 칸 폭이 같다(열 폭 고정). "전체" 로 비우면 주소에서 빠진다.
 */
async function collectionsList(ctx) {
  const { page, config, report } = ctx;
  await page.goto(`${config.base}/${config.locale}/collections`, {
    waitUntil: "domcontentloaded",
  });
  await page.locator(byTestId("collections-list-row-open")).first().waitFor();
  const before = await listHeaderWidths(page);

  const trigger = page.getByTestId("collections-list-button-filter-source");
  await trigger.click();
  await page.getByTestId("collections-list-filter-source-agent_link").click();
  const exportItem = page.getByTestId(
    "collections-list-filter-source-agent_export",
  );
  const menuStayed = (await exportItem.count()) === 1;
  await exportItem.click();
  await page.keyboard.press("Escape");
  await exportItem.waitFor({ state: "detached" });
  const urlOk = await eventually(
    () => new URL(page.url()).search.includes("source=agent_export,agent_link"),
    3000,
  );
  const after = await listHeaderWidths(page);
  const sameWidths =
    before.length > 0 &&
    before.length === after.length &&
    before.every((width, i) => Math.abs(width - after[i]) <= 1);
  report(
    "source-filter-multi",
    menuStayed &&
      Boolean(urlOk) &&
      (await trigger.getAttribute("data-active")) === "true",
    `메뉴 유지 ${menuStayed} · ${new URL(page.url()).search} · data-active ${await trigger.getAttribute("data-active")}`,
  );
  report(
    "column-widths-fixed",
    sameWidths,
    `전 ${before.map(Math.round).join(",")} · 후 ${after.map(Math.round).join(",")}`,
  );

  await trigger.click();
  await page.getByTestId("collections-list-filter-source-all").click();
  await page.keyboard.press("Escape");
  const cleared = await eventually(
    () => !new URL(page.url()).searchParams.has("source"),
    3000,
  );
  report(
    "source-filter-all-clears",
    Boolean(cleared) && (await trigger.getAttribute("data-active")) === "false",
    new URL(page.url()).search || "(없음)",
  );
}

const isLarge = index => index.totalPages > LARGE_JOB_ABOVE;
const needsLongDocument = index =>
  longDocument(index)
    ? null
    : "index.json 에 긴 문서(longDocumentIndex)가 없음";
const needsLargeJob = index =>
  isLarge(index)
    ? null
    : `${LARGE_JOB_ABOVE} 쪽 이하 Job 은 이웃 보기를 쓰지 않음(small-job 이 대신 본다)`;

/** Collection 관계 보기: 토글, 연결, 사본 숨김, 강조, 주소 유지, 카드로 이동. */
async function runLineage(ctx) {
  const { page, config, report } = ctx;
  const { collection } = config.index.ids;

  // 설정 메뉴의 언어 전환은 목록 주소의 query(정렬 등)를 그대로 둔다.
  await page.goto(`${config.base}/${config.locale}/collections?order=asc`);
  await page.locator(byTestId("collections-list-table")).waitFor();
  const locale = otherLocale(config);
  const switched = await switchLocaleFromMenu(page, locale);
  await page.locator(byTestId("collections-list-table")).waitFor();
  const keptOrder = await eventually(
    () => new URL(page.url()).searchParams.get("order") === "asc",
  );
  report(
    "locale-switch-keeps-query",
    switched.pathname === `/${locale}/collections` && keptOrder,
    page.url(),
  );

  await page.goto(`${config.base}/${config.locale}/collections`);
  await page.locator(byTestId("collections-list-button-view-lineage")).click();
  const graph = page.locator(byTestId("collections-lineage-graph"));
  await graph.waitFor({ timeout: 30_000 });
  report(
    "toggle-url",
    new URL(page.url()).searchParams.get("view") === "lineage",
    page.url(),
  );

  const nodes = page.locator(byTestId("collections-lineage-node"));
  const nodeOf = id => page.locator(`[data-collection-id="${id}"]`);
  report("nodes", (await nodes.count()) === 10, `${await nodes.count()} 개`);
  const edges = await page
    .locator(byTestId("collections-lineage-edge"))
    .count();
  report("edges", edges === 8, `${edges} 개`);
  report(
    "schema-less-default-linked",
    (await nodeOf("scol_mock_line_instruct").count()) === 1,
  );
  report(
    "corrected-through-replaced-generation",
    (await nodeOf("scol_mock_line_corrected").count()) === 1,
  );
  report(
    "default-copy-hidden",
    (await nodeOf("scol_mock_line_second_default").count()) === 0,
  );
  report(
    "job-row-default-copy-hidden",
    (await nodeOf("scol_mock_line_third_default").count()) === 0,
  );
  report(
    "unrelated-hidden",
    (await nodeOf("scol_mock_line_unrelated").count()) === 0,
  );

  const leftOf = async id => (await nodeOf(id).boundingBox())?.x ?? 0;
  report(
    "chain-left-to-right",
    (await leftOf(collection)) < (await leftOf("scol_mock_line_second")) &&
      (await leftOf("scol_mock_line_second")) <
        (await leftOf("scol_mock_line_third")),
  );

  // 건너뛰는 연결이 사이 카드 뒤로 지나가지 않는다.
  const paths = await page
    .locator(byTestId("collections-lineage-edge"))
    .evaluateAll(items => items.map(item => item.getAttribute("d")));
  report(
    "lane-edge",
    paths.some(path => path?.includes(" L ")),
    paths[0],
  );

  await nodeOf("scol_mock_line_third").hover();
  const opacity = id =>
    nodeOf(id).evaluate(item => getComputedStyle(item).opacity);
  report(
    "hover-dims-unrelated",
    await eventually(
      async () => Number(await opacity("scol_mock_line_other")) < 1,
    ),
  );
  report(
    "hover-keeps-source",
    Number(await opacity("scol_mock_line_second")) === 1,
  );
  await page.mouse.move(0, 0);
  const isDimmed = async () =>
    Number(await opacity("scol_mock_line_other")) < 1;
  await eventually(async () => !(await isDimmed()));

  // 볼 수 없는 Collection 카드는 링크가 없어도 키보드로 강조를 볼 수 있다.
  await nodeOf("scol_mock_line_deleted")
    .locator(byTestId("collections-lineage-card-missing"))
    .focus();
  report("missing-card-focus-dims-unrelated", await eventually(isDimmed));
  await page.evaluate(() => document.activeElement?.blur());
  await eventually(async () => !(await isDimmed()));

  // 같은 카드의 링크에서 복사 버튼으로 옮겨도 강조가 풀렸다 돌아오지 않는다.
  await nodeOf("scol_mock_line_second")
    .locator(byTestId("collections-lineage-link-open"))
    .focus();
  await eventually(isDimmed);
  await nodeOf("scol_mock_line_other").evaluate(item => {
    window.__lineageFlips = 0;
    new MutationObserver(() => {
      window.__lineageFlips += 1;
    }).observe(item, { attributes: true, attributeFilter: ["class"] });
  });
  await page.keyboard.press("Tab");
  const movedToCopy = await nodeOf("scol_mock_line_second")
    .locator(byTestId("collections-lineage-button-copy-id"))
    .evaluate(button => button === document.activeElement);
  const flips = await page.evaluate(() => window.__lineageFlips);
  report(
    "focus-move-keeps-highlight",
    movedToCopy && flips === 0,
    `${flips} 번`,
  );
  await page.evaluate(() => document.activeElement?.blur());

  await page.reload();
  await graph.waitFor({ timeout: 30_000 });
  report("reload-keeps-view", (await nodes.count()) === 10);

  await nodeOf("scol_mock_line_second")
    .locator(byTestId("collections-lineage-card-open"))
    .click({ position: { x: 120, y: 60 } });
  await page.waitForURL(url =>
    url.pathname.endsWith("/collections/scol_mock_line_second"),
  );
  await page.goBack();
  await graph.waitFor({ timeout: 30_000 });
  report("back-returns-to-lineage", (await nodes.count()) === 10);

  await page.locator(byTestId("collections-list-button-view-list")).click();
  await page.locator(byTestId("collections-list-table")).waitFor();
  report("toggle-back-to-list", !page.url().includes("view="), page.url());
  const listText = await page
    .locator(byTestId("collections-list-table"))
    .innerText();
  report(
    "list-hides-auto-default",
    !listText.includes("Mock step 2 results") &&
      listText.includes("Mock instruct results"),
  );
}

/**
 * Core 데모 화면(`/{locale}/ui-kit-demo`). 서버를 `REVIEW_UI_KIT_DEMO=1` 로 띄웠을 때만 열리므로 404 면 SKIP.
 * item 섹션이 하나씩 그려지는지, 읽기 전용 view 에 끌기·✂·라벨 편집이 없고 격자 메뉴 버튼이 모두 비활성인지,
 * 편집 view 의 ✂ 가 읽기 전용 view 에도 반영되는지, 문서 위치·페이지 옮기기 대화 상자, 판정 칸, Parse 표의
 * 허용 목록, 규칙 카드, Instruct 인용 칩(Provider 있음/없음), 저장·완료 버튼 줄, 문서 라벨 칸, 배열 표를 본다.
 */
async function uiKitDemo({ page, config, report, skip }) {
  const url = `${config.base}/${config.locale}/ui-kit-demo`;
  const status = (await fetch(url, { redirect: "manual" })).status;
  if (status === 404) {
    skip("render", "REVIEW_UI_KIT_DEMO 가 꺼져 있음(404)");
    return;
  }
  report("status-200", status === 200, `HTTP ${status}`);
  await page.goto(url);
  const root = id => page.locator(byTestId(`ui-kit-demo-${id}`));
  await root("page-grid-readonly").waitFor();

  for (const id of [
    "position-bar",
    "document-list",
    "document-filter-summary",
    "value-widget-section",
    "filmstrip-edit",
    "filmstrip-readonly",
    "page-grid-edit",
    "page-grid-readonly",
    "verdict",
    "validate-rules",
    "page-range",
    "move-pages-section",
    "parse-table",
    "instruct-with-citations",
    "instruct-structured",
    "instruct-plain",
    "review-actions",
    "label-select-annotated-label-select",
    "label-input-blur-label-input",
    "array-table",
  ]) {
    report(`render-${id}`, (await root(id).count()) === 1);
  }

  const editingSelector = [
    '[draggable="true"]',
    '[data-testid$="-split-button"]',
    '[data-testid$="-cell-split"]',
    '[data-testid$="-label-select"]',
    '[data-testid$="-label-input"]',
    '[data-testid$="-strip-handle"]',
    '[data-testid$="-strip-menu-open"]',
    '[data-testid$="-thumbnail-menu-open"]',
  ].join(", ");
  for (const view of ["filmstrip", "page-grid"]) {
    const edit = await root(`${view}-edit`).locator(editingSelector).count();
    const readOnly = await root(`${view}-readonly`)
      .locator(editingSelector)
      .count();
    report(
      `${view}-readonly-no-editing`,
      edit > 0 && readOnly === 0,
      `edit ${edit} · readOnly ${readOnly}`,
    );
  }
  // 격자의 빈 메뉴는 숨기지 않고 비활성으로 둔다(Core 계약).
  const gridMenus = await root("page-grid-readonly")
    .locator('[data-testid$="-menu-open"]')
    .evaluateAll(items => items.map(item => item.disabled));
  report(
    "page-grid-readonly-menus-disabled",
    gridMenus.length > 0 && gridMenus.every(Boolean),
    `${gridMenus.length} 개`,
  );

  const strips = id =>
    root(id).locator('[data-testid$="-strip-pages"]').count();
  const before = await strips("filmstrip-readonly");
  await root("filmstrip-edit")
    .locator('[data-testid$="-split-button"]')
    .first()
    .click();
  await eventually(
    async () => (await strips("filmstrip-readonly")) === before + 1,
  );
  report(
    "split-shows-in-readonly",
    (await strips("filmstrip-readonly")) === before + 1,
    `${before} → ${await strips("filmstrip-readonly")}`,
  );

  // 문서 위치 대화 상자: 편집 Filmstrip 첫 문서를 2 번 자리로 → 두 문서 순서가 바뀌고 메뉴 버튼으로 포커스가 돌아온다.
  const stripIds = () =>
    root("filmstrip-edit")
      .locator("[data-document-id]")
      .evaluateAll(items => items.map(item => item.dataset.documentId));
  const idsBefore = await stripIds();
  await root("filmstrip-edit")
    .locator("[data-document-id]")
    .first()
    .locator('[data-testid$="-strip-menu-open"]')
    .click();
  await page
    .getByTestId("ui-kit-demo-filmstrip-edit-strip-menu-position")
    .click();
  const positionDialog = root("document-position-dialog");
  await positionDialog.waitFor();
  await root("document-position-dialog-input").fill("2");
  await root("document-position-dialog-button-move").click();
  await positionDialog.waitFor({ state: "hidden" });
  await eventually(async () => (await stripIds())[1] === idsBefore[0]);
  const idsAfter = await stripIds();
  report(
    "position-dialog-reorders",
    idsAfter[0] === idsBefore[1] && idsAfter[1] === idsBefore[0],
    `${idsBefore.slice(0, 3).join(",")} → ${idsAfter.slice(0, 3).join(",")}`,
  );
  const focusedMenu = await eventually(() =>
    page.evaluate(() =>
      (document.activeElement?.getAttribute("data-testid") ?? "").endsWith(
        "-strip-menu-open",
      ),
    ),
  );
  report("position-dialog-returns-focus", focusedMenu);

  // 판정 칸: 다른 칸을 누르면 값이 바뀌고 원본 근거 목록이 사라진다(데모 규칙).
  const reasonsBefore = await root("verdict-reason").count();
  await root("verdict-button-red").click();
  await eventually(
    async () => (await root("verdict-value").textContent()) === '"red"',
  );
  report(
    "verdict-click-changes-value",
    (await root("verdict-value").textContent()) === '"red"' &&
      reasonsBefore > 0 &&
      (await root("verdict-reason").count()) === 0,
    `근거 ${reasonsBefore} → ${await root("verdict-reason").count()}`,
  );

  // 규칙 카드 수 = fixture 규칙 수, 모르는 연산자는 원문으로.
  const ruleCards = await root("validate-rules")
    .locator(":scope > ul > li")
    .count();
  report(
    "validate-rules-cards",
    ruleCards === 5 &&
      ((await root("validate-rules").textContent()) ?? "").includes("one_of"),
    `${ruleCards} 개`,
  );

  // 페이지 옮기기: 범위로 열어 제출 → 닫히고 요청 JSON, 실패 응답이면 message 를 보이고 닫히지 않음.
  const moveDialog = root("move-pages-dialog");
  const requestText = async () =>
    (await root("move-pages-request").textContent()) ?? "";
  await root("move-pages-open-range").click();
  await moveDialog.waitFor();
  await root("move-pages-dialog-button-move").click();
  await moveDialog.waitFor({ state: "hidden" });
  const rangeRequest = await requestText();
  report(
    "move-pages-request-shown",
    rangeRequest.includes('"range":{"from":2,"to":2}') &&
      rangeRequest.includes('"documentId":"d2"'),
    rangeRequest,
  );
  await root("move-pages-fail").check();
  await root("move-pages-open-selection").click();
  await moveDialog.waitFor();
  const summaryShown = (await root("move-pages-dialog-summary").count()) === 1;
  await root("move-pages-dialog-button-move").click();
  const alert = moveDialog.locator('[role="alert"]');
  await eventually(async () => (await alert.count()) === 1);
  const selectionRequest = await requestText();
  report(
    "move-pages-failure-message",
    summaryShown &&
      (await moveDialog.isVisible()) &&
      ((await alert.textContent()) ?? "").includes("demo failure") &&
      !selectionRequest.includes('"range"'),
    selectionRequest,
  );
  await root("move-pages-dialog-button-cancel").click();
  await moveDialog.waitFor({ state: "hidden" });

  // Parse 표: 허용 목록으로 다시 만든 표만 남고 금지 태그·속성은 없다. 표를 누르면 onActivate.
  const parseSection = root("parse-table-section");
  const forbidden = await parseSection
    .locator("script, iframe, img, [onclick], table[style]")
    .count();
  const injected = await page.evaluate(() => "__demoInjected" in window);
  report(
    "parse-table-allow-list",
    (await root("parse-table").locator("table").count()) === 1 &&
      forbidden === 0 &&
      !injected,
    `금지 ${forbidden} · 실행 ${injected}`,
  );
  await root("parse-table").locator("td").first().click();
  report(
    "parse-table-activate",
    (await root("parse-table-activations").textContent()) === "activations: 1",
    (await root("parse-table-activations").textContent()) ?? "",
  );

  // Instruct: Provider 안은 칩(3 번은 위치 없음), 밖은 칩도 표식 글자도 없다. 칩을 누르면 선택.
  const chips = root("instruct-with-citations").locator(
    byTestId("ui-kit-demo-instruct-citation"),
  );
  await eventually(async () => (await chips.count()) === 3);
  const plainText = (await root("instruct-plain").textContent()) ?? "";
  const plainChips = await root("instruct-plain")
    .locator("[data-citation]")
    .count();
  report(
    "instruct-plain-strips-markers",
    (await chips.count()) === 3 &&
      plainChips === 0 &&
      plainText.includes("1,280.50") &&
      !plainText.includes("†"),
    `칩 ${await chips.count()} · 밖 칩 ${plainChips}`,
  );
  await chips.first().click();
  await eventually(async () =>
    ((await root("instruct-state").textContent()) ?? "").includes(
      "selected: 1",
    ),
  );
  report(
    "instruct-citation-select",
    ((await root("instruct-state").textContent()) ?? "").includes(
      "selected: 1",
    ) && (await chips.first().getAttribute("data-selected")) === "true",
    (await root("instruct-state").textContent()) ?? "",
  );
  report(
    "instruct-structured-chips",
    (await root("instruct-structured").locator("[data-citation]").count()) > 0,
  );

  // 저장·완료 버튼 줄: 저장하면 변경 수 배지가 사라지고 상태 문구, 충돌을 켜면 실패 문구(빨강).
  const actionsStatus = async () =>
    (await root("review-actions-status").textContent()) ?? "";
  const badgeBefore =
    (await root("review-actions-change-count").textContent()) ?? "";
  await root("review-actions-button-save").click();
  await eventually(async () => (await actionsStatus()) === "Saved");
  report(
    "review-actions-save",
    badgeBefore === "2" &&
      (await actionsStatus()) === "Saved" &&
      (await root("review-actions-change-count").count()) === 0 &&
      (await root("review-actions-button-save").isDisabled()),
    `배지 ${badgeBefore} · 상태 ${await actionsStatus()}`,
  );
  await root("review-actions-conflict").check();
  await root("review-actions-add-change").click();
  await root("review-actions-button-save").click();
  const conflictText = root("review-actions-status").locator(
    ".text-destructive",
  );
  await eventually(async () => (await conflictText.count()) === 1);
  report(
    "review-actions-conflict",
    (await conflictText.count()) === 1 &&
      (await root("review-actions-change-count").textContent()) === "1",
    await actionsStatus(),
  );

  // 문서 라벨: select 는 고르는 즉시, blur 모드 입력은 Enter 에 앞뒤 공백을 빼고 확정한다.
  const labelValue = async id =>
    (await root(`label-${id}-value`).textContent()) ?? "";
  await root("label-select-annotated-label-select").click();
  const outsideOption = root("label-select-annotated-option-label-Memo");
  await outsideOption.waitFor();
  const outsideText = (await outsideOption.textContent()) ?? "";
  await root("label-select-annotated-option-label-Receipt").click();
  await eventually(
    async () => (await labelValue("select-annotated")) === '"Receipt"',
  );
  report(
    "label-select-change",
    outsideText.includes("not in config") &&
      (await labelValue("select-annotated")) === '"Receipt"',
    `${outsideText} → ${await labelValue("select-annotated")}`,
  );
  // select 가 닫히며 트리거로 포커스를 돌려준 뒤에 입력한다(늦게 돌아온 포커스가 입력을 blur 해 먼저 확정하지 않게).
  await eventually(() =>
    page.evaluate(
      () =>
        document.activeElement?.getAttribute("data-testid") ===
        "ui-kit-demo-label-select-annotated-label-select",
    ),
  );
  const labelInput = root("label-input-blur-label-input");
  await labelInput.fill("  Letter  ");
  const beforeEnter = await labelValue("input-blur");
  await labelInput.press("Enter");
  await eventually(async () => (await labelValue("input-blur")) === '"Letter"');
  report(
    "label-input-enter-commits",
    beforeEnter === '"Memo"' && (await labelValue("input-blur")) === '"Letter"',
    `${beforeEnter} → ${await labelValue("input-blur")}`,
  );

  // 배열 표: 오류·경고 문구, 칸 Enter → 값 줄과 다음 칸 포커스, 바뀐 칸 되돌리기.
  const table = root("array-table");
  const tableValue = async () =>
    (await root("array-table-value").textContent()) ?? "";
  report(
    "array-table-cell-states",
    (await root("array-table-cell-error").count()) === 1 &&
      (await root("array-table-cell-warning").count()) === 1 &&
      (await root("array-table-button-add-cell").count()) === 1 &&
      (await table.locator('[data-changed="true"]').count()) === 1,
  );
  const nameInput = root("array-table-editor-0-name-input-value");
  await nameInput.fill("Bolt");
  await nameInput.press("Enter");
  await eventually(async () => (await tableValue()).includes('"Bolt"'));
  const focusedCell = await eventually(() =>
    page.evaluate(
      () =>
        document.activeElement?.getAttribute("data-testid") ===
        "ui-kit-demo-array-table-editor-0-qty-input-value",
    ),
  );
  report(
    "array-table-enter-next-cell",
    (await tableValue()).includes('"name":"Bolt"') && focusedCell,
    await tableValue(),
  );
  const priceCell = table.locator('[data-field-id="row-1-price"]');
  await priceCell
    .locator(byTestId("ui-kit-demo-array-table-button-revert"))
    .click();
  await eventually(async () => (await tableValue()).includes('"price":90'));
  report(
    "array-table-revert",
    (await tableValue()).includes('"price":90') &&
      (await priceCell.getAttribute("data-changed")) === null,
    await tableValue(),
  );
}

export const SCENARIOS = [
  {
    name: "defaults",
    description:
      "설정을 건드리지 않은 기본 화면: 페이지 썸네일 토글은 보이고(기본 켜짐) 나뉜 Job 은 띠가 펼친 채 시작, Parse, Instruct 탭과 JSON 메뉴, 페이지 편집 도구, 정리가 숨음. 도구를 끈 뒤에도 제외 문서 되돌리기, 썸네일까지 끄면 제외 페이지 안내로 썸네일 켜기",
    defaults: true,
    run: defaults,
  },
  {
    name: "viewer",
    description:
      "연속 스크롤 기본·PageDown/Home/End·Alt+↓·URL 300 ms·pagehide flush·단축키 안내·언어 전환 뒤 ?doc&page 유지",
    run: viewer,
  },
  {
    name: "position-bar",
    description:
      "13 쪽 이상 문서의 위치 바: 끝 쪽 ◀/▶ aria-disabled·포커스 유지",
    skip: index =>
      index.documents.some(doc => doc.pages >= POSITION_BAR_FROM)
        ? null
        : `${POSITION_BAR_FROM} 쪽 이상 문서가 없음`,
    run: positionBar,
  },
  {
    name: "document-list",
    description:
      "목록 윈도잉(100 문서 초과)·필터 300 ms 디바운스·요약·선택 가림 안내와 필터 지우기·결과 메뉴 Esc 뒤 포커스 복귀",
    run: documentList,
  },
  {
    name: "filmstrip",
    description:
      "이웃 보기 띠 3·접힌 띠 메뉴·위치 지정 범위·합성 DnD 3 종·빠진 띠 펼침",
    skip: index => needsLargeJob(index) ?? needsLongDocument(index),
    run: filmstrip,
  },
  {
    name: "structure-toolbar",
    description:
      "경계 버튼 aria-disabled·앞 문서로·페이지 옮기기 대화상자·옮긴 뒤 대상 선택·나누기",
    run: structureToolbar,
  },
  {
    name: "structure-label",
    description:
      "구조 패널 라벨 칸: select 로 바꾸면 변경 +1(되돌려 둠), 새 문서로 분리 대화 상자 라벨 select 고른 뒤 취소, 라벨 목록이 없으면 자유 입력(Enter 확정·다듬기·다시 만들어져 포커스 빠짐·200 자·Esc)",
    run: structureLabel,
  },
  {
    name: "organizer",
    description:
      "페이지 정리 화면: 열기(띠·띠 토글 숨김, 창 높이 맞춤)·행 윈도잉·끝까지 스크롤·셀 클릭 → 뷰어·S/M·셀 메뉴 5·메뉴 제외/복귀·합성 DnD 2 종·위치 지정 범위·라벨 select·여러 장 선택(Shift 범위·일괄 제외·⌘ 토글 → 새 문서로·옮기기… 대화상자·Esc)·파일 그룹 2 이상이면 그룹 경계·그룹 섞인 선택·다른 그룹 drop 거부·닫기",
    skip: index => needsLargeJob(index) ?? needsLongDocument(index),
    run: organizer,
  },
  {
    name: "values",
    description:
      "큰 배열(--items-max 120): 선택 뒤 한도 유지·더 보기·필터 중 항목 추가·숫자 입력 오류 aria 연결·지운 배열 항목의 오류 비승계·표 칸 Enter·Tab 이동·되돌리기·빠진 칸 ＋ 뒤 포커스·마지막 항목 삭제 뒤 포커스·빈 배열·schema 오류 행·긴 문자열 요약·고정 하이라이트 바깥 클릭 해제(값 행·Instruct 칩)·칩 Enter 뒤 포커스 유지·설명 보기·규칙 보기 토글·한글 조합 중 Enter 무시",
    skip: index =>
      needsLongDocument(index) ??
      ((index.options?.itemsMax ?? 0) >= 120
        ? null
        : "pnpm mock:gen -- --items-max 120 데이터가 필요함"),
    run: values,
  },
  {
    name: "draft",
    description:
      "임시 저장 디바운스·pagehide flush·복원 배너·첫 편집에 이전 초안 버림·복원·버리기",
    run: draft,
  },
  {
    name: "save",
    description:
      "저장 왕복: 문자열 칸 편집 → 저장됨 → 새로 고침 뒤 유지 → 되돌려 저장 → base_version 낮춘 본문은 충돌 → mock reset(--mock)",
    run: saveRoundTrip,
  },
  {
    name: "history",
    description:
      "변경 이력 시트: 지원하지 않으면 버튼·결과 메뉴 비활성 + 이유, 목록·묶음 상자·번호 쪽(--history 60 이상, 100 행 넘으면 다음 블록)·묶음 모두 불러오기·상세·JSON·편집에 불러오기·닫기 포커스·저장 뒤 현재 반영본·오래된 순과 최초 원본 행(한 번 클릭·트레이 출처·받는 동안 경합·접기·닫기·429 카운트다운·문서 구성 영향)·결과 메뉴 필터·429 대기·같은 저장 머리줄·저장 뒤 보던 쪽 유지 → mock reset(--mock)",
    allowConsole: /status of 429/,
    skip: index =>
      index.history?.rows ? null : "--history 1 이상 데이터가 필요함",
    run: history,
  },
  {
    name: "highlights-retry",
    description: "하이라이트 묶음 첫 응답 500 → 실패 문구·다시 시도 → 복구",
    allowConsole: /status of 500/,
    skip: needsLongDocument,
    run: highlightsRetry,
  },
  {
    name: "parse",
    description:
      "여러 파일 Job(--files 3): 둘째 이후 파일 문서의 Parse 목록 항목 → 뷰어 영역이 같은 id 로 선택, 뷰어 영역 → 목록 항목 선택·스크롤, 표 요소는 허용 목록으로 만든 표(원문 전환·클릭 선택)",
    skip: index =>
      (index.files?.length ?? 0) < 2
        ? "입력 파일이 하나 — pnpm mock:gen -- --files 3 데이터가 필요함"
        : null,
    run: parse,
  },
  {
    name: "small-job",
    description: `${LARGE_JOB_ABOVE} 쪽 이하 Job(--pages 12): 전체 띠·비가상 목록·페이지 탭`,
    skip: index => (isLarge(index) ? `${LARGE_JOB_ABOVE} 쪽 넘는 Job` : null),
    run: smallJob,
  },
  {
    name: "header-actions-one-row",
    description: `머리 줄 grid 가 되는 가장 좁은 폭(${HEADER_GRID_FROM})에서 탭이 가장 많은 문서: 저장·검수 완료가 한 줄이고 첫 Step 탭과 같은 줄(탭 이름 말줄임), 끝나면 뷰포트 복원`,
    run: headerActionsOneRow,
  },
  {
    name: "review-status",
    description:
      'Collection 상세: 기본 보기의 진행 기준 문구·Job 수 정보 버튼·"표에 보이는 행" 보조 줄(검수 상태 필터를 걸면 사라짐), 검수 열 배지·진행 현황·정렬 select·검수 상태 필터(검수 완료 → 전체)',
    skip: needsJobs,
    run: reviewStatus,
  },
  {
    name: "collections-list",
    description:
      "Collection 목록 출처 필터: 두 출처를 함께 고름(메뉴 유지) → 주소 source=a,b · 트리거 강조, 고르기 전후 머리 칸 폭 같음(±1px), 전체로 비우면 주소에서 빠짐",
    run: collectionsList,
  },
  {
    name: "shell",
    description:
      '앱 껍데기: 검수할 단계를 모두 끄면 모든 Step 탭 + 안내(저장소 원복), 최근 검수 기록·홈 대시보드, 전체 JSON 편집 창 기준 줄(현재 편집본 → 원본), 변경 유무별 이탈 확인(깨끗하면 창·Dialog 없음, 변경이 있으면 홈 링크·언어·돌아가기가 앱 Dialog — 머무르면 그대로·메뉴 다시 열림, 돌아가기에서 나가기면 상세로), Collection 상세 머리·진행 카드, 설정 토글 즉시 반영과 저장소 JSON, 큐 안에서 "완료하면 다음 Job 열기" 끄기',
    run: shell,
  },
  {
    name: "lineage",
    description:
      "언어 전환 뒤 목록 query 유지, Collection 관계 보기(토글, 연결, 강조, 주소 유지)",
    run: runLineage,
  },
  {
    name: "queue",
    description:
      "차례로 검수하기 → 큐 바(이전, 다음, 남은 수)·완료 안내가 상단 바 자리에(새로 고침 첫 프레임 포함) → 완료 후 다음(배지 → 안내 → 주소 순서, 안내 잔류 뒤 사라짐) → 값 고친 채 다음 Job 이면 앱 Dialog(머무르기 → 그대로, 나가기 → 다음 Job) → 값 고친 채 ⌘/Ctrl+Enter 저장하고 다음 → 마지막에서 새 Job 확인 → 되돌리기 → 상세 배지, 진행 막대, 필터 → mock reset(--mock)",
    skip: needsExactQueueJobs,
    run: queue,
  },
  {
    name: "ui-kit-demo",
    description:
      "Core 데모 화면(REVIEW_UI_KIT_DEMO=1 일 때만, 꺼져 있으면 SKIP): item 섹션 렌더, 읽기 전용 view 에 편집 조작부 0·격자 메뉴 비활성, 편집 view 의 나누기가 읽기 전용 view 에 반영, 문서 위치 대화 상자 순서 변경·포커스 복귀, 판정 칸, 규칙 카드, 페이지 옮기기 요청·실패 문구, Parse 표 허용 목록·클릭, Instruct 칩 선택·Provider 밖 표식 제거, 저장·완료 줄 저장·충돌 문구, 문서 라벨 select 변경·입력 Enter 확정, 배열 표 오류·경고·＋·칸 Enter 다음 칸·되돌리기",
    run: uiKitDemo,
  },
];
