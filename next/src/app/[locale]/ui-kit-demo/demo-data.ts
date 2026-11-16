import type { DocumentListItem } from "@/components/studio-ui-kit/document-list";
import type { MovePagesTarget } from "@/components/studio-ui-kit/move-pages-dialog";
import type { PageMark } from "@/components/studio-ui-kit/page-position-bar";
import type {
  PageRangeFileOption,
  PageRangeRow,
} from "@/components/studio-ui-kit/page-range-editor";
import type {
  StructureDocument,
  StructureLoosePage,
  StructurePage,
} from "@/components/studio-ui-kit/structure-editor";
import type {
  RuleOperand,
  ValidateRule,
} from "@/components/studio-ui-kit/validate-rules";
import type { VerdictCheck } from "@/components/studio-ui-kit/verdict-segment";

// Core 데모 화면의 고정 데이터와 문서 구성 편집. 검수 모델·BFF 를 쓰지 않고, 구성 편집은 이 배열을
// 직접 바꾼다(데모용 최소 규칙 — 앱의 저장 판정·검증과 같지 않다).

// ── 위치 바 ────────────────────────────────────────────────

export const POSITION_PAGE_COUNT = 24;

export const POSITION_MARKS: readonly PageMark[] = [
  { index: 2, kind: "changed" },
  { index: 3, kind: "changed" },
  { index: 9, kind: "issue" },
  { index: 15, kind: "noImage" },
  { index: 16, kind: "noImage" },
  { index: 21, kind: "changed" },
];

// ── 문서 목록 ──────────────────────────────────────────────

export const LIST_ITEMS: readonly DocumentListItem[] = [
  {
    id: "l1",
    label: "Invoice",
    pageCount: 3,
    status: "changed",
    visited: true,
    groupLabel: "invoices.pdf",
  },
  {
    id: "l2",
    label: "Receipt",
    pageCount: 1,
    flag: "danger",
    visited: true,
    groupLabel: "invoices.pdf",
  },
  {
    id: "l3",
    label: null,
    pageCount: 2,
    flag: "warning",
    visited: false,
    groupLabel: "invoices.pdf",
  },
  {
    id: "l4",
    label: "Contract",
    pageCount: 6,
    status: "recheck",
    visited: false,
    groupLabel: "contracts.pdf",
  },
  {
    id: "l5",
    label: "Appendix",
    pageCount: 2,
    status: "locked",
    visited: false,
    groupLabel: "contracts.pdf",
  },
  {
    id: "l6",
    label: "Cover letter",
    pageCount: 1,
    status: "excluded",
    visited: true,
    groupLabel: "contracts.pdf",
  },
];

export const LIST_EXCLUDED_PAGES = 2;

// ── 값 위젯 ────────────────────────────────────────────────

/** 데모 값: JSON 스칼라 그대로(앱은 정밀 숫자를 따로 감싸지만 데모는 `number` 로 충분하다). */
export type DemoScalar = string | number | boolean | null;

export const LONG_TEXT = Array.from(
  { length: 40 },
  (_, i) => `Line ${i + 1}: the quick brown fox jumps over the lazy dog.`,
).join("\n");

// ── 문서 구성 ──────────────────────────────────────────────

const FILE_COLORS: Record<string, string> = {
  "invoices.pdf": "#93c5fd",
  "contracts.pdf": "#fcd34d",
};

/** 파일마다 색이 다른 페이지 그림(SVG data URI). 페이지 번호를 가운데에 쓴다. */
function thumbnail(fileRef: string, page: number): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="160" viewBox="0 0 120 160">` +
    `<rect width="120" height="160" fill="${FILE_COLORS[fileRef] ?? "#d4d4d8"}"/>` +
    `<rect x="16" y="20" width="88" height="6" fill="#ffffff" opacity="0.7"/>` +
    `<rect x="16" y="34" width="64" height="6" fill="#ffffff" opacity="0.7"/>` +
    `<text x="60" y="110" font-family="sans-serif" font-size="40" text-anchor="middle" fill="#1f2937">${page}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function page(
  fileRef: string,
  n: number,
  extra: Partial<StructurePage> = {},
): StructurePage {
  return {
    key: `${fileRef}#${n}`,
    fileRef,
    page: n,
    thumbnailUrl: thumbnail(fileRef, n),
    ...extra,
  };
}

