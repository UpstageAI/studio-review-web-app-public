// 시드 고정 mock 데이터 생성기. 순수 함수만 두고 파일 입출력은 generate.mjs 가 맡는다.
//
// 만드는 것: Collection 1 · Job 1(`--jobs N` 이면 복제본 N−1 개 더) · 입력 파일 1~n(합계 `pages` 쪽, 파일 그룹 1~n) · Classify 보기(문서 ≈ 30 개,
// index 10 에 60 쪽 긴 문서, 문서는 파일 그룹 경계를 넘지 않음; `split: false` 면 그룹마다 문서 하나) · 문서마다 Extract(송장형)·Validate 결과 · Job 응답(Parse 요소 쪽당 ≈ 60,
// Extract provenance 좌표, Instruct 출력 3 개) · 파일 응답(`GET /v2/files/{id}` 모양).
// 좌표·페이지 규칙은 실제 파이프라인 응답과 같다: Job 응답의 `page` 는 입력 파일을 `input_index` 순으로
// 이어 붙인 1-based 병합 페이지, 파일 응답의 요소 `page` 는 파일 로컬 1-based.
// 쪽마다 heading·list·table·footer·figure 고정 요소 12 개를 먼저 깔고 나머지를 paragraph 로 채우므로
// `elementsPerPage` 는 12 이상이어야 한다(그보다 작으면 쪽당 요소 수가 옵션과 어긋난다).
import { makePngBase64 } from "./png.mjs";
import { createRng, mixSeed } from "./prng.mjs";
import { contentKey, structureContent } from "./revisions.mjs";
import { heading, sentence, words } from "./text.mjs";

export const DEFAULT_OPTIONS = Object.freeze({
  seed: 1,
  files: 1,
  /** 파일 그룹 수. 파일을 앞에서부터 균등하게 나눠 담는다(`files` 이하). */
  groups: 1,
  pages: 200,
  elementsPerPage: 60,
  /** Extract 결과 `items[]` 의 최대 행 수(문서마다 `min(5, itemsMax)`‥`itemsMax` 에서 고른다). */
  itemsMax: 30,
  copiedFiles: false,
  /**
   * Classify 가 문서를 나눈 것처럼 그룹 안을 여러 문서로 자를지. `false` 면 그룹마다 문서 하나(그룹 파일
   * 전체) — split 이 아닌 Classify 의 서버 baseline 과 같은 모양이고 긴 문서도 없다.
   */
  split: true,
  /** Job 수. 2 이상이면 Job 1 을 복제해 `job_mock_0002..N` 을 만든다(같은 입력 파일을 다시 실행한 Job). */
  jobs: 1,
  /**
   * Job 1 에 미리 심는 변경 이력의 version 수(값 대상 R1 기준, 0..1000). `0` 이면 이력 없음. 기본 3 →
   * 7 행, 60 → 64 행.
   */
  history: 3,
});

/** 파일·페이지 URL 의 포트 자리. 서버가 실제 포트로 바꾼다. */
export const PORT_TOKEN = "{port}";

export const MOCK_IDS = Object.freeze({
  collection: "scol_mock_0001",
  job: "job_mock_0001",
  config: "cfg_mock_1",
  agent: "agt_mock_1",
  group: "grp_1",
  project: "proj_mock_1",
});

const LABELS = ["invoice", "receipt", "contract", "other"];
const LONG_DOCUMENT_INDEX = 10;
const LONG_DOCUMENT_PAGES = 60;
const LONG_DOCUMENT_ID = "doc_long";
const LONG_DOCUMENT_LABEL = "contract";
/** 쪽당 고정 요소 수: heading 2 · list 4 · table 4 · footer 1 (+ 짝수 쪽 figure 1). 나머지는 paragraph. */
const FIXED_ELEMENTS_PER_PAGE = 12;
/** 생성 시각을 쓰지 않고 고정한다(같은 seed → 같은 바이트). 2026-09-30 경 unix 초. */
const CREATED_AT = 1_790_000_000;
/** seed 이력 version 수 상한. */
const MAX_HISTORY = 1000;
const SVG_WIDTH = 1240;
const SVG_HEIGHT = 1754;
const SVG_LINES = 40;

const VENDORS = [
  "Acme Supplies Co.",
  "Northwind Traders",
  "Blue Harbor Logistics",
  "Summit Office Systems",
  "Riverside Printing",
  "Granite Facilities Ltd.",
];
const BUYERS = [
  "Hanbit Manufacturing",
  "Daon Retail Group",
  "Seoyeon Consulting",
  "Mirae Energy",
  "Noeul Healthcare",
];

const INVOICE_SCHEMA = {
  type: "object",
  required: [
    "invoice_no",
    "issue_date",
    "due_date",
    "vendor",
    "vendor_tax_id",
    "buyer",
    "currency",
    "subtotal",
    "tax",
    "total",
    "paid",
    "memo",
    "items",
  ],
  properties: {
    invoice_no: { type: "string", title: "Invoice No." },
    issue_date: { type: "string", description: "YYYY-MM-DD" },
    due_date: { type: "string", description: "YYYY-MM-DD" },
    vendor: { type: "string" },
    vendor_tax_id: { type: "string" },
    buyer: { type: "string" },
    currency: { type: "string", enum: ["KRW", "USD"] },
    subtotal: { type: "number" },
    tax: { type: "number" },
    total: { type: "number" },
    paid: { type: "boolean" },
    memo: { anyOf: [{ type: "string", maxLength: 500 }, { type: "null" }] },
    items: {
      type: "array",
      items: {
        type: "object",
        required: ["description", "qty", "unit_price", "amount"],
        properties: {
          description: { type: "string" },
          qty: { type: "integer" },
          unit_price: { type: "number" },
          amount: { type: "number" },
        },
      },
    },
  },
};

const VERDICT_SCHEMA = { type: "string", enum: ["green", "yellow", "red"] };

/** 파이프라인의 Parse Step 기본 이름. */
const PARSE_STEP_NAME = "Document Parse";

/** `extraExtractStep` 이 켜졌을 때 더하는 두 번째 Extract Step. 같은 타입이 둘이라 탭에 이름이 보인다. */
const EXTRA_EXTRACT_STEP_ID = "st_extract_2";
const EXTRA_EXTRACT_STEP_NAME =
  "Information Extract - 진료비 영수증 세부 항목 추출";

