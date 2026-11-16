import { isJsonObject, type JsonObject, type JsonValue } from "./json";
import {
  DOCUMENT_ID_PATTERN,
  canEditResult,
  documentsOf,
  findLayout,
  groupOf,
  groupOfFile,
  isMultiLayout,
  isValidGroupId,
  layouts as layoutsOf,
} from "./layout";
import {
  MAX_DOCUMENT_PAGES,
  compressPages,
  flattenPages,
  flattenSources,
  isValidPageRange,
  pageKey,
} from "./pages";
import type { JsonPath } from "./schema";
import {
  isResult,
  type FileGroup,
  type FileGroups,
  type Layout,
  type OutputItem,
  type PageRange,
  type PageRef,
  type Result,
  type ReviewDocumentEntry,
  type ReviewJob,
  type SourceRange,
} from "./types";

/**
 * 편집 연산이 적용되지 않은 이유. replay 가 전제가 깨진 변경 항목을 버릴 때도
 * 같은 값을 쓴다(host 가 "함께 되돌림" 사유로 번역).
 */
export type DropReason =
  | "document_missing"
  | "page_not_in_document"
  | "result_missing"
  | "path_missing"
  | "result_not_editable"
  /** 다른 그룹으로 옮기려 했거나, 옮길 그룹의 문서 구성 Step(`layout_step_id`)이 다르다. */
  | "group_mismatch"
  | "target_missing"
  | "already_excluded"
  | "multi_layout_unsupported"
  | "index_out_of_range"
  /** 새 문서·새 그룹 id 가 형식에 맞지 않거나 이미 있다. */
  | "invalid_document_id"
  /** `set_key` 의 키가 이미 있다. */
  | "path_exists"
  /**
   * 되돌린 항목이 바꾼 배열·키·하위 트리 안을 고친 뒤 항목이라 함께 뺐다. 또는 되돌린
   * 항목이 페이지 집합을 바꾼 문서의 페이지 범위를 나중에 다시 적은 항목이라 함께 뺐다.
   */
  | "depends_on_reverted"
  /**
   * 지정한 페이지 범위의 모양이 틀렸다: 빈 목록·범위 없는 파일·정수 아님·
   * `first > last`·1 미만·`MAX_PAGE_NUMBER` 초과·문서 페이지 상한 초과·자기 그룹 파일이 아님.
   */
  | "invalid_page_ranges"
  /** 옮기려는 파일과 다른 파일을 함께 쓰는 문서가 있어 파일을 통째로 옮길 수 없다. */
  | "mixed_file_document";

export type EditResult<T = ReviewJob> =
  | { readonly ok: true; readonly job: T }
  | { readonly ok: false; readonly reason: DropReason };

const fail = (reason: DropReason): { ok: false; reason: DropReason } => ({
  ok: false,
  reason,
});

// ---------------------------------------------------------------------------
// 값
// ---------------------------------------------------------------------------

function isScalar(value: JsonValue): boolean {
  return !Array.isArray(value) && !isJsonObject(value);
}

const INDEX_TOKEN = /^(0|[1-9]\d*)$/;

/** `path` 의 값. 배열은 정규 index 토큰·범위 안, 객체는 자기 키만. 없으면 `undefined`. */
export function nodeAt(
  content: JsonValue,
  path: JsonPath,
): JsonValue | undefined {
  let current: JsonValue = content;
  for (const token of path) {
    if (Array.isArray(current)) {
      if (!INDEX_TOKEN.test(token)) return undefined;
      const index = Number(token);
      if (index >= current.length) return undefined;
      current = current[index] ?? null;
    } else if (isJsonObject(current) && Object.hasOwn(current, token)) {
      current = current[token] ?? null;
    } else return undefined;
  }
  return current;
}

/** `path` 의 부모 경로와 마지막 토큰. `[]` 이면 `null`. */
export function parentOf(
  path: JsonPath,
): { readonly parent: JsonPath; readonly token: string } | null {
  if (path.length === 0) return null;
  return {
    parent: path.slice(0, -1),
    token: path[path.length - 1] as string,
  };
}