export const LABEL_CHOICES = ["Invoice", "Receipt", "Contract"] as const;

export interface StructureState {
  documents: readonly StructureDocument[];
  excluded: readonly StructureLoosePage[];
  /** 나누기·새 문서로 만든 문서의 다음 번호. */
  nextId: number;
}

/**
 * invoices.pdf(g1): 문서 3 개(자유 입력 라벨 · 설정 라벨 select · 설정에 없는 라벨), 제외 페이지 1 장.
 * contracts.pdf(g2): 문서 2 개(그중 하나는 잠김, 한 장은 이미지 없음).
 */
export const INITIAL_STRUCTURE: StructureState = {
  documents: [
    {
      documentId: "d1",
      label: "Invoice",
      labelChoices: LABEL_CHOICES,
      groupId: "g1",
      pages: [
        page("invoices.pdf", 1),
        page("invoices.pdf", 2),
        page("invoices.pdf", 3),
      ],
    },
    {
      documentId: "d2",
      label: "Receipt",
      labelChoices: LABEL_CHOICES,
      groupId: "g1",
      pages: [page("invoices.pdf", 4), page("invoices.pdf", 5)],
    },
    {
      documentId: "d3",
      label: "Memo",
      labelChoices: LABEL_CHOICES,
      labelNotInConfig: true,
      groupId: "g1",
      pages: [page("invoices.pdf", 7)],
    },
    {
      documentId: "d4",
      label: "Contract",
      groupId: "g2",
      pages: [
        page("contracts.pdf", 1),
        page("contracts.pdf", 2, { thumbnailUrl: null }),
        page("contracts.pdf", 3),
      ],
    },
    {
      documentId: "d5",
      label: "Appendix",
      groupId: "g2",
      locked: true,
      pages: [page("contracts.pdf", 4)],
    },
  ],
  excluded: [{ ...page("invoices.pdf", 6), groupId: "g1" }],
  nextId: 6,
};

/** 파일 그룹이 바뀌는 문서 위치(그 문서 뒤에 경계). */
export function groupBoundaries(
  documents: readonly StructureDocument[],
): number[] {
  const after: number[] = [];
  for (let i = 0; i + 1 < documents.length; i += 1) {
    if (documents[i].groupId !== documents[i + 1].groupId) after.push(i);
  }
  return after;
}

function insertAt<T>(items: readonly T[], index: number, item: T): T[] {
  const next = [...items];
  next.splice(Math.max(0, Math.min(index, next.length)), 0, item);
  return next;
}

function moveWithin<T>(items: readonly T[], from: number, to: number): T[] {
  if (from < 0) return [...items];
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}

function updateDocument(
  state: StructureState,
  documentId: string,
  update: (document: StructureDocument) => StructureDocument,
): StructureState {
  return {
    ...state,
    documents: state.documents.map(document =>
      document.documentId === documentId ? update(document) : document,
    ),
  };
}

/** 페이지가 빈 문서는 없앤다(빈 띠를 남기지 않는다). */
function dropEmpty(state: StructureState): StructureState {
  return {
    ...state,
    documents: state.documents.filter(document => document.pages.length > 0),
  };
}

function takePage(
  state: StructureState,
  documentId: string,
  pageKey: string,
): { state: StructureState; page: StructurePage | null } {
  const document = state.documents.find(d => d.documentId === documentId);
  const taken = document?.pages.find(p => p.key === pageKey) ?? null;
  if (!taken) return { state, page: null };
  return {
    state: updateDocument(state, documentId, d => ({
      ...d,
      pages: d.pages.filter(p => p.key !== pageKey),
    })),
    page: taken,
  };
}