function stepsFor(configId, extraExtractStep) {
  const steps = {
    st_parse: {
      config_id: configId,
      name: PARSE_STEP_NAME,
      type: "document-parse",
    },
    st_classify: {
      config_id: configId,
      name: "Classify - 문서 분류",
      type: "document-classify",
      labels: LABELS,
    },
    st_extract: {
      config_id: configId,
      name: "Information Extract - 청구서",
      type: "information-extract",
      schema: INVOICE_SCHEMA,
    },
    st_validate: {
      config_id: configId,
      name: "Validate - 금액 검증",
      type: "validate",
      schema: VERDICT_SCHEMA,
    },
    st_instruct: {
      config_id: configId,
      name: "Instruct - 요약",
      type: "instruct",
    },
  };
  if (!extraExtractStep) return steps;
  // 실행 순서(= 탭 순서)대로 첫 Extract 바로 뒤에 둔다.
  const { st_validate, st_instruct, ...head } = steps;
  return {
    ...head,
    [EXTRA_EXTRACT_STEP_ID]: {
      config_id: configId,
      name: EXTRA_EXTRACT_STEP_NAME,
      type: "information-extract",
      schema: INVOICE_SCHEMA,
    },
    st_validate,
    st_instruct,
  };
}

function normalizeOptions(options) {
  const merged = { ...DEFAULT_OPTIONS, ...options };
  for (const key of [
    "seed",
    "files",
    "groups",
    "pages",
    "elementsPerPage",
    "itemsMax",
    "jobs",
    "history",
  ]) {
    if (!Number.isInteger(merged[key]) || merged[key] < 0) {
      throw new TypeError(`options.${key} must be a non-negative integer`);
    }
  }
  if (merged.files < 1) throw new RangeError("options.files must be >= 1");
  if (merged.groups < 1) throw new RangeError("options.groups must be >= 1");
  if (merged.groups > merged.files) {
    throw new RangeError("options.groups must be <= options.files");
  }
  if (merged.jobs < 1) throw new RangeError("options.jobs must be >= 1");
  if (merged.history > MAX_HISTORY) {
    throw new RangeError(`options.history must be <= ${MAX_HISTORY}`);
  }
  if (merged.itemsMax < 1) {
    throw new RangeError("options.itemsMax must be >= 1");
  }
  if (merged.elementsPerPage < FIXED_ELEMENTS_PER_PAGE) {
    throw new RangeError(
      `options.elementsPerPage must be >= ${FIXED_ELEMENTS_PER_PAGE} (each page starts with ${FIXED_ELEMENTS_PER_PAGE} fixed elements)`,
    );
  }
  if (merged.pages < merged.files) {
    throw new RangeError("options.pages must be >= options.files");
  }
  merged.copiedFiles = Boolean(merged.copiedFiles);
  merged.split = Boolean(merged.split);
  // 꺼져 있으면 키를 두지 않는다 — 옵션을 모르던 때와 출력(`options` 포함) 바이트가 같다.
  if (merged.extraExtractStep) merged.extraExtractStep = true;
  else delete merged.extraExtractStep;
  return merged;
}

/** 파일별 페이지 수. 1 개면 전부, 2 개면 60/40, 3 개면 50/30/20, 그 밖은 균등(나머지는 첫 파일). */
function filePageCounts(files, pages) {
  if (files === 1) return [pages];
  const weights =
    files === 2
      ? [0.6, 0.4]
      : files === 3
        ? [0.5, 0.3, 0.2]
        : Array.from({ length: files }, () => 1 / files);
  const counts = weights.map(weight => Math.max(1, Math.floor(pages * weight)));
  counts[0] += pages - counts.reduce((sum, count) => sum + count, 0);
  return counts;
}

/**
 * 병합 페이지 `1..total` 을 연속 문서로 자른다. 길이는 60 % → 1–3, 30 % → 4–8, 10 % → 9–20 쪽이고,
 * index 10 에는 60 쪽 긴 문서를 둔다(남은 페이지가 모자라면 생략). 마지막 문서는 남은 페이지만큼.
 * `boundaries`(오름차순 병합 페이지 번호)는 문서가 시작해야 하는 쪽 — 그 앞에서 문서를 끊는다(파일
 * 그룹 경계). 잘려 60 쪽이 못 된 긴 문서 자리는 보통 문서로 둔다.
 */
function splitDocuments(rng, total, boundaries = []) {
  const ranges = [];
  let next = 1;
  let longIndex = null;
  while (next <= total) {
    const remaining = total - next + 1;
    const boundary = boundaries.find(page => page > next);
    let length;
    let isLong = false;
    if (
      ranges.length === LONG_DOCUMENT_INDEX &&
      remaining >= LONG_DOCUMENT_PAGES
    ) {
      length = LONG_DOCUMENT_PAGES;
      isLong = true;
    } else {
      const roll = rng.next();
      length =
        roll < 0.6
          ? rng.int(1, 3)
          : roll < 0.9
            ? rng.int(4, 8)
            : rng.int(9, 20);
    }
    length = Math.min(length, remaining);
    if (boundary !== undefined) length = Math.min(length, boundary - next);
    if (isLong && length === LONG_DOCUMENT_PAGES) longIndex = ranges.length;
    ranges.push({ first: next, last: next + length - 1 });
    next += length;
  }
  return { ranges, longIndex };
}

/**
 * 그룹마다 문서 하나 — `boundaries`(그룹 시작 쪽, 오름차순)로 `1..total` 을 끊는다. 긴 문서는 없다.
 */
function wholeGroupDocuments(total, boundaries = []) {
  const starts = [1, ...boundaries.filter(page => page > 1 && page <= total)];
  const ranges = starts.map((first, index) => ({
    first,
    last: index + 1 < starts.length ? starts[index + 1] - 1 : total,
  }));
  return { ranges, longIndex: null };
}

/** 병합 범위 → 파일별 로컬 `source_files`. */
function sourcesFor(fileSpace, first, last) {
  const out = [];
  for (const file of fileSpace) {
    const start = Math.max(first, file.offset + 1);
    const end = Math.min(last, file.offset + file.num_pages);
    if (start <= end) {
      out.push({
        file_ref: file.file_ref,
        page_ranges: [[start - file.offset, end - file.offset]],
      });
    }
  }
  return out;
}

/** 0–1 정규화 사각형(위에서 아래로 시계 방향 네 점). */
function box(x0, y0, x1, y1) {
  const r = value => Math.round(value * 10_000) / 10_000;
  return [
    { x: r(x0), y: r(y0) },
    { x: r(x1), y: r(y0) },
    { x: r(x1), y: r(y1) },
    { x: r(x0), y: r(y1) },
  ];
}