/** 키 순서를 지키며 객체를 만든다. `__proto__` 같은 키도 데이터로 둔다. */
function objectFrom(
  entries: readonly (readonly [string, JsonValue])[],
): JsonObject {
  const out: JsonObject = {};
  for (const [key, value] of entries) {
    Object.defineProperty(out, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

/**
 * `path` 의 값을 `update(그 값)` 로 바꾼 새 값(경로 위 컨테이너만 복사, 나머지는
 * 공유). 경로는 `nodeAt` 으로 확인된 것.
 */
function updateAt(
  node: JsonValue,
  path: JsonPath,
  update: (current: JsonValue) => JsonValue,
): JsonValue {
  if (path.length === 0) return update(node);
  const [token, ...rest] = path as [string, ...string[]];
  if (Array.isArray(node)) {
    const index = Number(token);
    const copy = [...node];
    copy[index] = updateAt(node[index] ?? null, rest, update);
    return copy;
  }
  if (!isJsonObject(node)) return node;
  return objectFrom(
    Object.keys(node).map(key => [
      key,
      key === token
        ? updateAt(node[key] ?? null, rest, update)
        : (node[key] ?? null),
    ]),
  );
}

/** `path` 의 값을 `value` 로 바꾼 새 값. 경로는 `nodeAt` 으로 확인된 것. */
function replaceAt(
  node: JsonValue,
  path: JsonPath,
  value: JsonValue,
): JsonValue {
  return updateAt(node, path, () => value);
}

function replaceResult(
  job: ReviewJob,
  resultId: string,
  update: (result: Result) => Result,
): ReviewJob {
  return {
    ...job,
    output: job.output.map(item =>
      isResult(item) && item.id === resultId ? update(item) : item,
    ),
  };
}

/** 값 연산 내부의 실패 표식. `JsonObject` 와 섞이지 않게 class 로 가른다. */
class Failure {
  constructor(readonly reason: DropReason) {}
}

const stop = (reason: DropReason) => new Failure(reason);

/**
 * 결과 `content` 를 고치는 값 연산의 공통 틀: 결과 찾기 → 편집 가능 상태 확인 →
 * `edit(content)` 가 새 content 또는 실패를 준다. 값은 복제하지 않는다(`ExactNumber` 유지).
 */
function editContent(
  job: ReviewJob,
  resultId: string,
  edit: (content: JsonValue) => JsonValue | Failure,
): EditResult {
  const result = job.output.find(
    (item): item is Result => isResult(item) && item.id === resultId,
  );
  if (!result) return fail("result_missing");
  if (!canEditResult(result)) return fail("result_not_editable");
  const outcome = edit(result.content);
  if (outcome instanceof Failure) return fail(outcome.reason);
  return {
    ok: true,
    job: replaceResult(job, resultId, r => ({ ...r, content: outcome })),
  };
}

/**
 * E1·E2: 결과 `content` 의 scalar leaf 하나를 바꾼다. 있는 경로만(키 추가·배열
 * 항목 추가 없음). `path: []` 는 `content` 자체가 scalar(Validate 판정)일 때만.
 * 편집 가능 상태(`present`·`stale`)가 아니면 `result_not_editable`.
 */
export function setValue(
  job: ReviewJob,
  resultId: string,
  path: JsonPath,
  value: JsonValue,
): EditResult {
  return editContent(job, resultId, content => {
    const current = nodeAt(content, path);
    if (!isScalar(value) || current === undefined || !isScalar(current)) {
      return stop("path_missing");
    }
    return replaceAt(content, path, value);
  });
}

/** 있는 경로의 값을 무엇이든(컨테이너 포함) 통째로 바꾼다. `path: []` 는 content 전체. */
export function replaceSubtree(
  job: ReviewJob,
  resultId: string,
  path: JsonPath,
  value: JsonValue,
): EditResult {
  return editContent(job, resultId, content =>
    nodeAt(content, path) === undefined
      ? stop("path_missing")
      : replaceAt(content, path, value),
  );
}

function isIndexIn(index: number, length: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < length;
}

/** 배열 `path` 를 `edit(배열)` 로 바꾼다. 배열이 아니면 `path_missing`. */
function editArray(
  job: ReviewJob,
  resultId: string,
  path: JsonPath,
  edit: (items: readonly JsonValue[]) => JsonValue[] | Failure,
): EditResult {
  return editContent(job, resultId, content => {
    const items = nodeAt(content, path);
    if (!Array.isArray(items)) return stop("path_missing");
    const next = edit(items);
    return next instanceof Failure ? next : replaceAt(content, path, next);
  });
}

/** 배열 `path` 의 `index`(0..length) 자리에 항목을 넣는다. */
export function insertItem(
  job: ReviewJob,
  resultId: string,
  path: JsonPath,
  index: number,
  value: JsonValue,
): EditResult {
  return editArray(job, resultId, path, items =>
    isIndexIn(index, items.length + 1)
      ? [...items.slice(0, index), value, ...items.slice(index)]
      : stop("index_out_of_range"),
  );
}

/** 배열 `path` 의 `index` 항목을 뺀다. */
export function removeItem(
  job: ReviewJob,
  resultId: string,
  path: JsonPath,
  index: number,
): EditResult {
  return editArray(job, resultId, path, items =>
    isIndexIn(index, items.length)
      ? items.filter((_, i) => i !== index)
      : stop("index_out_of_range"),
  );
}

/** 배열 `path` 의 `from` 항목을 `to`(뺀 뒤 기준, 0..length-1)로 옮긴다. */
export function moveItem(
  job: ReviewJob,
  resultId: string,
  path: JsonPath,
  from: number,
  to: number,
): EditResult {
  return editArray(job, resultId, path, items => {
    if (!isIndexIn(from, items.length) || !isIndexIn(to, items.length)) {
      return stop("index_out_of_range");
    }
    const rest = items.filter((_, i) => i !== from);
    return insertAt(rest, to, [items[from] ?? null]);
  });
}

/** 객체 `path` 를 `edit(객체)` 로 바꾼다. 객체가 아니면 `path_missing`. */
function editObject(
  job: ReviewJob,
  resultId: string,
  path: JsonPath,
  edit: (object: JsonObject) => JsonObject | Failure,
): EditResult {
  return editContent(job, resultId, content => {
    const object = nodeAt(content, path);
    if (!isJsonObject(object)) return stop("path_missing");
    const next = edit(object);
    return next instanceof Failure ? next : replaceAt(content, path, next);
  });
}

/** 객체 `path` 에 없던 키를 끝에 더한다. 키가 있으면 `path_exists`. */
export function setKey(
  job: ReviewJob,
  resultId: string,
  path: JsonPath,
  key: string,
  value: JsonValue,
): EditResult {
  return editObject(job, resultId, path, object =>
    Object.hasOwn(object, key)
      ? stop("path_exists")
      : objectFrom([
          ...Object.keys(object).map(k => [k, object[k] ?? null] as const),
          [key, value],
        ]),
  );
}

/** 객체 `path` 의 키를 지운다. 없으면 `path_missing`. */
export function removeKey(
  job: ReviewJob,
  resultId: string,
  path: JsonPath,
  key: string,
): EditResult {
  return editObject(job, resultId, path, object =>
    Object.hasOwn(object, key)
      ? objectFrom(
          Object.keys(object)
            .filter(k => k !== key)
            .map(k => [k, object[k] ?? null] as const),
        )
      : stop("path_missing"),
  );
}

// ---------------------------------------------------------------------------
// 구조 — 공통
// ---------------------------------------------------------------------------

type Documents = readonly ReviewDocumentEntry[];

/** 구조 연산 대상 보기를 찾는다. 멀티 layout Job 은 구성 편집을 막는다. */
function editLayout(
  job: ReviewJob,
  stepId: string | null,
  edit: (
    documents: Documents,
    fileGroups: FileGroups,
  ) =>
    | { ok: true; documents: Documents; fileGroups?: FileGroups }
    | { ok: false; reason: DropReason },
): EditResult {
  if (isMultiLayout(job)) return fail("multi_layout_unsupported");
  const layout = findLayout(job, stepId);
  if (!layout || !job.file_groups) return fail("target_missing");
  const outcome = edit(layout.content.documents, job.file_groups);
  if (!outcome.ok) return outcome;
  const output = job.output.map((item: OutputItem): OutputItem => {
    if (item !== layout) return item;
    const next: Layout = {
      ...layout,
      content: { ...layout.content, documents: outcome.documents },
    };
    return next;
  });
  return {
    ok: true,
    job: {
      ...job,
      file_groups: outcome.fileGroups ?? job.file_groups,
      output,
    },
  };
}

function indexOfDocument(documents: Documents, documentId: string): number {
  return documents.findIndex(document => document.document_id === documentId);
}

/** 페이지 목록을 안전하게 펼친다. 범위가 잘못된 문서는 편집 대상이 아니다. */
function pagesOf(document: ReviewDocumentEntry): PageRef[] | null {
  try {
    return flattenPages(document);
  } catch {
    return null;
  }
}

function withPages(
  document: ReviewDocumentEntry,
  pages: readonly PageRef[],
): ReviewDocumentEntry {
  return { ...document, source_files: compressPages(pages) };
}

function isIndex(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function insertAt<T>(
  items: readonly T[],
  index: number,
  inserted: readonly T[],
) {
  const at = Math.min(index, items.length);
  return [...items.slice(0, at), ...inserted, ...items.slice(at)];
}

function checkNewId(documents: Documents, id: string): DropReason | null {
  if (!DOCUMENT_ID_PATTERN.test(id)) return "invalid_document_id";
  if (indexOfDocument(documents, id) >= 0) return "invalid_document_id";
  return null;
}

/** `pages` 를 중복 없는 key 집합으로. */
function keySet(pages: readonly PageRef[]): Set<string> {
  return new Set(pages.map(pageKey));
}

/**
 * 원 문서에서 페이지를 뺀다. 원 문서가 비면 문서를 지운다. 서버는 페이지 없는 문서를
 * 받지 않으므로 제외 문서도 지우고, `excluded_documents` 에서도 그 id 를 뺀다
 * (`documents[]` 에 없는 id 가 남으면 서버가 거부한다).
 */
function removePages(
  documents: Documents,
  index: number,
  remaining: readonly PageRef[],
  fileGroups: FileGroups,
): { documents: ReviewDocumentEntry[]; fileGroups: FileGroups } {
  const document = documents[index] as ReviewDocumentEntry;
  const copy = [...documents];
  if (remaining.length > 0) {
    copy[index] = withPages(document, remaining);
    return { documents: copy, fileGroups };
  }
  copy.splice(index, 1);
  return {
    documents: copy,
    fileGroups: withoutExcludedDocument(fileGroups, document.document_id),
  };
}

/** 다른 문서에서 가져온 페이지 수. */
export type PageTake = { readonly documentId: string; readonly count: number };

/** 페이지 범위 지정·새 문서가 다른 곳에서 페이지를 가져온 결과. */
export type PageTakeReport = {
  /** 페이지를 내준 문서(문서 순서). 비게 되어 지운 문서도 포함한다. */
  readonly taken: readonly PageTake[];
  /** `taken` 중 남은 페이지가 없어 지운 문서 id. */
  readonly removed: readonly string[];
  /** `excluded_pages` 에서 뺀 페이지 수. */
  readonly fromExcluded: number;
};

/**
 * 대상 문서로 새로 들어오는 페이지 키. 새 문서(`target` 이 null)면 지정한 페이지
 * 전부, 아니면 대상 문서에 없던 페이지만(이미 있던 페이지의 겹침은 그대로 둔다).
 * 범위를 펼칠 수 없으면 throw 한다.
 */
function incomingPageKeys(
  target: ReviewDocumentEntry | null,
  sourceFiles: readonly SourceRange[],
): Set<string> {
  const keys = flattenSources(sourceFiles).map(pageKey);
  if (!target) return new Set(keys);
  const before = keySet(pagesOf(target) ?? []);
  return new Set(keys.filter(key => !before.has(key)));
}

/**
 * `pages`(pageKey 집합)를 `keepDocumentId` 가 아닌 문서들과 `excluded_pages` 에서 뺀다.
 * 페이지 범위 지정·새 문서가 다른 곳의 페이지를 가져올 때 "옮기기"가 되게 한다.
 * 비게 된 문서는 지우고 `excluded_documents` 에서도 뺀다(`removePages` 와 같은 규칙).
 * 걸리는 페이지가 없는 문서는 같은 객체로 두고, 범위를 펼칠 수 없는 문서·제외 목록은
 * 건드리지 않는다. 어디서 몇 쪽을 뺐는지 보고서를 함께 돌려준다.
 */
function takePagesFromOthers(
  documents: Documents,
  fileGroups: FileGroups,
  keepDocumentId: string,
  pages: ReadonlySet<string>,
): {
  documents: ReviewDocumentEntry[];
  fileGroups: FileGroups;
  report: PageTakeReport;
} {
  if (pages.size === 0) {
    return {
      documents: [...documents],
      fileGroups,
      report: { taken: [], removed: [], fromExcluded: 0 },
    };
  }
  let nextFileGroups = fileGroups;
  const nextDocuments: ReviewDocumentEntry[] = [];
  const taken: PageTake[] = [];
  const removed: string[] = [];
  for (const document of documents) {
    const current =
      document.document_id === keepDocumentId ? null : pagesOf(document);
    if (!current || !current.some(page => pages.has(pageKey(page)))) {
      nextDocuments.push(document);
      continue;
    }
    const remaining = current.filter(page => !pages.has(pageKey(page)));
    taken.push({
      documentId: document.document_id,
      count: current.length - remaining.length,
    });
    if (remaining.length > 0) {
      nextDocuments.push(withPages(document, remaining));
    } else {
      removed.push(document.document_id);
      nextFileGroups = withoutExcludedDocument(
        nextFileGroups,
        document.document_id,
      );
    }
  }
  let fromExcluded = 0;
  const excluded = excludedPages(nextFileGroups);
  if (excluded && excluded.some(page => pages.has(pageKey(page)))) {
    const kept = excluded.filter(page => !pages.has(pageKey(page)));
    fromExcluded = excluded.length - kept.length;
    nextFileGroups = {
      ...nextFileGroups,
      excluded_pages: compressPages(kept),
    };
  }
  return {
    documents: nextDocuments,
    fileGroups: nextFileGroups,
    report: { taken, removed, fromExcluded },
  };
}

/**
 * 적용하지 않고, 페이지 범위 지정(`documentId`)·새 문서(`documentId` 가 null)가
 * 다른 문서·제외 목록에서 가져올 페이지를 미리 센다. 적용과 같은 규칙을 쓴다.
 * 멀티 layout·layout 없음·`file_groups` 없음·대상 문서 없음·범위를 펼칠 수 없음이면 null.
 */
export function previewPageTake(
  job: ReviewJob,
  stepId: string | null,
  documentId: string | null,
  sourceFiles: readonly SourceRange[],
): PageTakeReport | null {
  if (isMultiLayout(job)) return null;
  const layout = findLayout(job, stepId);
  if (!layout || !job.file_groups) return null;
  const documents = layout.content.documents;
  let target: ReviewDocumentEntry | null = null;
  if (documentId !== null) {
    const index = indexOfDocument(documents, documentId);
    if (index < 0) return null;
    target = documents[index] as ReviewDocumentEntry;
  }
  let incoming: Set<string>;
  try {
    incoming = incomingPageKeys(target, sourceFiles);
  } catch {
    return null;
  }
  // 새 문서의 id 는 목록에 없으므로 넣지 않고 계산해도 결과가 같다.
  return takePagesFromOthers(
    documents,
    job.file_groups,
    documentId ?? "",
    incoming,
  ).report;
}

/** 지운 문서의 id 를 `excluded_documents` 에서 뺀다. 없으면 그대로. */
function withoutExcludedDocument(
  fileGroups: FileGroups,
  documentId: string,
): FileGroups {
  return fileGroups.excluded_documents.includes(documentId)
    ? {
        ...fileGroups,
        excluded_documents: fileGroups.excluded_documents.filter(
          id => id !== documentId,
        ),
      }
    : fileGroups;
}

// ---------------------------------------------------------------------------
// 구조 — 연산
// ---------------------------------------------------------------------------

/**
 * 라벨 입력값을 저장할 값으로. 비었거나 공백뿐이면 라벨 없음(`null`), 그 밖에는 그대로
 * (앞뒤 공백도 자르지 않는다). 서버는 빈 문자열 라벨을 거부한다.
 */
export function normalizeLabel(label: string | null): string | null {
  return label === null || label.trim() === "" ? null : label;
}

/**
 * E3: 문서 라벨. `null`·빈 문자열·공백뿐인 문자열은 라벨 없음. 길이 한도
 * (`DOCUMENT_LABEL_MAX_LENGTH`)는 여기서 막지 않고 저장 전 검증이 알린다.
 */
export function setLabel(
  job: ReviewJob,
  stepId: string | null,
  documentId: string,
  label: string | null,
): EditResult {
  return editLayout(job, stepId, documents => {
    const index = indexOfDocument(documents, documentId);
    if (index < 0) return fail("document_missing");
    const copy = [...documents];
    copy[index] = {
      ...(documents[index] as ReviewDocumentEntry),
      label: normalizeLabel(label),
    };
    return { ok: true, documents: copy };
  });
}

/** E4: 문서 안에서 페이지 하나를 `toIndex`(0-based, 뺀 뒤 기준, 끝을 넘으면 끝)로 옮긴다. */
export function reorderPages(
  job: ReviewJob,
  stepId: string | null,
  documentId: string,
  page: PageRef,
  toIndex: number,
): EditResult {
  return editLayout(job, stepId, documents => {
    const index = indexOfDocument(documents, documentId);
    if (index < 0) return fail("document_missing");
    const document = documents[index] as ReviewDocumentEntry;
    const pages = pagesOf(document);
    if (!pages) return fail("page_not_in_document");
    const key = pageKey(page);
    const from = pages.findIndex(item => pageKey(item) === key);
    if (from < 0) return fail("page_not_in_document");
    if (!isIndex(toIndex)) return fail("index_out_of_range");
    const moved = pages[from] as PageRef;
    const rest = pages.filter((_, i) => i !== from);
    const copy = [...documents];
    copy[index] = withPages(document, insertAt(rest, toIndex, [moved]));
    return { ok: true, documents: copy };
  });
}

/** E5: 보기 안 문서 순서. `toIndex` 는 뺀 뒤 기준(끝을 넘으면 끝). */
export function reorderDocuments(
  job: ReviewJob,
  stepId: string | null,
  documentId: string,
  toIndex: number,
): EditResult {
  return editLayout(job, stepId, documents => {
    const index = indexOfDocument(documents, documentId);
    if (index < 0) return fail("document_missing");
    if (!isIndex(toIndex)) return fail("index_out_of_range");
    const rest = documents.filter((_, i) => i !== index);
    return {
      ok: true,
      documents: insertAt(rest, toIndex, [
        documents[index] as ReviewDocumentEntry,
      ]),
    };
  });
}

/**
 * E6 분리: `afterPage` 뒤에서 자른다. 뒤쪽 페이지는 새 문서(같은 그룹·같은 라벨)가
 * 되어 원 문서 바로 뒤에 들어간다. 마지막 페이지 뒤는 자를 수 없다. 원 문서가 제외
 * 문서였으면 새 문서도 `excluded_documents` 에 넣어 두 문서 모두 제외로 남는다.
 */
export function splitDocument(
  job: ReviewJob,
  stepId: string | null,
  documentId: string,
  afterPage: PageRef,
  newDocumentId: string,
): EditResult {
  return editLayout(job, stepId, (documents, fileGroups) => {
    const index = indexOfDocument(documents, documentId);
    if (index < 0) return fail("document_missing");
    const document = documents[index] as ReviewDocumentEntry;
    const pages = pagesOf(document);
    if (!pages) return fail("page_not_in_document");
    const key = pageKey(afterPage);
    const at = pages.findIndex(item => pageKey(item) === key);
    if (at < 0) return fail("page_not_in_document");
    if (at === pages.length - 1) return fail("index_out_of_range");
    const idProblem = checkNewId(documents, newDocumentId);
    if (idProblem) return fail(idProblem);
    const created: ReviewDocumentEntry = {
      document_id: newDocumentId,
      group_id: document.group_id,
      label: document.label,
      source_files: compressPages(pages.slice(at + 1)),
    };
    const copy = [...documents];
    copy.splice(index, 1, withPages(document, pages.slice(0, at + 1)), created);
    if (!fileGroups.excluded_documents.includes(documentId)) {
      return { ok: true, documents: copy };
    }
    return {
      ok: true,
      documents: copy,
      fileGroups: {
        ...fileGroups,
        excluded_documents: [...fileGroups.excluded_documents, newDocumentId],
      },
    };
  });
}

/**
 * E6 합치기: `from` 의 페이지를 `into` 끝에 이어 붙이고 `from` 을 지운다. 같은 그룹만.
 * `from` 이 제외 문서였으면 `excluded_documents` 에서도 뺀다(합친 페이지는 `into` 를 따른다).
 */
export function mergeDocuments(
  job: ReviewJob,
  stepId: string | null,
  intoDocumentId: string,
  fromDocumentId: string,
): EditResult {
  return editLayout(job, stepId, (documents, fileGroups) => {
    const intoIndex = indexOfDocument(documents, intoDocumentId);
    const fromIndex = indexOfDocument(documents, fromDocumentId);
    if (intoIndex < 0 || fromIndex < 0) return fail("document_missing");
    if (intoIndex === fromIndex) return fail("target_missing");
    const into = documents[intoIndex] as ReviewDocumentEntry;
    const from = documents[fromIndex] as ReviewDocumentEntry;
    if (into.group_id !== from.group_id) return fail("group_mismatch");
    const intoPages = pagesOf(into);
    const fromPages = pagesOf(from);
    if (!intoPages || !fromPages) return fail("page_not_in_document");
    const copy = [...documents];
    copy[intoIndex] = withPages(into, [...intoPages, ...fromPages]);
    copy.splice(fromIndex, 1);
    return {
      ok: true,
      documents: copy,
      fileGroups: withoutExcludedDocument(fileGroups, fromDocumentId),
    };
  });
}

/**
 * 페이지를 넣을 곳: 같은 그룹 문서의 `index`, 또는 `afterDocumentId` 뒤의 새 문서.
 * 새 문서의 `label` 이 있으면 그 라벨(`null` 은 라벨 없음)로 만들고, 없으면 호출
 * 함수의 기본(옮기기는 원본 라벨, 복귀는 라벨 없음)을 쓴다.
 */
export type MoveTarget =
  | { readonly documentId: string; readonly index: number }
  | {
      readonly newDocumentId: string;
      readonly afterDocumentId: string;
      readonly label?: string | null;
    };

/**
 * E6 페이지 옮기기: `pages` 를 `from` 에서 빼서 같은 그룹의 다른 문서 `index`
 * (0-based, 끝을 넘으면 끝) 에 넣거나, `afterDocumentId` 뒤에 새 문서(`to.label`,
 * 없으면 `from` 라벨)로 만든다. 옮기는 페이지는 `from` 안의 순서를 따른다. `from` 이 비면 지운다.
 * 새 문서는 `from` 이 제외 문서여도 활성 문서로 만든다(옮긴 페이지는 쓰려고 옮긴 것이다).
 */
export function movePages(
  job: ReviewJob,
  stepId: string | null,
  fromDocumentId: string,
  pages: readonly PageRef[],
  to: MoveTarget,
): EditResult {
  return editLayout(job, stepId, (documents, fileGroups) => {
    const fromIndex = indexOfDocument(documents, fromDocumentId);
    if (fromIndex < 0) return fail("document_missing");
    const from = documents[fromIndex] as ReviewDocumentEntry;
    const fromPages = pagesOf(from);
    if (!fromPages || pages.length === 0) return fail("page_not_in_document");
    const keys = keySet(pages);
    const present = keySet(fromPages);
    for (const key of keys) {
      if (!present.has(key)) return fail("page_not_in_document");
    }
    const moved = fromPages.filter(page => keys.has(pageKey(page)));
    const remaining = fromPages.filter(page => !keys.has(pageKey(page)));

    if ("documentId" in to) {
      if (!isIndex(to.index)) return fail("index_out_of_range");
      if (indexOfDocument(documents, to.documentId) < 0) {
        return fail("target_missing");
      }
      const target = documents[
        indexOfDocument(documents, to.documentId)
      ] as ReviewDocumentEntry;
      if (target.group_id !== from.group_id) return fail("group_mismatch");
      if (target.document_id === from.document_id) {
        const copy = [...documents];
        copy[fromIndex] = withPages(from, insertAt(remaining, to.index, moved));
        return { ok: true, documents: copy };
      }
      const targetPages = pagesOf(target);
      if (!targetPages) return fail("page_not_in_document");
      const updated = [...documents];
      updated[indexOfDocument(documents, to.documentId)] = withPages(
        target,
        insertAt(targetPages, to.index, moved),
      );
      return {
        ok: true,
        ...removePages(updated, fromIndex, remaining, fileGroups),
      };
    }

    if (indexOfDocument(documents, to.afterDocumentId) < 0) {
      return fail("target_missing");
    }
    const idProblem = checkNewId(documents, to.newDocumentId);
    if (idProblem) return fail(idProblem);
    const created: ReviewDocumentEntry = {
      document_id: to.newDocumentId,
      group_id: from.group_id,
      label: to.label === undefined ? from.label : to.label,
      source_files: compressPages(moved),
    };
    const afterIndex = indexOfDocument(documents, to.afterDocumentId);
    const inserted = insertAt(documents, afterIndex + 1, [created]);
    const shiftedFrom = fromIndex > afterIndex ? fromIndex + 1 : fromIndex;
    return {
      ok: true,
      ...removePages(inserted, shiftedFrom, remaining, fileGroups),
    };
  });
}

function excludedPages(fileGroups: FileGroups): PageRef[] | null {
  try {
    return flattenSources(fileGroups.excluded_pages);
  } catch {
    return null;
  }
}

/** E10: 문서에서 페이지를 빼서 `excluded_pages` 에 넣는다. 원 문서가 비면 지운다. */
export function excludePages(
  job: ReviewJob,
  stepId: string | null,
  fromDocumentId: string,
  pages: readonly PageRef[],
): EditResult {
  return editLayout(job, stepId, (documents, fileGroups) => {
    const fromIndex = indexOfDocument(documents, fromDocumentId);
    if (fromIndex < 0) return fail("document_missing");
    const from = documents[fromIndex] as ReviewDocumentEntry;
    const fromPages = pagesOf(from);
    const excluded = excludedPages(fileGroups);
    if (!fromPages || !excluded || pages.length === 0) {
      return fail("page_not_in_document");
    }
    const keys = keySet(pages);
    const present = keySet(fromPages);
    const already = keySet(excluded);
    for (const key of keys) {
      if (already.has(key)) return fail("already_excluded");
      if (!present.has(key)) return fail("page_not_in_document");
    }
    const moved = fromPages.filter(page => keys.has(pageKey(page)));
    const remaining = fromPages.filter(page => !keys.has(pageKey(page)));
    const removed = removePages(documents, fromIndex, remaining, fileGroups);
    return {
      ok: true,
      documents: removed.documents,
      fileGroups: {
        ...removed.fileGroups,
        excluded_pages: compressPages(dedupe([...excluded, ...moved])),
      },
    };
  });
}

function dedupe(pages: readonly PageRef[]): PageRef[] {
  const seen = new Set<string>();
  return pages.filter(page => {
    const key = pageKey(page);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * E10 되돌리기: 제외한 페이지를 같은 그룹 문서의 `index`(0-based)에 다시 넣거나,
 * `afterDocumentId` 뒤에 그 페이지들로 새 문서(페이지의 그룹, `to.label`, 없으면
 * 라벨 없음)를 만든다.
 * 새 문서로 만들 때 페이지는 한 그룹에 속해야 한다.
 */
export function restorePages(
  job: ReviewJob,
  stepId: string | null,
  pages: readonly PageRef[],
  to: MoveTarget,
): EditResult {
  return editLayout(job, stepId, (documents, fileGroups) => {
    const excluded = excludedPages(fileGroups);
    if (!excluded || pages.length === 0) return fail("page_not_in_document");
    const keys = keySet(pages);
    const present = keySet(excluded);
    for (const key of keys) {
      if (!present.has(key)) return fail("page_not_in_document");
    }
    const restored = dedupe(pages);
    const nextFileGroups: FileGroups = {
      ...fileGroups,
      excluded_pages: compressPages(
        excluded.filter(page => !keys.has(pageKey(page))),
      ),
    };

    if ("newDocumentId" in to) {
      const afterIndex = indexOfDocument(documents, to.afterDocumentId);
      if (afterIndex < 0) return fail("target_missing");
      const idProblem = checkNewId(documents, to.newDocumentId);
      if (idProblem) return fail(idProblem);
      const groupId = groupOfFile(
        job,
        (restored[0] as PageRef).file_ref,
      )?.group_id;
      if (groupId === undefined) return fail("target_missing");
      for (const page of restored) {
        if (groupOfFile(job, page.file_ref)?.group_id !== groupId) {
          return fail("group_mismatch");
        }
      }
      const created: ReviewDocumentEntry = {
        document_id: to.newDocumentId,
        group_id: groupId,
        label: to.label === undefined ? null : to.label,
        source_files: compressPages(restored),
      };
      return {
        ok: true,
        documents: insertAt(documents, afterIndex + 1, [created]),
        fileGroups: nextFileGroups,
      };
    }

    if (!isIndex(to.index)) return fail("index_out_of_range");
    const targetIndex = indexOfDocument(documents, to.documentId);
    if (targetIndex < 0) return fail("target_missing");
    const target = documents[targetIndex] as ReviewDocumentEntry;
    const targetPages = pagesOf(target);
    if (!targetPages) return fail("page_not_in_document");
    for (const page of restored) {
      if (groupOfFile(job, page.file_ref)?.group_id !== target.group_id) {
        return fail("group_mismatch");
      }
    }
    const copy = [...documents];
    copy[targetIndex] = withPages(
      target,
      insertAt(targetPages, to.index, restored),
    );
    return { ok: true, documents: copy, fileGroups: nextFileGroups };
  });
}

// ---------------------------------------------------------------------------
// 구조 — 페이지 범위 지정·새 문서·문서 제외
// ---------------------------------------------------------------------------

/**
 * 직접 지정한 `source_files` 의 모양 검사: 비어 있지 않고, source 마다 그룹
 * `groupId` 의 파일이고 범위가 하나 이상이며, 범위마다 정수·1 이상·`first <= last`·
 * `MAX_PAGE_NUMBER` 이하, 펼친 페이지가 `MAX_DOCUMENT_PAGES` 이하. 다른 문서·제외
 * 목록과 겹치는 페이지는 호출한 쪽이 옮겨 온다(`takePagesFromOthers`). 입력 안의 자기
 * 중복·파일 `num_pages` 초과는 막지 않는다(`validateStructure` 가 저장 전에 보인다).
 */
function validateSourceFiles(
  job: ReviewJob,
  groupId: string,
  sourceFiles: readonly SourceRange[],
): DropReason | null {
  const group = groupOf(job, groupId);
  if (!group) return "target_missing";
  if (sourceFiles.length === 0) return "invalid_page_ranges";
  let total = 0;
  for (const source of sourceFiles) {
    if (!group.files.some(file => file.file_ref === source.file_ref)) {
      return "invalid_page_ranges";
    }
    if (source.page_ranges.length === 0) return "invalid_page_ranges";
    for (const range of source.page_ranges) {
      if (!isValidPageRange(range)) return "invalid_page_ranges";
      total += range[1] - range[0] + 1;
    }
  }
  return total > MAX_DOCUMENT_PAGES ? "invalid_page_ranges" : null;
}

/** 입력 `source_files` 를 그대로(순서·반복 유지, 압축 없음) 복사한다. */
function copySources(sourceFiles: readonly SourceRange[]): SourceRange[] {
  return sourceFiles.map(source => ({
    file_ref: source.file_ref,
    page_ranges: source.page_ranges.map(([first, last]): PageRange => [
      first,
      last,
    ]),
  }));
}

/**
 * B5: 문서의 `source_files` 를 지정한 범위로 바꾼다(입력 순서 그대로). 이 문서에
 * 없던 페이지는 다른 문서·제외 목록에서 빼 온다. 이미 이 문서에 있던 페이지의
 * 겹침은 그대로 둔다.
 */
export function setPageRanges(
  job: ReviewJob,
  stepId: string | null,
  documentId: string,
  sourceFiles: readonly SourceRange[],
): EditResult {
  return editLayout(job, stepId, (documents, fileGroups) => {
    const index = indexOfDocument(documents, documentId);
    if (index < 0) return fail("document_missing");
    const document = documents[index] as ReviewDocumentEntry;
    const problem = validateSourceFiles(job, document.group_id, sourceFiles);
    if (problem) return fail(problem);
    const added = incomingPageKeys(document, sourceFiles);
    const copy = [...documents];
    copy[index] = { ...document, source_files: copySources(sourceFiles) };
    const taken = takePagesFromOthers(copy, fileGroups, documentId, added);
    return {
      ok: true,
      documents: taken.documents,
      fileGroups: taken.fileGroups,
    };
  });
}

/**
 * B7: 그룹 `groupId` 에 지정한 범위로 새 문서를 만들어 `index`(0-based, 끝을 넘으면 끝)에
 * 넣는다. 그 페이지는 다른 문서·제외 목록에서 빼 온다. `index` 는 빼기 전 목록 기준이다.
 */
export function addDocument(
  job: ReviewJob,
  stepId: string | null,
  newDocumentId: string,
  groupId: string,
  label: string | null,
  sourceFiles: readonly SourceRange[],
  index: number,
): EditResult {
  return editLayout(job, stepId, (documents, fileGroups) => {
    const idProblem = checkNewId(documents, newDocumentId);
    if (idProblem) return fail(idProblem);
    const problem = validateSourceFiles(job, groupId, sourceFiles);
    if (problem) return fail(problem);
    if (!isIndex(index)) return fail("index_out_of_range");
    const created: ReviewDocumentEntry = {
      document_id: newDocumentId,
      group_id: groupId,
      label,
      source_files: copySources(sourceFiles),
    };
    const taken = takePagesFromOthers(
      insertAt(documents, index, [created]),
      fileGroups,
      newDocumentId,
      incomingPageKeys(null, sourceFiles),
    );
    return {
      ok: true,
      documents: taken.documents,
      fileGroups: taken.fileGroups,
    };
  });
}

/**
 * Job 단위 `file_groups` 만 바꾸는 구조 연산의 공통 틀. 문서 배치 보기는 그대로
 * 두지만, 구성 편집 정책은 같다(멀티 layout Job 은 막는다).
 */
function editFileGroups(
  job: ReviewJob,
  edit: (fileGroups: FileGroups) => FileGroups | Failure,
): EditResult {
  if (isMultiLayout(job)) return fail("multi_layout_unsupported");
  if (!job.file_groups) return fail("target_missing");
  const outcome = edit(job.file_groups);
  if (outcome instanceof Failure) return fail(outcome.reason);
  return { ok: true, job: { ...job, file_groups: outcome } };
}

/**
 * B9: 문서를 `excluded_documents` 에 넣는다. 문서는 보기 `documents[]` 에 그대로
 * 남는다(서버 규칙). 제외 문서의 페이지는 제외된 것으로 본다.
 */
export function excludeDocument(
  job: ReviewJob,
  documentId: string,
): EditResult {
  return editFileGroups(job, fileGroups => {
    if (
      !documentsOf(job).some(item => item.document.document_id === documentId)
    ) {
      return stop("document_missing");
    }
    if (fileGroups.excluded_documents.includes(documentId)) {
      return stop("already_excluded");
    }
    return {
      ...fileGroups,
      excluded_documents: [...fileGroups.excluded_documents, documentId],
    };
  });
}

/** B9 되돌리기: `excluded_documents` 에서 뺀다. 제외 목록에 없으면 `target_missing`. */
export function restoreDocument(
  job: ReviewJob,
  documentId: string,
): EditResult {
  return editFileGroups(job, fileGroups =>
    fileGroups.excluded_documents.includes(documentId)
      ? {
          ...fileGroups,
          excluded_documents: fileGroups.excluded_documents.filter(
            id => id !== documentId,
          ),
        }
      : stop("target_missing"),
  );
}

// ---------------------------------------------------------------------------
// 구조 — 그룹 간 파일 이동
// ---------------------------------------------------------------------------

/** 파일을 옮길 곳: 다른 기존 그룹, 또는 클라이언트가 만든 id 의 새 그룹. */
export type FileMoveTarget =
  { readonly groupId: string } | { readonly newGroupId: string };

/**
 * B10: 파일을 통째로 다른 그룹(끝에 붙임) 또는 새 그룹(원 그룹 바로 뒤, `layout_step_id`
 * 는 원 그룹 값)으로 옮긴다. 그 파일만 쓰는 문서(제외 문서 포함)의 `group_id` 를 대상
 * 그룹으로 바꾸고, 파일이 빠져 빈 그룹은 지운다. 문서 순서·페이지·결과는 그대로다
 * (결과 연결은 서버가 다시 판정한다).
 *
 * 거부: 파일이 어느 그룹에도 없거나 대상 그룹이 없거나 같은 그룹 → `target_missing`,
 * 파일이 하나뿐인 그룹을 새 그룹으로 분리 → `target_missing`(그룹 id 만 바뀐다),
 * 대상 그룹의 `layout_step_id` 가 다름 → `group_mismatch`, 그 파일과 다른 파일을 함께
 * 쓰는 문서가 있음 → `mixed_file_document`, 새 그룹 id 가 틀리거나 이미 있음 →
 * `invalid_document_id`. 멀티 layout Job 은 `multi_layout_unsupported`.
 */
export function moveFile(
  job: ReviewJob,
  fileRef: string,
  to: FileMoveTarget,
): EditResult {
  if (isMultiLayout(job)) return fail("multi_layout_unsupported");
  const fileGroups = job.file_groups;
  if (!fileGroups) return fail("target_missing");
  const from = fileGroups.groups.find(group =>
    group.files.some(file => file.file_ref === fileRef),
  );
  const file = from?.files.find(item => item.file_ref === fileRef);
  if (!from || !file) return fail("target_missing");

  const layout = layoutsOf(job)[0] ?? null;
  const documents = layout?.content.documents ?? [];
  const usesFile = (document: ReviewDocumentEntry) =>
    document.source_files.some(source => source.file_ref === fileRef);
  if (
    documents.some(
      document =>
        usesFile(document) &&
        document.source_files.some(source => source.file_ref !== fileRef),
    )
  ) {
    return fail("mixed_file_document");
  }

  const withoutFile: FileGroup = {
    ...from,
    files: from.files.filter(item => item !== file),
  };
  let targetId: string;
  let groups: FileGroup[];
  if ("groupId" in to) {
    const target = fileGroups.groups.find(
      group => group.group_id === to.groupId,
    );
    if (!target || target === from) return fail("target_missing");
    if (target.layout_step_id !== from.layout_step_id) {
      return fail("group_mismatch");
    }
    targetId = target.group_id;
    groups = fileGroups.groups.map(group =>
      group === from
        ? withoutFile
        : group === target
          ? { ...target, files: [...target.files, file] }
          : group,
    );
  } else {
    if (from.files.length < 2) return fail("target_missing");
    if (
      !isValidGroupId(to.newGroupId) ||
      fileGroups.groups.some(group => group.group_id === to.newGroupId)
    ) {
      return fail("invalid_document_id");
    }
    targetId = to.newGroupId;
    const created: FileGroup = {
      group_id: to.newGroupId,
      files: [file],
      layout_step_id: from.layout_step_id,
    };
    groups = fileGroups.groups.flatMap(group =>
      group === from ? [withoutFile, created] : [group],
    );
  }

  const output = job.output.map((item: OutputItem): OutputItem => {
    if (item !== layout) return item;
    const next: Layout = {
      ...layout,
      content: {
        ...layout.content,
        documents: documents.map(document =>
          usesFile(document) && document.group_id !== targetId
            ? { ...document, group_id: targetId }
            : document,
        ),
      },
    };
    return next;
  });
  return {
    ok: true,
    job: {
      ...job,
      file_groups: {
        ...fileGroups,
        groups: groups.filter(group => group.files.length > 0),
      },
      output,
    },
  };
}

/**
 * 구조(`file_groups` + 문서 배치 보기 전부)를 통째로 바꾼다. 전체 JSON 가져오기 전용이라
 * 멀티 layout Job 도 받는다. 보기 집합(`step_id`)은 같아야 하고 결과는 그대로 둔다.
 * 모양 검사(페이지 범위·커버리지)는 저장 전 검증이 한다.
 */
export function replaceStructure(
  job: ReviewJob,
  fileGroups: FileGroups,
  layouts: readonly Layout[],
): EditResult {
  if (!job.file_groups) return fail("target_missing");
  const current = job.output.filter((item): item is Layout => !isResult(item));
  if (current.length !== layouts.length) return fail("target_missing");
  const byStep = new Map<string | null, Layout>();
  for (const layout of layouts) byStep.set(layout.step_id, layout);
  if (
    byStep.size !== layouts.length ||
    current.some(layout => !byStep.has(layout.step_id))
  ) {
    return fail("target_missing");
  }
  return {
    ok: true,
    job: {
      ...job,
      file_groups: fileGroups,
      output: job.output.map((item: OutputItem): OutputItem =>
        isResult(item) ? item : (byStep.get(item.step_id) ?? item),
      ),
    },
  };
}