function looseToPage({
  key,
  fileRef,
  page,
  thumbnailUrl,
  issue,
}: StructureLoosePage): StructurePage {
  return { key, fileRef, page, thumbnailUrl, issue };
}

/** 같은 그룹 마지막 문서 뒤 위치. */
function endOfGroup(state: StructureState, groupId: string): number {
  let at = state.documents.length;
  state.documents.forEach((document, index) => {
    if (document.groupId === groupId) at = index + 1;
  });
  return at;
}

export const structureEdits = {
  reorderPage(
    state: StructureState,
    documentId: string,
    pageKey: string,
    toIndex: number,
  ): StructureState {
    return updateDocument(state, documentId, d => ({
      ...d,
      pages: moveWithin(
        d.pages,
        d.pages.findIndex(p => p.key === pageKey),
        toIndex,
      ),
    }));
  },

  movePage(
    state: StructureState,
    fromDocumentId: string,
    pageKey: string,
    toDocumentId: string,
    toIndex: number,
  ): StructureState {
    const { state: without, page: moved } = takePage(
      state,
      fromDocumentId,
      pageKey,
    );
    if (!moved) return state;
    return dropEmpty(
      updateDocument(without, toDocumentId, d => ({
        ...d,
        pages: insertAt(d.pages, toIndex, moved),
      })),
    );
  },

  split(
    state: StructureState,
    documentId: string,
    afterPageKey: string,
  ): StructureState {
    const index = state.documents.findIndex(d => d.documentId === documentId);
    const source = state.documents[index];
    if (!source) return state;
    const cut = source.pages.findIndex(p => p.key === afterPageKey) + 1;
    if (cut <= 0 || cut >= source.pages.length) return state;
    const created: StructureDocument = {
      documentId: `d${state.nextId}`,
      label: null,
      labelChoices: source.labelChoices,
      groupId: source.groupId,
      pages: source.pages.slice(cut),
    };
    const documents = [...state.documents];
    documents.splice(
      index,
      1,
      { ...source, pages: source.pages.slice(0, cut) },
      created,
    );
    return { ...state, documents, nextId: state.nextId + 1 };
  },

  mergeInto(
    state: StructureState,
    fromDocumentId: string,
    intoDocumentId: string,
  ): StructureState {
    const from = state.documents.find(d => d.documentId === fromDocumentId);
    if (!from || fromDocumentId === intoDocumentId) return state;
    const merged = updateDocument(state, intoDocumentId, d => ({
      ...d,
      pages: [...d.pages, ...from.pages],
    }));
    return {
      ...merged,
      documents: merged.documents.filter(d => d.documentId !== fromDocumentId),
    };
  },

  reorderDocument(
    state: StructureState,
    documentId: string,
    toIndex: number,
  ): StructureState {
    return {
      ...state,
      documents: moveWithin(
        state.documents,
        state.documents.findIndex(d => d.documentId === documentId),
        toIndex,
      ),
    };
  },

  excludePage(
    state: StructureState,
    documentId: string,
    pageKey: string,
  ): StructureState {
    const document = state.documents.find(d => d.documentId === documentId);
    const { state: without, page: removed } = takePage(
      state,
      documentId,
      pageKey,
    );
    if (!document || !removed) return state;
    return dropEmpty({
      ...without,
      excluded: [
        ...without.excluded,
        { ...removed, groupId: document.groupId },
      ],
    });
  },

  restorePage(
    state: StructureState,
    pageKey: string,
    toDocumentId: string,
    toIndex: number,
  ): StructureState {
    const loose = state.excluded.find(p => p.key === pageKey);
    if (!loose) return state;
    return updateDocument(
      { ...state, excluded: state.excluded.filter(p => p.key !== pageKey) },
      toDocumentId,
      d => ({ ...d, pages: insertAt(d.pages, toIndex, looseToPage(loose)) }),
    );
  },

  restoreToNewDocument(state: StructureState, pageKey: string): StructureState {
    const loose = state.excluded.find(p => p.key === pageKey);
    if (!loose) return state;
    const created: StructureDocument = {
      documentId: `d${state.nextId}`,
      label: null,
      groupId: loose.groupId,
      pages: [looseToPage(loose)],
    };
    return {
      documents: insertAt(
        state.documents,
        endOfGroup(state, loose.groupId),
        created,
      ),
      excluded: state.excluded.filter(p => p.key !== pageKey),
      nextId: state.nextId + 1,
    };
  },

  labelChange(
    state: StructureState,
    documentId: string,
    label: string | null,
  ): StructureState {
    return updateDocument(state, documentId, d => ({
      ...d,
      label,
      labelNotInConfig:
        label !== null &&
        d.labelChoices !== undefined &&
        !d.labelChoices.includes(label),
    }));
  },

  setDocumentExcluded(
    state: StructureState,
    documentId: string,
    excluded: boolean,
  ): StructureState {
    return updateDocument(state, documentId, d => ({ ...d, excluded }));
  },
};