function isoDate(dayOfYear) {
  const date = new Date(Date.UTC(2026, 0, 1 + dayOfYear));
  return date.toISOString().slice(0, 10);
}

/**
 * 송장형 Extract 결과와 같은 트리의 provenance(leaf `{_value, page, coordinates, confidence}`).
 * `items` 행 수는 `min(5, itemsMax)`‥`itemsMax`(기본 30; 50 을 넘기면 값 패널의 배열 묶음 경로를 밟는다).
 */
function invoiceFor(rng, index, docPages, itemsMax) {
  const currency = rng.chance(0.7) ? "KRW" : "USD";
  const unit = currency === "KRW" ? 1 : 100;
  const money = minor => minor / unit;
  const rowCount = rng.int(Math.min(5, itemsMax), itemsMax);
  const items = [];
  let subtotalMinor = 0;
  for (let i = 0; i < rowCount; i += 1) {
    const qty = rng.int(1, 20);
    const unitMinor =
      currency === "KRW" ? rng.int(1, 500) * 1000 : rng.int(100, 50_000);
    const amountMinor = qty * unitMinor;
    subtotalMinor += amountMinor;
    items.push({
      description: heading(rng),
      qty,
      unit_price: money(unitMinor),
      amount: money(amountMinor),
    });
  }
  const taxMinor = Math.round(subtotalMinor / 10);
  const issueDay = rng.int(0, 330);
  const content = {
    invoice_no: `INV-2026-${String(index + 1).padStart(4, "0")}`,
    issue_date: isoDate(issueDay),
    due_date: isoDate(issueDay + 30),
    vendor: rng.pick(VENDORS),
    vendor_tax_id: `${rng.int(100, 999)}-${rng.int(10, 99)}-${rng.int(10_000, 99_999)}`,
    buyer: rng.pick(BUYERS),
    currency,
    subtotal: money(subtotalMinor),
    tax: money(taxMinor),
    total: money(subtotalMinor + taxMinor),
    paid: rng.chance(0.5),
    memo: rng.chance(0.3) ? sentence(rng) : null,
    items,
  };

  const pageAt = ordinal => docPages[Math.min(ordinal, docPages.length - 1)];
  const leaf = (value, page, y, x0, x1) => ({
    _value: value,
    page,
    coordinates: box(x0, y, x1, y + 0.02),
    confidence: Math.round((0.8 + rng.next() * 0.19) * 100) / 100,
  });
  const head = pageAt(0);
  const headerLeaf = (key, row, x0 = 0.1, x1 = 0.55) =>
    leaf(content[key], head, 0.08 + row * 0.035, x0, x1);
  const provenance = {
    invoice_no: headerLeaf("invoice_no", 0),
    issue_date: headerLeaf("issue_date", 1),
    due_date: headerLeaf("due_date", 2),
    vendor: headerLeaf("vendor", 3),
    vendor_tax_id: headerLeaf("vendor_tax_id", 4),
    buyer: headerLeaf("buyer", 5),
    currency: headerLeaf("currency", 6, 0.6, 0.75),
    subtotal: headerLeaf("subtotal", 7, 0.6, 0.9),
    tax: headerLeaf("tax", 8, 0.6, 0.9),
    total: headerLeaf("total", 9, 0.6, 0.9),
    paid: headerLeaf("paid", 10, 0.6, 0.75),
    items: items.map((row, i) => {
      // 15 행마다 다음 페이지(문서가 한 쪽이면 같은 쪽).
      const page = pageAt(1 + Math.floor(i / 15));
      const y = 0.2 + (i % 15) * 0.045;
      return {
        description: leaf(row.description, page, y, 0.08, 0.5),
        qty: leaf(row.qty, page, y, 0.52, 0.6),
        unit_price: leaf(row.unit_price, page, y, 0.62, 0.76),
        amount: leaf(row.amount, page, y, 0.78, 0.92),
      };
    }),
  };
  if (content.memo !== null) {
    provenance.memo = leaf(
      content.memo,
      pageAt(docPages.length - 1),
      0.9,
      0.08,
      0.92,
    );
  }
  return { content, provenance };
}

function verdictFor(rng) {
  const roll = rng.next();
  const verdict = roll < 0.7 ? "green" : roll < 0.9 ? "yellow" : "red";
  const checks = [
    {
      name: "total_matches_sum",
      severity: "error",
      passed: verdict !== "red",
      reason:
        verdict !== "red"
          ? "total == subtotal + tax"
          : "total != subtotal + tax",
    },
    {
      name: "due_after_issue",
      severity: "warning",
      passed: verdict === "green",
      reason: "due_date >= issue_date",
    },
  ];
  return { verdict, checks };
}

/**
 * Job 응답 Validate 출력의 `additional_values`. 실제 서버처럼 check 마다 Config 조건 트리를 옮긴
 * `conditions`(피연산자에 실행 값 `value`)를 싣는다. 결과(`checks`)와 이름·심각도·통과 여부가 같다.
 */
function validateAdditional(verdict, checks, extract, extractStepName) {
  const content = extract.content;
  const ref = (field, extra = {}) => ({
    nodeType: "extract",
    nodeName: extractStepName,
    field,
    ...extra,
  });
  const itemsSum = (content.items ?? []).reduce(
    (sum, item) => sum + (typeof item.amount === "number" ? item.amount : 0),
    0,
  );
  const [sumCheck, dueCheck] = checks;
  const conditions = {
    total_matches_sum: {
      kind: "group",
      logic: "and",
      passed: sumCheck.passed,
      conditions: [
        {
          kind: "condition",
          passed: true,
          left: { ...ref("total"), value: content.total ?? null },
          operator: "filled",
          right: null,
        },
        {
          kind: "condition",
          passed: sumCheck.passed,
          left: {
            ...ref("items", { rowField: "amount" }),
            agg: "sum",
            value: itemsSum,
          },
          operator: "eq",
          right: { ...ref("subtotal"), value: content.subtotal ?? null },
        },
      ],
    },
    due_after_issue: {
      kind: "group",
      logic: "and",
      passed: dueCheck.passed,
      conditions: [
        {
          kind: "group",
          logic: "or",
          passed: dueCheck.passed,
          conditions: [
            {
              kind: "condition",
              passed: false,
              left: { ...ref("due_date"), value: content.due_date ?? null },
              operator: "empty",
              right: null,
            },
            {
              kind: "condition",
              passed: dueCheck.passed,
              left: { ...ref("due_date"), value: content.due_date ?? null },
              operator: "gte",
              right: {
                ...ref("issue_date"),
                value: content.issue_date ?? null,
              },
            },
          ],
        },
        {
          kind: "condition",
          passed: dueCheck.passed,
          left: { ...ref("total", { attr: "confidence" }), value: 0.97 },
          operator: "gte",
          right: { const: 0.8, value: 0.8 },
        },
      ],
    },
  };
  return {
    verdict,
    checks: checks.map(check => ({
      ...check,
      conditions: conditions[check.name],
    })),
  };
}

const escapeHtml = text =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 한 쪽의 요소 종류 순서. 짝수 쪽에는 figure 하나. */
function pageCategories(page, paragraphs) {
  const half = Math.floor(paragraphs / 2);
  const repeat = (category, count) =>
    Array.from({ length: count }, () => category);
  return [
    "heading1",
    ...repeat("paragraph", half),
    "list",
    "list",
    "table",
    "table",
    ...(page % 2 === 0 ? ["figure"] : []),
    "heading1",
    ...repeat("paragraph", paragraphs - half),
    "list",
    "list",
    "table",
    "table",
    "footer",
  ];
}

function elementContent(rng, category, page, totalPages) {
  switch (category) {
    case "heading1": {
      const text = heading(rng);
      return {
        text,
        markdown: `# ${text}`,
        html: `<h1>${escapeHtml(text)}</h1>`,
      };
    }
    case "list": {
      const lines = [
        sentence(rng, 2, 5),
        sentence(rng, 2, 5),
        sentence(rng, 2, 5),
      ];
      return {
        text: lines.join("\n"),
        markdown: lines.map(line => `- ${line}`).join("\n"),
        html: `<ul>${lines.map(line => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`,
      };
    }
    case "table": {
      const rows = Array.from({ length: 3 }, () => words(rng, 3));
      return {
        text: rows.map(row => `| ${row.join(" | ")} |`).join("\n"),
        markdown: [
          `| ${rows[0].join(" | ")} |`,
          "| --- | --- | --- |",
          ...rows.slice(1).map(row => `| ${row.join(" | ")} |`),
        ].join("\n"),
        html: tableHtml(rows),
      };
    }
    case "figure":
      return {
        text: "![image](/image/placeholder)",
        markdown: "![image](/image/placeholder)",
        html: '<figure><img alt="" data-category="figure" /></figure>',
      };
    case "footer": {
      const text = `Page ${page} of ${totalPages}`;
      return { text, markdown: text, html: `<footer>${text}</footer>` };
    }
    default: {
      const text = sentence(rng, 8, 20);
      return { text, markdown: text, html: `<p>${escapeHtml(text)}</p>` };
    }
  }
}

/**
 * 표 요소의 `html`. 실데이터처럼 표에 `id`·`style` 이 붙고 첫 행 첫 칸은 `colspan`, 마지막 행 앞
 * 칸에는 `onclick`, 뒤 칸에는 링크·그림(`alt` 에 글자)이 있다. 표 앞의 `<script>` 와 이벤트·`javascript:`
 * 속성은 Parse 탭이 표를 허용 목록으로만 그리는지 스모크가 `window.__parseTableXss` 로 확인하는 조각이다.
 * 난수는 쓰지 않는다(`rows` 만 쓴다 — 나머지 생성 데이터가 바뀌지 않게).
 */
function tableHtml(rows) {
  const xss = "window.__parseTableXss=1";
  const last = rows.length - 1;
  const cells = (row, at) =>
    row
      .map((cell, column) => {
        const text = escapeHtml(cell);
        if (at === 0 && column === 0) return `<td colspan="2">${text}</td>`;
        if (at === last && column === 0) {
          return `<td onclick="${xss}">${text}</td>`;
        }
        if (at === last && column === row.length - 1) {
          return `<td><a href="javascript:${xss}">${text}</a> <img src="x" onerror="${xss}" alt="${text}"></td>`;
        }
        return `<td>${text}</td>`;
      })
      .join("");
  return `<script>${xss}</script><table id="mock-table" style="font-size:20px">${rows
    .map((row, at) => `<tr>${cells(row, at)}</tr>`)
    .join("")}</table>`;
}

function elementSpan(category) {
  switch (category) {
    case "heading1":
      return [0.08, 0.6];
    case "list":
      return [0.1, 0.8];
    case "figure":
      return [0.25, 0.75];
    case "footer":
      return [0.4, 0.6];
    default:
      return [0.08, 0.92];
  }
}

/** 병합 페이지 전체의 Parse 요소(전역 순번 id, 병합 `page`). */
function parseElements(rng, seed, totalPages, elementsPerPage) {
  const paragraphs = Math.max(0, elementsPerPage - FIXED_ELEMENTS_PER_PAGE);
  const elements = [];
  let nextId = 0;
  for (let page = 1; page <= totalPages; page += 1) {
    const categories = pageCategories(page, paragraphs);
    const slot = 0.88 / categories.length;
    categories.forEach((category, index) => {
      const [x0, x1] = elementSpan(category);
      const y0 = 0.06 + index * slot;
      const element = {
        id: nextId,
        page,
        category,
        content: elementContent(rng, category, page, totalPages),
        coordinates: box(x0, y0, x1, y0 + slot * 0.85),
      };
      if (category === "figure") {
        element.base64_encoding = makePngBase64({
          width: 32,
          height: 32,
          seed: mixSeed(seed, 0x66, page, nextId),
        });
      }
      elements.push(element);
      nextId += 1;
    });
  }
  return elements;
}

/** Parse 요소를 파일 로컬 페이지로 바꾼다(`base64_encoding` 은 뺀다 — 파일 응답에는 그림이 없다). */
function localElements(elements, file) {
  const pages = Array.from({ length: file.num_pages }, () => []);
  for (const element of elements) {
    const local = element.page - file.offset;
    if (local < 1 || local > file.num_pages) continue;
    const copy = { ...element, page: local };
    delete copy.base64_encoding;
    pages[local - 1].push(copy);
  }
  return pages;
}

function message(id, stepId, stepType, model, content) {
  return {
    type: "message",
    id,
    step_id: stepId,
    step_type: stepType,
    model,
    content,
  };
}