/** `index` 문서(0-based)가 든 같은 파일 그룹이 이어진 구간(1-based, 양끝 포함) — 문서 위치 대화 상자의 범위. */
export function groupBlock(
  documents: readonly StructureDocument[],
  index: number,
): { first: number; last: number } {
  const groupId = documents[index]?.groupId;
  let first = index;
  let last = index;
  while (first > 0 && documents[first - 1]?.groupId === groupId) first -= 1;
  while (
    last + 1 < documents.length &&
    documents[last + 1]?.groupId === groupId
  ) {
    last += 1;
  }
  return { first: first + 1, last: last + 1 };
}

// ── 판정 ───────────────────────────────────────────────────

export const VERDICT_CHECKS: readonly VerdictCheck[] = [
  {
    name: "total_matches_items",
    severity: "error",
    passed: true,
    reason: "Total equals the sum of the line items.",
  },
  {
    name: "due_date_filled",
    severity: "warning",
    passed: false,
    reason: "Due date is empty.",
  },
];

// ── 페이지 범위 ────────────────────────────────────────────

export const RANGE_FILES: readonly PageRangeFileOption[] = [
  { fileRef: "invoices.pdf", name: "invoices.pdf" },
  { fileRef: "contracts.pdf", name: "contracts.pdf" },
];

export const INITIAL_RANGES: readonly PageRangeRow[] = [
  { fileRef: "invoices.pdf", text: "1-3" },
  { fileRef: "contracts.pdf", text: "2, 4" },
];

/** `"1-3, 5"` 꼴(쉼표로 이은 번호 또는 범위). 데모용 최소 검사 — 파일 장수는 보지 않는다. */
const RANGE_PATTERN = /^\s*\d+(\s*-\s*\d+)?(\s*,\s*\d+(\s*-\s*\d+)?)*\s*$/;

export const isRangeText = (text: string) => RANGE_PATTERN.test(text);

// ── 페이지 옮기기 ──────────────────────────────────────────

export const MOVE_TARGETS: readonly MovePagesTarget[] = [
  { documentId: "d2", index: 0, label: "Receipt", pageCount: 2 },
  { documentId: "d3", index: 1, label: null, pageCount: 1 },
  { documentId: "d4", index: 2, label: "Contract", pageCount: 3 },
];

// ── Parse 표 ──────────────────────────────────────────────

/**
 * 병합 칸·그림·걸러질 태그가 든 표 HTML. `script`·`iframe`·`onclick`·`style` 은 허용 목록 변환에서 빠지고,
 * 그림은 대체 글자로만 남는다(고정 문자열 — 실행되지 않는다).
 */