function outputText(text, additionalValues) {
  const item = { type: "output_text", text };
  if (additionalValues !== undefined) item.additional_values = additionalValues;
  return item;
}

/** Instruct 출력 하나(문서 하나의 요약 + 인용 3 개). */
function instructItem(doc, extract, headingElement, totalLeaf, issueLeaf) {
  const text = [
    `## ${doc.label} 문서 요약`,
    "",
    `이 문서는 ${doc.last - doc.first + 1}쪽이며 첫 제목은 "${headingElement.content.text}" 입니다.【†1】`,
    `청구 총액은 ${extract.content.total.toLocaleString("en-US")} ${extract.content.currency} 입니다.【†2】`,
    `발행일은 ${extract.content.issue_date} 입니다.【†3】`,
  ].join("\n");
  return outputText(
    JSON.stringify(text),
    JSON.stringify({
      enum: doc.label,
      previous_step_name: PARSE_STEP_NAME,
      page_ranges: [[doc.first, doc.last]],
      citations: [
        {
          index: 1,
          source_type: "parse",
          source_ref: String(headingElement.id),
          page: headingElement.page,
          coordinates: headingElement.coordinates,
        },
        {
          index: 2,
          source_type: "extract",
          source_ref: "total",
          page: totalLeaf.page,
          coordinates: totalLeaf.coordinates,
        },
        {
          index: 3,
          source_type: "extract",
          source_ref: "issue_date",
          page: issueLeaf.page,
          coordinates: issueLeaf.coordinates,
        },
      ],
    }),
  );
}

/**
 * mock 데이터 한 벌. 같은 `options` 면 같은 결과.
 *
 * `options.extraExtractStep`(기본 꺼짐)을 켜면 같은 타입의 두 번째 Extract Step `st_extract_2` 와 문서마다
 * 그 결과 `occ_ext2_<n>`(첫 Extract 결과 복사, 이력 없음)를 더한다 — 탭에 긴 Step 이름이 보이는 데이터.
 *
 * 반환: `{ options, ids, steps, documents, longDocumentIndex, totalPages, collection, capabilities,
 * sourceJobRow, sourceJobFiles, reviewDocument, jobResponse, files, extraJobs, history }`. `extraJobs[]` 는 `jobs` 가 2 이상일 때
 * Job 2..N 의 `{ ids: { job }, sourceJobRow, sourceJobFiles, reviewDocument, jobResponse }`(Job 1 복제, 1 시간씩 뒤). `files[]` 는 upstream 파일 응답
 * (`image_url`·`file_url` 의 포트는 `PORT_TOKEN`), `documents[]` 는 문서 요약(병합 범위·파일 그룹 id).
 * `history` 는 Job 1 의 seed 변경 이력 `{ job, machine: { results, structure }, operations, records, contents }`
 * (`contents` 키는 `revisions.mjs` 의 `contentKey`, `history: 0` 이면 `null`). 편집되지 않은 대상의
 * `base_version` 은 0(기계 출력)이다.
 */
export function generateDataset(options = {}) {
  const opts = normalizeOptions(options);
  const rng = createRng(mixSeed(opts.seed, 0x01));
  const ids = { ...MOCK_IDS };
  const steps = stepsFor(ids.config, opts.extraExtractStep);
  const totalPages = opts.pages;

  // 파일 공간(병합 페이지 offset)
  const counts = filePageCounts(opts.files, totalPages);
  let offset = 0;
  const fileSpace = counts.map((numPages, index) => {
    const file = {
      file_ref: `${ids.job}#${index}`,
      file_id: `file_mock_${String(index + 1).padStart(4, "0")}`,
      name: `mock-${numPages}p.pdf`,
      num_pages: numPages,
      input_index: index,
      offset,
    };
    offset += numPages;
    return file;
  });

  // 파일 그룹: 파일 k(0부터)는 그룹 floor(k × groups / files). 첫 그룹 id 는 `MOCK_IDS.group`.
  const groupIdOf = file =>
    `grp_${Math.floor((file.input_index * opts.groups) / opts.files) + 1}`;
  const groupFiles = new Map();
  for (const file of fileSpace) {
    const groupId = groupIdOf(file);
    if (!groupFiles.has(groupId)) groupFiles.set(groupId, []);
    groupFiles.get(groupId).push(file);
  }
  const boundaries = [...groupFiles.values()]
    .slice(1)
    .map(files => files[0].offset + 1);
  const groupAt = page =>
    groupIdOf(
      fileSpace.find(
        file => page > file.offset && page <= file.offset + file.num_pages,
      ),
    );

  // 문서 배치
  const { ranges, longIndex } = opts.split
    ? splitDocuments(rng, totalPages, boundaries)
    : wholeGroupDocuments(totalPages, boundaries);
  const documents = ranges.map((range, index) => {
    const isLong = index === longIndex;
    return {
      document_id: isLong ? LONG_DOCUMENT_ID : `doc_${index + 1}`,
      label: isLong ? LONG_DOCUMENT_LABEL : LABELS[index % LABELS.length],
      group: groupAt(range.first),
      first: range.first,
      last: range.last,
      pages: range.last - range.first + 1,
    };
  });
  const layout = {
    step_id: "st_classify",
    base_version: 0,
    content: {
      documents: documents.map(doc => ({
        document_id: doc.document_id,
        group_id: doc.group,
        label: doc.label,
        source_files: sourcesFor(fileSpace, doc.first, doc.last),
      })),
    },
  };

  // 결과(Extract·Validate) + Job 응답 메시지
  const results = [];
  const extractMessages = [];
  const validateMessages = [];
  const extracts = [];
  documents.forEach((doc, index) => {
    const docPages = Array.from({ length: doc.pages }, (_, i) => doc.first + i);
    const extract = invoiceFor(rng, index, docPages, opts.itemsMax);
    extracts.push(extract);
    const extractId = `occ_ext_${index + 1}`;
    const validateId = `occ_val_${index + 1}`;
    const { verdict, checks } = verdictFor(rng);
    results.push(
      {
        id: extractId,
        step_id: "st_extract",
        base_version: 0,
        content: extract.content,
        document_ids: [doc.document_id],
      },
      {
        id: validateId,
        step_id: "st_validate",
        base_version: 0,
        content: verdict,
        checks,
        document_ids: [doc.document_id],
      },
    );
    extractMessages.push(
      message(
        extractId,
        "st_extract",
        "information-extract",
        steps.st_extract.name,
        [
          outputText(
            JSON.stringify(extract.content),
            JSON.stringify(extract.provenance),
          ),
        ],
      ),
    );
    validateMessages.push(
      message(validateId, "st_validate", "validate", steps.st_validate.name, [
        outputText(
          JSON.stringify(verdict),
          JSON.stringify(
            validateAdditional(verdict, checks, extract, steps.st_extract.name),
          ),
        ),
      ]),
    );
  });

  // 두 번째 Extract Step(옵션). 난수를 더 쓰지 않도록 첫 Extract 의 내용·provenance 를 그대로 복사한다.
  const extraResults = [];
  const extraExtractMessages = [];
  if (opts.extraExtractStep) {
    documents.forEach((doc, index) => {
      const extract = extracts[index];
      const id = `occ_ext2_${index + 1}`;
      extraResults.push({
        id,
        step_id: EXTRA_EXTRACT_STEP_ID,
        base_version: 0,
        content: cloneJson(extract.content),
        document_ids: [doc.document_id],
      });
      extraExtractMessages.push(
        message(
          id,
          EXTRA_EXTRACT_STEP_ID,
          "information-extract",
          EXTRA_EXTRACT_STEP_NAME,
          [
            outputText(
              JSON.stringify(extract.content),
              JSON.stringify(extract.provenance),
            ),
          ],
        ),
      );
    });
  }

  // Classify 출력(실행 순서에 들어가 Step 탭 순서가 실제 응답과 같아진다). 화면은 내용을 읽지 않는다.
  const classifyMessage = message(
    "res_classify",
    "st_classify",
    "document-classify",
    steps.st_classify.name,
    documents.map(doc =>
      outputText(
        JSON.stringify(doc.label),
        JSON.stringify({
          document_id: doc.document_id,
          page_ranges: [[doc.first, doc.last]],
        }),
      ),
    ),
  );

  // Parse 요소(병합 페이지)
  const elements = parseElements(
    rng,
    opts.seed,
    totalPages,
    opts.elementsPerPage,
  );
  const parseMessage = message(
    "res_parse",
    "st_parse",
    "document-parse",
    steps.st_parse.name,
    [
      outputText(
        JSON.stringify({
          api: "2.0",
          model: "document-parse-mock",
          elements,
          content: { html: "", markdown: "", text: "" },
          usage: { pages: totalPages },
        }),
        "{}",
      ),
    ],
  );

  // Instruct 출력: 문서 #1·#2·#3
  const instructMessage = message(
    "res_instruct",
    "st_instruct",
    "instruct",
    steps.st_instruct.name,
    documents.slice(0, 3).map((doc, index) => {
      const headingElement = elements.find(
        element =>
          element.page === doc.first && element.category === "heading1",
      );
      const { provenance } = extracts[index];
      return instructItem(
        doc,
        extracts[index],
        headingElement,
        provenance.total,
        provenance.issue_date,
      );
    }),
  );

  const jobResponse = {
    id: ids.job,
    object: "response",
    status: "completed",
    model: "mock-workflow",
    created_at: CREATED_AT,
    output: [
      parseMessage,
      classifyMessage,
      ...extractMessages,
      ...extraExtractMessages,
      ...validateMessages,
      instructMessage,
    ],
  };

  const reviewDocument = {
    format: "collection-results/11",
    collection_id: ids.collection,
    configs: { [ids.config]: { agent_id: ids.agent } },
    steps,
    jobs: [
      {
        id: ids.job,
        file_groups: {
          base_version: 0,
          groups: [...groupFiles].map(([groupId, files]) => ({
            group_id: groupId,
            files: files.map(file => ({
              file_ref: file.file_ref,
              file_id: file.file_id,
              name: file.name,
              num_pages: file.num_pages,
              input_index: file.input_index,
            })),
            layout_step_id: "st_classify",
          })),
          excluded_pages: [],
          excluded_documents: [],
        },
        output: [layout, ...results, ...extraResults],
      },
    ],
  };

  // 파일 응답
  const files = fileSpace.map(file => {
    const perPage = opts.copiedFiles ? null : localElements(elements, file);
    return {
      id: file.file_id,
      object: "file",
      filename: file.name,
      status: "READY",
      purpose: "document",
      num_pages: file.num_pages,
      bytes: file.num_pages * 48_000,
      content_type: "application/pdf",
      created_at: CREATED_AT,
      file_url: `http://127.0.0.1:${PORT_TOKEN}/files/${file.file_id}/original.pdf`,
      pages: Array.from({ length: file.num_pages }, (_, i) => ({
        id: `${file.file_id}_p${i + 1}`,
        idx: i + 1,
        image_url: `http://127.0.0.1:${PORT_TOKEN}/pages/${file.file_id}/${i + 1}.svg`,
        elements: perPage ? JSON.stringify(perPage[i]) : "[]",
      })),
    };
  });

  const jobFiles = files.map(file => ({
    id: file.id,
    filename: file.filename,
    content_type: file.content_type,
    bytes: file.bytes,
    num_pages: file.num_pages,
  }));
  const collection = {
    id: ids.collection,
    object: "search_collection",
    name: `Mock collection (${totalPages}p)`,
    description: "Seeded mock data for the review screen",
    kind: "documents",
    is_default: false,
    default_for_agent_id: null,
    listed: true,
    source: { type: "agent_export", label: "Mock agent" },
    total_job_count: opts.jobs,
    // 짝수 번째 Job 은 이전 Config 로 돈 것으로 둔다(아래 extraJobs). latest 행은 홀수 번째뿐.
    latest_config_job_count: Math.ceil(opts.jobs / 2),
    pending_job_count: 0,
    failed_job_count: 0,
    last_result_at: CREATED_AT,
    file_count: files.length,
    project: { id: ids.project, name: "Mock project" },
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    latest_config_ids: [ids.config],
    latest_config_id: ids.config,
    head_binding: null,
  };
  const capabilities = {
    object: "search_collection.review_capabilities",
    result_source_supported: true,
    selective_import_supported: false,
    format: "collection-results/11",
    max_jobs: 100,
    max_files: 100,
    max_pages: 10_000,
    max_groups: 1_000,
    max_changed_results: 10_000,
    max_unit_jobs: 100,
    max_import_bytes: 471_859_200,
    max_import_part_bytes: 8_388_608,
    max_import_parts: 10_000,
    max_inline_import_bytes: 8_388_608,
    max_document_jobs: 100,
    max_document_bytes: 16_777_216,
    apply_modes: ["manual", "auto"],
    max_export_part_bytes: 471_859_200,
    editable_states: ["present", "stale"],
    job_delete_supported: false,
    max_delete_jobs: 100,
    revisions_supported: true,
  };
  const sourceJobRow = {
    object: "search_collection.job_row",
    job_id: ids.job,
    status: "completed",
    config: {
      id: ids.config,
      external_id: null,
      name: "Mock config",
      is_latest: true,
    },
    files: jobFiles,
    file_count: jobFiles.length,
    error: null,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
  };
  const sourceJobFiles = {
    object: "list",
    data: jobFiles.map(file => ({
      id: file.id,
      filename: file.filename,
      num_pages: file.num_pages,
    })),
    has_more: false,
    first_id: jobFiles[0]?.id ?? null,
    last_id: jobFiles[jobFiles.length - 1]?.id ?? null,
    first_cursor: null,
    last_cursor: null,
  };

  const base = { sourceJobRow, sourceJobFiles, reviewDocument, jobResponse };
  // 짝수 번째 Job(`job_mock_0002`·`0004`…)은 이전 Config 로 돈 것으로 둬 "latest Config 만" 토글이
  // mock 에서도 행을 거르게 한다.
  const extraJobs = Array.from({ length: opts.jobs - 1 }, (_, i) => {
    const n = i + 2;
    const job = cloneJob(base, ids.job, jobIdAt(n), (i + 1) * 3600);
    if (n % 2 === 0) {
      job.sourceJobRow.config = {
        id: `${ids.config}_prev`,
        external_id: null,
        name: "Mock config (previous)",
        is_latest: false,
      };
    }
    return job;
  });

  // 복제(이력 없음, base_version 전부 0)를 만든 뒤에 Job 1 에만 이력을 심는다. 난수는 따로 써서 위의
  // 생성 순서를 바꾸지 않는다.
  const history = seedHistory(
    { reviewDocument, documents, fileSpace, collectionId: ids.collection },
    opts,
    createRng(mixSeed(opts.seed, 0x07)),
  );

  return {
    options: opts,
    ids,
    steps,
    documents,
    longDocumentIndex: longIndex,
    totalPages,
    collection,
    capabilities,
    sourceJobRow,
    sourceJobFiles,
    reviewDocument,
    jobResponse,
    files,
    extraJobs,
    history,
  };
}