export const PARSE_TABLE_HTML = [
  '<table style="color: red">',
  '<thead><tr><th rowspan="2">Item</th><th colspan="2">Amount</th></tr>',
  "<tr><th>Net</th><th>Tax</th></tr></thead>",
  "<tbody>",
  '<tr onclick="alert(1)"><td>Widget</td><td>100.00</td><td>10.00</td></tr>',
  '<tr><td>Gadget <img src="https://example.invalid/x.png" alt="gadget photo"></td><td colspan="2">250.00 (tax included)</td></tr>',
  "</tbody>",
  "</table>",
  "<script>window.__demoInjected = true;</script>",
  '<iframe src="https://example.invalid/"></iframe>',
].join("");

// ── Validate 규칙 ─────────────────────────────────────────

const operand = (overrides: Partial<RuleOperand>): RuleOperand => ({
  nodeType: null,
  nodeName: null,
  field: null,
  rowField: null,
  attr: null,
  agg: null,
  scope: null,
  path: null,
  matchSide: null,
  matchOutputKey: null,
  ...overrides,
});

const field = (name: string, extra: Partial<RuleOperand> = {}) =>
  operand({ nodeType: "extract", nodeName: "Extract", field: name, ...extra });

const constant = (value: unknown) => operand({ constant: value });

export const VALIDATE_RULES: readonly ValidateRule[] = [
  {
    name: "total_matches_items",
    severity: "error",
    condition: {
      kind: "condition",
      left: field("total"),
      operator: "eq",
      right: field("items", { rowField: "amount", agg: "sum" }),
    },
  },
  {
    name: "due_date_and_vendor",
    severity: "warning",
    condition: {
      kind: "group",
      logic: "and",
      conditions: [
        {
          kind: "condition",
          left: field("due_date"),
          operator: "filled",
          right: null,
        },
        {
          kind: "group",
          logic: "or",
          conditions: [
            {
              kind: "condition",
              left: field("vendor"),
              operator: "contains",
              right: constant("Corp"),
            },
            {
              kind: "condition",
              left: field("vendor", { attr: "confidence" }),
              operator: "gte",
              right: constant(0.8),
            },
          ],
        },
      ],
    },
  },
  {
    name: "every_amount_positive",
    severity: "warning",
    condition: {
      kind: "condition",
      left: field("items", { rowField: "amount", scope: "all" }),
      operator: "gt",
      right: constant(0),
    },
  },
  {
    name: "unknown_operator_kept",
    severity: "warning",
    condition: {
      kind: "condition",
      left: field("currency"),
      operator: "one_of",
      right: constant(["USD", "EUR"]),
    },
  },
  { name: "unreadable_condition", severity: "error", condition: null },
];

// ── Instruct ───────────────────────────────────────────────

/** 인용 표식 두 형식(`【†n】`·`[†n]`). 3 번은 위치가 없는 인용이다. */
export const INSTRUCT_TEXT = [
  "## Summary",
  "The invoice total is **1,280.50 USD**【†1】 and the due date is missing[†2].",
  "The vendor name appears only in the footer【†3】.",
  "",
  "| Field | Value |",
  "| --- | --- |",
  "| Vendor | ACME Corp. |",
  "| Total | 1,280.50 |",
  "",
  "See [the format guide](https://example.com/guide) for details.",
].join("\n");

/** 위치를 알 수 없는 인용 번호(칩은 누를 수 없고 툴팁만). */
export const INSTRUCT_NO_LOCATION = 3;

export const INSTRUCT_STRUCTURED = {
  decision: "Approve with a note【†1】",
  reasons: ["Total matches the line items[†1].", "Due date is missing【†2】."],
  amounts: { net: 1180.5, tax: 100, currency: "USD" },
  approved: true,
  reviewer: null,
  tags: [],
};