const cloneJson = value => JSON.parse(JSON.stringify(value));
const HOUR = 3600;

/**
 * Job 1 에 변경 이력을 심는다(`history` 가 0 이면 `null`). 대상과 version:
 * R1 `occ_ext_{min(2,N)}`(n 개) · R2 `occ_ext_3`(N ≥ 3, min(n,2) 개) · V `occ_val_2`(N ≥ 2, 1 개) ·
 * S 구조(1 개). 저장 묶음은 `rvop_seed_1`(S·R1·R2·V v1) · `rvop_seed_2`(R1·R2 v2) · `rvop_seed_k`(R1 vk)이고
 * n ≥ 3 이면 마지막 묶음은 다른 Collection 의 migration 이다. 각 대상의 마지막 version 내용은 지금 문서
 * 내용과 같고(값을 바꾸지 않는다), 문서의 `base_version` 을 그 version 으로 올린다. 기계 출력(version 0)은
 * 행이 아니라 `machine` 에 둔다. 사람이 판정을 고치면 근거가 사라지므로 V 의 `checks` 는 지운다.
 */
function seedHistory(
  { reviewDocument, documents, fileSpace, collectionId },
  opts,
  rng,
) {
  const n = opts.history;
  if (n === 0) return null;
  const job = reviewDocument.jobs[0];
  const count = documents.length;
  const resultById = id => job.output.find(item => item.id === id);
  const layout = job.output.find(item => item.step_id === "st_classify");
  const labelOf = new Map(
    layout.content.documents.map(doc => [doc.document_id, doc.label]),
  );
  const linkedDocs = result =>
    result.document_ids.map(documentId => ({
      document_id: documentId,
      label: labelOf.get(documentId) ?? null,
      field_group: "",
    }));

  const r1 = resultById(`occ_ext_${Math.min(2, count)}`);
  const r2 = count >= 3 ? resultById("occ_ext_3") : null;
  const v = count >= 2 ? resultById("occ_val_2") : null;

  // 대상별 version 내용(index k-1 = vk). 마지막 = 지금 내용.
  const otherVendor = vendor => {
    const choices = VENDORS.filter(name => name !== vendor);
    return rng.pick(choices);
  };
  const r1Variant = k => {
    const next = cloneJson(r1.content);
    next.vendor = otherVendor(r1.content.vendor);
    next.total = r1.content.total + (n - k) * 1000;
    next.items[0].qty += 1;
    return next;
  };
  const r1Versions = Array.from({ length: n }, (_, i) =>
    i + 1 < n ? r1Variant(i + 1) : cloneJson(r1.content),
  );
  const r1Machine = cloneJson(n > 1 ? r1Versions[0] : r1Variant(1));
  const describedRow = r1Machine.items[Math.min(1, r1Machine.items.length - 1)];
  describedRow.description = `${describedRow.description} (OCR)`;
  r1Machine.items.push({
    description: "Duplicated line",
    qty: 1,
    unit_price: 1000,
    amount: 1000,
  });

  let r2Versions = [];
  let r2Machine = null;
  if (r2) {
    const reviewedMemo =
      r2.content.memo === "Checked against the delivery note"
        ? "Checked against the purchase order"
        : "Checked against the delivery note";
    r2Versions =
      n >= 2
        ? [
            { ...cloneJson(r2.content), memo: reviewedMemo },
            cloneJson(r2.content),
          ]
        : [cloneJson(r2.content)];
    r2Machine = cloneJson(r2Versions[0]);
    r2Machine.invoice_no = r2Machine.invoice_no.replace(/0/, "O");
  }

  let vMachine = null;
  if (v) vMachine = v.content === "green" ? "yellow" : "green";

  // 구조: v1 = 지금 구조. 기계 출력은 doc_2 라벨이 다르고, doc_3·doc_4 가 같은 그룹이고 doc_4 가 2 쪽
  // 이상이면 doc_4 첫 쪽이 doc_3 에 붙어 있다.
  const structureV1 = structureContent(job);
  const structureMachine = cloneJson(structureV1);
  const relabeled = structureMachine.documents[Math.min(1, count - 1)];
  relabeled.label =
    LABELS[(LABELS.indexOf(relabeled.label) + 1) % LABELS.length];
  if (
    count >= 4 &&
    documents[2].group === documents[3].group &&
    documents[3].pages >= 2
  ) {
    const [third, fourth] = [documents[2], documents[3]];
    structureMachine.documents[2].source_files = sourcesFor(
      fileSpace,
      third.first,
      fourth.first,
    );
    structureMachine.documents[3].source_files = sourcesFor(
      fileSpace,
      fourth.first + 1,
      fourth.last,
    );
  }

  // 저장 묶음과 행
  const operations = [];
  const records = [];
  /** @type {Record<string, unknown>} */
  const contents = {};
  let seq = 0;
  const addOperation = (k, changes) => {
    const migration = n >= 3 && k === n;
    const operation = {
      id: `rvop_seed_${k}`,
      kind: migration ? "migration" : "import",
      change_count: changes.length,
      collection_id: migration ? "scol_mock_prev" : collectionId,
      from_this_collection: !migration,
      reason: migration ? "schema upgrade" : null,
      client_reference: null,
    };
    operations.push(operation);
    for (const change of changes) {
      seq += 1;
      records.push({
        id: `rvn_seed_${String(seq).padStart(4, "0")}`,
        type: change.type,
        target: change.target,
        version: change.version,
        base_version: change.version - 1,
        operation_id: operation.id,
        published_at: CREATED_AT + k * HOUR,
        origin: null,
        documents: change.documents,
      });
      contents[contentKey(change.type, change.target, change.version)] =
        change.content;
    }
  };
  const resultChange = (result, version, content) => ({
    type: "result",
    target: result.id,
    version,
    content,
    documents: linkedDocs(result),
  });

  const first = [
    {
      type: "structure",
      target: job.id,
      version: 1,
      content: structureV1,
      documents: null,
    },
    resultChange(r1, 1, r1Versions[0]),
  ];
  if (r2) first.push(resultChange(r2, 1, r2Versions[0]));
  if (v) first.push(resultChange(v, 1, v.content));
  addOperation(1, first);
  if (n >= 2) {
    const second = [resultChange(r1, 2, r1Versions[1])];
    if (r2) second.push(resultChange(r2, 2, r2Versions[1]));
    addOperation(2, second);
  }
  for (let k = 3; k <= n; k += 1) {
    addOperation(k, [resultChange(r1, k, r1Versions[k - 1])]);
  }

  // 문서 version 을 이력의 마지막 version 으로
  r1.base_version = n;
  if (r2) r2.base_version = r2Versions.length;
  if (v) {
    v.base_version = 1;
    delete v.checks;
  }
  job.file_groups.base_version = 1;
  for (const item of job.output) {
    if (!Object.hasOwn(item, "id")) item.base_version = 1;
  }

  /** @type {Record<string, unknown>} */
  const machineResults = { [r1.id]: r1Machine };
  if (r2) machineResults[r2.id] = r2Machine;
  if (v) machineResults[v.id] = vMachine;
  return {
    job: job.id,
    machine: { results: machineResults, structure: structureMachine },
    operations,
    records,
    contents,
  };
}

/** `n` 번째(1-based) mock Job id. */
const jobIdAt = n => `job_mock_${String(n).padStart(4, "0")}`;

/**
 * Job 1 의 행·파일 목록·검수 문서·응답을 깊은 복사해 다른 Job id 로 바꾼다. 문자열 값이 원래 Job id 면
 * 새 id 로, `{원래 id}#` 로 시작하면(`file_ref`) 접두만 바꾼다. 파일 id 는 그대로 공유한다. 행·응답 시각은
 * `secondsLater` 만큼 뒤로 민다.
 */
function cloneJob(base, fromJobId, toJobId, secondsLater) {
  const prefix = `${fromJobId}#`;
  const copy = value => {
    if (typeof value === "string") {
      if (value === fromJobId) return toJobId;
      return value.startsWith(prefix)
        ? `${toJobId}#${value.slice(prefix.length)}`
        : value;
    }
    if (Array.isArray(value)) return value.map(copy);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, copy(item)]),
      );
    }
    return value;
  };
  const at = CREATED_AT + secondsLater;
  const sourceJobRow = copy(base.sourceJobRow);
  sourceJobRow.created_at = at;
  sourceJobRow.updated_at = at;
  const jobResponse = copy(base.jobResponse);
  jobResponse.created_at = at;
  return {
    ids: { job: toJobId },
    sourceJobRow,
    sourceJobFiles: copy(base.sourceJobFiles),
    reviewDocument: copy(base.reviewDocument),
    jobResponse,
  };
}

const escapeXml = text =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * 페이지 이미지 SVG(1240×1754, 흰 배경, 머리글 "파일명 · page n / N", 본문 40 줄). seed·파일·페이지로
 * 결정되며 파일이 없거나 페이지가 범위 밖이면 `null`.
 */
export function pageSvg(dataset, fileId, page) {
  const index = dataset.files.findIndex(file => file.id === fileId);
  if (index < 0) return null;
  const file = dataset.files[index];
  if (!Number.isInteger(page) || page < 1 || page > file.num_pages) return null;
  const rng = createRng(mixSeed(dataset.options.seed, 0x5f, index, page));
  const lines = [];
  for (let i = 0; i < SVG_LINES; i += 1) {
    const y = 180 + i * 36;
    lines.push(
      `<text x="80" y="${y}" font-size="22" fill="#444">${escapeXml(sentence(rng, 8, 14))}</text>`,
    );
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}">` +
    `<rect width="${SVG_WIDTH}" height="${SVG_HEIGHT}" fill="#ffffff"/>` +
    `<rect x="40" y="40" width="${SVG_WIDTH - 80}" height="${SVG_HEIGHT - 80}" fill="none" stroke="#e5e7eb" stroke-width="2"/>` +
    `<g font-family="Helvetica, Arial, sans-serif">` +
    `<text x="80" y="100" font-size="30" font-weight="bold" fill="#111">${escapeXml(file.filename)} · page ${page} / ${file.num_pages}</text>` +
    lines.join("") +
    `<text x="${SVG_WIDTH / 2}" y="${SVG_HEIGHT - 50}" font-size="20" fill="#888" text-anchor="middle">${page}</text>` +
    `</g></svg>`
  );
}
