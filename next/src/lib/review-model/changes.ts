import {
  structureChanged,
  summarizeStructureReplacement,
  type StructureDocumentChange,
} from "./diff";
import {
  addDocument,
  excludeDocument,
  excludePages,
  insertItem,
  mergeDocuments,
  moveFile,
  moveItem,
  movePages,
  nodeAt,
  normalizeLabel,
  previewPageTake,
  removeItem,
  removeKey,
  reorderDocuments,
  reorderPages,
  replaceStructure,
  replaceSubtree,
  restoreDocument,
  restorePages,
  setKey,
  setLabel,
  setPageRanges,
  setValue,
  splitDocument,
  type DropReason,
  type EditResult,
  type FileMoveTarget,
  type MoveTarget,
  type PageTakeReport,
} from "./edits";
import { adoptAppliedVersions, type ImportUnit } from "./imports";
import { jsonEquals, type JsonValue } from "./json";
import {
  documentsOf,
  findDocument,
  findResult,
  linkedDocumentIds,
  results,
} from "./layout";
import {
  flattenPages,
  flattenSources,
  formatPageRanges,
  pageKey,
  pageSetEquals,
} from "./pages";
import {
  fieldTitle,
  isHiddenWrapper,
  isIndexToken,
  schemaAt,
  schemaPath,
  toPointer,
  type JsonPath,
} from "./schema";
import type {
  FileGroups,
  Layout,
  PageRef,
  ReviewDocument,
  ReviewDocumentEntry,
  ReviewJob,
  ReviewStep,
  Result,
  SourceRange,
} from "./types";

/**
 * 변경 항목의 파라미터. index 가 아니라 정체성(문서 id·결과 id·`PageRef`·경로)으로
 * 적어서, 앞 항목을 되돌려도 뒤 항목을 base 부터 다시 적용할 수 있다. 새 문서 id 도
 * draft 에 들어 있어 replay 가 결정적이다.
 */
export type ChangeDraft =
  | {
      readonly kind: "set_value";
      readonly jobId: string;
      readonly resultId: string;
      readonly path: JsonPath;
      readonly value: JsonValue;
    }
  | {
      /** 있는 경로의 값을 통째로 교체. `path: []` 는 content 전체. */
      readonly kind: "replace_subtree";
      readonly jobId: string;
      readonly resultId: string;
      readonly path: JsonPath;
      readonly value: JsonValue;
      /** 이 값을 가져온 곳(변경 이력). 트레이 표시 전용이며 적용·되돌리기·저장 본문에는 영향이 없다. */
      readonly origin?: ChangeOrigin;
    }
  | {
      /** `path` 는 배열, `index` 는 0..length. */
      readonly kind: "insert_item";
      readonly jobId: string;
      readonly resultId: string;
      readonly path: JsonPath;
      readonly index: number;
      readonly value: JsonValue;
    }
  | {
      readonly kind: "remove_item";
      readonly jobId: string;
      readonly resultId: string;
      readonly path: JsonPath;
      readonly index: number;
    }
  | {
      /** `to` 는 `from` 을 뺀 뒤 기준. */
      readonly kind: "move_item";
      readonly jobId: string;
      readonly resultId: string;
      readonly path: JsonPath;
      readonly from: number;
      readonly to: number;
    }
  | {
      /** `path` 는 객체, `key` 는 없던 키. */
      readonly kind: "set_key";
      readonly jobId: string;
      readonly resultId: string;
      readonly path: JsonPath;
      readonly key: string;
      readonly value: JsonValue;
    }
  | {
      readonly kind: "remove_key";
      readonly jobId: string;
      readonly resultId: string;
      readonly path: JsonPath;
      readonly key: string;
    }
  | {
      readonly kind: "set_label";
      readonly jobId: string;
      readonly stepId: string | null;
      readonly documentId: string;
      readonly label: string | null;
    }
  | {
      readonly kind: "reorder_pages";
      readonly jobId: string;
      readonly stepId: string | null;
      readonly documentId: string;
      readonly page: PageRef;
      readonly toIndex: number;
    }
  | {
      readonly kind: "reorder_documents";
      readonly jobId: string;
      readonly stepId: string | null;
      readonly documentId: string;
      readonly toIndex: number;
    }
  | {
      readonly kind: "split_document";
      readonly jobId: string;
      readonly stepId: string | null;
      readonly documentId: string;
      readonly afterPage: PageRef;
      readonly newDocumentId: string;
    }
  | {
      readonly kind: "merge_documents";
      readonly jobId: string;
      readonly stepId: string | null;
      readonly intoDocumentId: string;
      readonly fromDocumentId: string;
    }
  | {
      readonly kind: "move_pages";
      readonly jobId: string;
      readonly stepId: string | null;
      readonly fromDocumentId: string;
      readonly pages: readonly PageRef[];
      /** 같은 그룹 문서의 `index` 또는 `afterDocumentId` 뒤 새 문서(`to.label`, 없으면 원본 라벨). */
      readonly to: MoveTarget;
      /**
       * 한 조작으로 함께 만든 항목의 묶음 id(여러 장 선택 일괄 편집). 적용·되돌리기 규칙에는
       * 영향이 없고 트레이가 묶어 보이는 데만 쓴다.
       */
      readonly batchId?: string;
    }
  | {
      readonly kind: "exclude_pages";
      readonly jobId: string;
      readonly stepId: string | null;
      readonly fromDocumentId: string;
      readonly pages: readonly PageRef[];
      /**
       * 한 조작으로 함께 만든 항목의 묶음 id(여러 장 선택 일괄 편집). 적용·되돌리기 규칙에는
       * 영향이 없고 트레이가 묶어 보이는 데만 쓴다.
       */
      readonly batchId?: string;
    }
  | {
      readonly kind: "restore_pages";
      readonly jobId: string;
      readonly stepId: string | null;
      readonly pages: readonly PageRef[];
      /**
       * 기존 문서의 `index` 또는 `afterDocumentId` 뒤 새 문서(페이지의 그룹, `to.label`,
       * 없으면 라벨 없음).
       */
      readonly to: MoveTarget;
    }
  | {
      /** 문서의 `source_files` 를 지정한 범위로(입력 순서 그대로). */
      readonly kind: "set_page_ranges";
      readonly jobId: string;
      readonly stepId: string | null;
      readonly documentId: string;
      readonly sourceFiles: readonly SourceRange[];
    }
  | {
      /** 지정한 범위로 새 문서를 만들어 보기 `index` 에 넣는다. */
      readonly kind: "add_document";
      readonly jobId: string;
      readonly stepId: string | null;
      readonly newDocumentId: string;
      readonly groupId: string;
      readonly label: string | null;
      readonly sourceFiles: readonly SourceRange[];
      readonly index: number;
    }
  | {
      /** `file_groups.excluded_documents` 에 넣는다(문서는 보기에 남는다). */
      readonly kind: "exclude_document";
      readonly jobId: string;
      readonly documentId: string;
    }
  | {
      readonly kind: "restore_document";
      readonly jobId: string;
      readonly documentId: string;
    }
  | {
      /**
       * 파일을 통째로 다른 그룹 또는 새 그룹(`newGroupId` 는 draft 에 들어 있어 replay 가
       * 결정적)으로 옮긴다. 그 파일만 쓰는 문서도 함께 옮겨 간다.
       */
      readonly kind: "move_file";
      readonly jobId: string;
      readonly fileRef: string;
      readonly to: FileMoveTarget;
    }
  | {
      /**
       * 구조(`file_groups` + 문서 배치 보기 전부)를 통째로 교체. 전체 JSON 가져오기 전용.
       * `layouts` 의 보기 집합(`step_id`)은 Job 과 같아야 한다.
       */
      readonly kind: "replace_structure";
      readonly jobId: string;
      readonly fileGroups: FileGroups;
      readonly layouts: readonly Layout[];
      /** 이 구조를 가져온 곳(변경 이력). 트레이 표시 전용이며 적용·되돌리기·저장 본문에는 영향이 없다. */
      readonly origin?: ChangeOrigin;
    };

/**
 * 변경 이력에서 불러온 항목의 출처. `revision` 은 그 이력 행(서버 version), `original` 은
 * 기계 출력(최초 원본)이다.
 */
export type ChangeOrigin =
  | {
      readonly kind: "revision";
      readonly revisionId: string;
      readonly version: number;
    }
  | { readonly kind: "original" };

/**
 * 구조 교체 항목의 트레이 묶음 id. 묶음은 `documentIds[0]` 으로 나뉘므로 문서 id 가
 * 될 수 없는 값(NUL 로 시작)을 써서 "연결된 문서 없음" 묶음과 섞이지 않게 한다.
 */
export const STRUCTURE_GROUP_ID = "\u0000structure";

export type ChangeKind = ChangeDraft["kind"];

/** 결과 `content` 를 바꾸는 항목(= `resultId` 를 가진 종류 전부). */
export type ValueDraft = Extract<ChangeDraft, { readonly resultId: string }>;

/** 값 항목 판별. 결과·문서 하이라이트·충돌 매핑은 이 함수로 값 항목을 고른다. */
export function isValueEntry<T extends ChangeDraft>(
  entry: T,
): entry is Extract<T, { readonly resultId: string }> {
  return Object.hasOwn(entry, "resultId");
}

/**
 * 트레이 문구 재료. 적용 직전 상태에서 계산한다(host 가 next-intl 로 문구를 만든다).
 *
 * - `documentLabel`: 주 대상 문서 라벨(`set_value` 는 결과가 읽는 첫 문서).
 * - `documentIds`: 주 대상 문서 id(문서별 묶음용).
 * - `pages`: 문서 안 위치(1-based). 분리는 자른 위치, 순서 변경은 원래 위치,
 *   옮기기·제외는 옮긴 페이지들의 위치. 복원은 비어 있다.
 * - `pageRefs`: 대상 페이지(파일 로컬). `before`/`after`: 값·라벨·문서 위치(1-based).
 * - 값 종류: `pointer` 는 바뀌는 자리(배열 연산은 배열, 키 연산은 그 키),
 *   `fieldTitle` 은 그 자리의 schema 제목, `index`(1-based)는 넣은·뺀 항목 위치,
 *   `from`/`to`(1-based)는 옮긴 위치, `before` 는 빼거나 바꾸기 전 값.
 * - `fieldPath`: 자리 경로에 배열 위치가 있을 때만, 결과 루트부터 단계마다 제목(schema
 *   `title`, 없으면 키) 또는 1-based 위치. 래퍼 결과(`[{…}]`)의 맨 앞 `0` 은 위치가 아니라
 *   빼고, `fieldTitle` 도 래퍼를 뺀 경로로 찾는다. 배열 위치가 없으면 키 자체가 없다.
 * - 페이지 범위 지정·새 문서: `sourceFiles` 는 지정한 범위(파일 이름은 host 가
 *   붙인다), `beforeSourceFiles` 는 바꾸기 전 범위. `before`/`after` 는 그 범위를
 *   파일마다 `formatPageRanges` 로 만든 문자열을 `"; "` 로 이은 것. 다른 문서·제외
 *   목록에서 페이지를 가져오면 `takenFrom`(내준 문서와 쪽수, 문서 순서 — 비게 되어 지운
 *   문서 포함)·`removedDocuments`(비게 되어 지운 문서)·`fromExcluded`(제외 목록에서 뺀
 *   쪽수)가 붙고, 내준 문서 id 가 `documentIds` 뒤에 붙는다. 없으면 키 자체가 없다.
 * - 구조 통째 교체: `detail` 에 개수와 바뀐 수(라벨·범위·추가·삭제·순서, 그룹 설정은
 *   0/1), `structureDocuments` 에 라벨·범위가 바뀌었거나 추가·삭제된 문서(없으면 키가
 *   없다)가 붙고, 그 문서 id 가 `documentIds` 뒤에 붙는다.
 * - `detail`: 종류별 추가 재료(개수 등).
 */
export type ChangeDescription = {
  readonly documentLabel: string | null;
  readonly documentIds: readonly string[];
  readonly stepName?: string;
  readonly fieldTitle?: string;
  readonly fieldPath?: readonly FieldPathSegment[];
  readonly pointer?: string;
  readonly before?: JsonValue;
  readonly after?: JsonValue;
  readonly pages?: readonly number[];
  readonly pageRefs?: readonly PageRef[];
  readonly otherDocumentLabel?: string | null;
  readonly index?: number;
  readonly from?: number;
  readonly to?: number;
  readonly sourceFiles?: readonly SourceRange[];
  readonly beforeSourceFiles?: readonly SourceRange[];
  readonly takenFrom?: readonly {
    readonly documentId: string;
    readonly label: string | null;
    readonly count: number;
  }[];
  readonly removedDocuments?: readonly {
    readonly documentId: string;
    readonly label: string | null;
  }[];
  readonly fromExcluded?: number;
  readonly structureDocuments?: readonly Omit<
    StructureDocumentChange,
    "stepId"
  >[];
  readonly detail?: Readonly<Record<string, string | number>>;
};

/** 값 자리 경로의 한 단계: 필드 제목 또는 배열 위치(1-based). */
export type FieldPathSegment =
  | { readonly kind: "key"; readonly title: string }
  | { readonly kind: "index"; readonly index: number };

export type ValueEntry = Extract<ChangeEntry, { readonly resultId: string }>;

export type ChangeEntry = ChangeDraft & {
  readonly id: string;
  readonly seq: number;
  readonly description: ChangeDescription;
};

/** 세션이 항목에 붙이는 필드(`ChangeEntry` 에만 있고 `ChangeDraft` 에는 없는 키). */
export const CHANGE_ENTRY_ONLY_KEYS = ["id", "seq", "description"] as const;

type ChangeEntryOnlyKey = Exclude<keyof ChangeEntry, keyof ChangeDraft>;
// 목록이 `ChangeEntry` 의 세션 전용 키와 정확히 같아야 컴파일된다(빠지거나 남는 키가 있으면 오류).
const _onlyEntryKeys: readonly ChangeEntryOnlyKey[] = CHANGE_ENTRY_ONLY_KEYS;
const _allEntryKeys: Exclude<
  ChangeEntryOnlyKey,
  (typeof CHANGE_ENTRY_ONLY_KEYS)[number]
> extends never
  ? true
  : never = true;
void _onlyEntryKeys;
void _allEntryKeys;

/** 변경 항목에서 세션이 붙인 키를 뗀 draft(다시 적용할 수 있는 모양). */
export function toDraft(entry: ChangeEntry): ChangeDraft {
  const skip: ReadonlySet<string> = new Set(CHANGE_ENTRY_ONLY_KEYS);
  const draft: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (!skip.has(key)) draft[key] = value;
  }
  return draft as unknown as ChangeDraft;
}

export type ReviewSession = {
  /** 불러온(또는 마지막 저장을 채택한) 문서. */
  readonly base: ReviewDocument;
  readonly entries: readonly ChangeEntry[];
  /** `replay(base, entries)` 와 같은 상태. */
  readonly current: ReviewDocument;
  readonly nextSeq: number;
};

// ---------------------------------------------------------------------------
// 적용
// ---------------------------------------------------------------------------

function applyToJob(job: ReviewJob, draft: ChangeDraft): EditResult {
  switch (draft.kind) {
    case "set_value":
      return setValue(job, draft.resultId, draft.path, draft.value);
    case "replace_subtree":
      return replaceSubtree(job, draft.resultId, draft.path, draft.value);
    case "insert_item":
      return insertItem(
        job,
        draft.resultId,
        draft.path,
        draft.index,
        draft.value,
      );
    case "remove_item":
      return removeItem(job, draft.resultId, draft.path, draft.index);
    case "move_item":
      return moveItem(job, draft.resultId, draft.path, draft.from, draft.to);
    case "set_key":
      return setKey(job, draft.resultId, draft.path, draft.key, draft.value);
    case "remove_key":
      return removeKey(job, draft.resultId, draft.path, draft.key);
    case "set_label":
      return setLabel(job, draft.stepId, draft.documentId, draft.label);
    case "reorder_pages":
      return reorderPages(
        job,
        draft.stepId,
        draft.documentId,
        draft.page,
        draft.toIndex,
      );
    case "reorder_documents":
      return reorderDocuments(
        job,
        draft.stepId,
        draft.documentId,
        draft.toIndex,
      );
    case "split_document":
      return splitDocument(
        job,
        draft.stepId,
        draft.documentId,
        draft.afterPage,
        draft.newDocumentId,
      );
    case "merge_documents":
      return mergeDocuments(
        job,
        draft.stepId,
        draft.intoDocumentId,
        draft.fromDocumentId,
      );
    case "move_pages":
      return movePages(
        job,
        draft.stepId,
        draft.fromDocumentId,
        draft.pages,
        draft.to,
      );
    case "exclude_pages":
      return excludePages(job, draft.stepId, draft.fromDocumentId, draft.pages);
    case "restore_pages":
      return restorePages(job, draft.stepId, draft.pages, draft.to);
    case "set_page_ranges":
      return setPageRanges(
        job,
        draft.stepId,
        draft.documentId,
        draft.sourceFiles,
      );
    case "add_document":
      return addDocument(
        job,
        draft.stepId,
        draft.newDocumentId,
        draft.groupId,
        draft.label,
        draft.sourceFiles,
        draft.index,
      );
    case "exclude_document":
      return excludeDocument(job, draft.documentId);
    case "restore_document":
      return restoreDocument(job, draft.documentId);
    case "move_file":
      return moveFile(job, draft.fileRef, draft.to);
    case "replace_structure":
      return replaceStructure(job, draft.fileGroups, draft.layouts);
    default: {
      // 타입상 도달하지 않지만 임시 저장에서 복원한 draft 는 kind 가 깨져 있을 수 있다.
      const unreachable: never = draft;
      void unreachable;
      return { ok: false, reason: "target_missing" };
    }
  }
}

/** draft 하나를 문서에 적용(새 문서 반환). Job 이 없으면 `target_missing`. */
export function applyEntry(
  doc: ReviewDocument,
  draft: ChangeDraft,
): EditResult<ReviewDocument> {
  const index = doc.jobs.findIndex(job => job.id === draft.jobId);
  const job = doc.jobs[index];
  if (!job) return { ok: false, reason: "target_missing" };
  const outcome = applyToJob(job, draft);
  if (!outcome.ok) return outcome;
  const jobs = [...doc.jobs];
  jobs[index] = outcome.job;
  return { ok: true, job: { ...doc, jobs } };
}

// ---------------------------------------------------------------------------
// 설명
// ---------------------------------------------------------------------------

function safePages(document: ReviewDocumentEntry | null): PageRef[] {
  if (!document) return [];
  try {
    return flattenPages(document);
  } catch {
    return [];
  }
}

function safeSources(sources: readonly SourceRange[]): PageRef[] {
  try {
    return flattenSources(sources);
  } catch {
    return [];
  }
}

/** 범위를 파일마다 `"1-3, 5"` 로 만들어 `"; "` 로 잇는다. */
function formatSources(sources: readonly SourceRange[]): string {
  return sources.map(source => formatPageRanges(source.page_ranges)).join("; ");
}

function positionsOf(
  pages: readonly PageRef[],
  targets: readonly PageRef[],
): number[] {
  const keys = new Set(targets.map(pageKey));
  const out: number[] = [];
  pages.forEach((page, index) => {
    if (keys.has(pageKey(page))) out.push(index + 1);
  });
  return out;
}

/** 값 항목 설명의 공통 부분: 결과가 읽는 문서·Step 이름, 자리의 제목·pointer. */
function describeValue(
  doc: ReviewDocument,
  job: ReviewJob | undefined,
  draft: ValueDraft,
  target: JsonPath,
): ChangeDescription & { readonly current: JsonValue | undefined } {
  const result = job ? findResult(job, draft.resultId) : null;
  const step =
    result && Object.hasOwn(doc.steps, result.step_id)
      ? doc.steps[result.step_id]
      : undefined;
  const current = result ? nodeAt(result.content, target) : undefined;
  const wrapped = result
    ? isHiddenWrapper(step?.schema ?? null, result.content)
    : false;
  const schemaTarget = schemaPath(wrapped, target);
  const match =
    step?.schema && result
      ? schemaAt(step.schema, schemaTarget, current)
      : null;
  const documentIds = result ? linkedDocumentIds(result) : [];
  const first = documentIds[0];
  const located =
    job && first !== undefined
      ? documentsOf(job).find(item => item.document.document_id === first)
      : undefined;
  return {
    documentLabel: located?.document.label ?? null,
    documentIds,
    ...(step ? { stepName: step.name } : {}),
    fieldTitle: fieldTitle(match?.node ?? null, schemaTarget),
    ...(schemaTarget.some(isIndexToken)
      ? { fieldPath: fieldPathOf(result, step, schemaTarget, wrapped) }
      : {}),
    pointer: toPointer(target),
    current,
  };
}

/** `fieldPath` 의 단계들. 위치는 1-based, 키는 그 자리의 schema 제목(없으면 키). */
function fieldPathOf(
  result: Result | null,
  step: ReviewStep | undefined,
  schemaTarget: JsonPath,
  wrapped: boolean,
): FieldPathSegment[] {
  return schemaTarget.map((key, at) => {
    if (isIndexToken(key)) return { kind: "index", index: Number(key) + 1 };
    const path = schemaTarget.slice(0, at + 1);
    const value = result
      ? nodeAt(result.content, wrapped ? ["0", ...path] : path)
      : undefined;
    const match = step?.schema ? schemaAt(step.schema, path, value) : null;
    return { kind: "key", title: fieldTitle(match?.node ?? null, path) };
  });
}

/** 값 항목의 설명. 적용 전 상태에서 바뀌는 자리를 읽는다. */
function describeValueChange(
  doc: ReviewDocument,
  job: ReviewJob | undefined,
  draft: ValueDraft,
): ChangeDescription {
  const target =
    draft.kind === "set_key" || draft.kind === "remove_key"
      ? [...draft.path, draft.key]
      : draft.path;
  const { current, ...base } = describeValue(doc, job, draft, target);
  const items = Array.isArray(current) ? current : null;
  switch (draft.kind) {
    case "set_value":
    case "replace_subtree":
      return {
        ...base,
        ...(current === undefined ? {} : { before: current }),
        after: draft.value,
      };
    case "insert_item":
      return { ...base, index: draft.index + 1, after: draft.value };
    case "remove_item": {
      const removed = items?.[draft.index];
      return {
        ...base,
        index: draft.index + 1,
        ...(removed === undefined ? {} : { before: removed }),
      };
    }
    case "move_item":
      return { ...base, from: draft.from + 1, to: draft.to + 1 };
    case "set_key":
      return { ...base, after: draft.value };
    case "remove_key":
      return { ...base, ...(current === undefined ? {} : { before: current }) };
    default: {
      const unreachable: never = draft;
      return unreachable;
    }
  }
}

/**
 * 파일 이동의 설명. 트레이에서는 "문서 구성" 묶음에 들어가고(`documentIds[0]`), 뒤에
 * 함께 옮겨 가는 문서 id 가 붙는다. `detail.fileRef` 는 파일(이름은 host 가 붙인다),
 * `detail.group` 은 기존 그룹으로 옮길 때 이동 뒤 그룹 순서(1-based — 파일이 빠져 비는
 * 원 그룹은 세지 않는다).
 */
function describeMoveFile(
  job: ReviewJob | undefined,
  fileRef: string,
  to: FileMoveTarget,
): ChangeDescription {
  const groups = job?.file_groups?.groups ?? [];
  const moved = job
    ? documentsOf(job)
        .filter(item =>
          item.document.source_files.some(
            source => source.file_ref === fileRef,
          ),
        )
        .map(item => item.document.document_id)
    : [];
  const detail: Record<string, string | number> = { fileRef };
  if ("groupId" in to) {
    const emptied = (index: number) => {
      const files = groups[index]?.files ?? [];
      return files.length === 1 && files[0]?.file_ref === fileRef;
    };
    const at = groups.findIndex(group => group.group_id === to.groupId);
    if (at >= 0) {
      let position = 0;
      for (let index = 0; index <= at; index += 1) {
        if (!emptied(index)) position += 1;
      }
      detail.group = position;
    }
  }
  return {
    documentLabel: null,
    documentIds: [STRUCTURE_GROUP_ID, ...moved],
    detail,
  };
}

/**
 * 다른 문서·제외 목록에서 가져온 페이지를 설명 필드로. 가져온 것이 없으면 빈 객체.
 * 라벨은 적용 전 layout 에서 찾는다.
 */
function takeFields(
  report: PageTakeReport | null,
  labelOf: (documentId: string) => string | null,
): Pick<ChangeDescription, "takenFrom" | "removedDocuments" | "fromExcluded"> {
  if (!report) return {};
  return {
    ...(report.taken.length > 0
      ? {
          takenFrom: report.taken.map(take => ({
            documentId: take.documentId,
            label: labelOf(take.documentId),
            count: take.count,
          })),
        }
      : {}),
    ...(report.removed.length > 0
      ? {
          removedDocuments: report.removed.map(documentId => ({
            documentId,
            label: labelOf(documentId),
          })),
        }
      : {}),
    ...(report.fromExcluded > 0 ? { fromExcluded: report.fromExcluded } : {}),
  };
}

/** 주 대상 id 뒤에 페이지를 내준 문서 id 를 중복 없이 붙인다. */
function withTakenIds(
  primary: string,
  report: PageTakeReport | null,
): readonly string[] {
  return [
    ...new Set([primary, ...(report?.taken ?? []).map(t => t.documentId)]),
  ];
}

/**
 * 구조 통째 교체: 개수와 함께 적용 전 Job 과 교체 결과를 비교해 바뀐 수와 바뀐 문서를
 * 적는다. 바뀐 문서 id 는 `documentIds` 뒤에 붙는다(여러 보기에 같은 id 가 있으면 한 번).
 * Job 이 없거나 적용이 실패하면 개수만.
 */
function describeReplaceStructure(
  job: ReviewJob | undefined,
  draft: Extract<ChangeDraft, { readonly kind: "replace_structure" }>,
): ChangeDescription {
  const counts = {
    documents: draft.layouts.reduce(
      (sum, layout) => sum + layout.content.documents.length,
      0,
    ),
    excludedDocuments: draft.fileGroups.excluded_documents.length,
    excludedPages: safeSources(draft.fileGroups.excluded_pages).length,
  };
  const outcome = job ? applyToJob(job, draft) : null;
  if (!job || !outcome?.ok) {
    return {
      documentLabel: null,
      documentIds: [STRUCTURE_GROUP_ID],
      detail: counts,
    };
  }
  const summary = summarizeStructureReplacement(job, outcome.job);
  const seen = new Set<string>();
  const structureDocuments: Omit<StructureDocumentChange, "stepId">[] = [];
  for (const change of summary.documents) {
    if (seen.has(change.documentId)) continue;
    seen.add(change.documentId);
    structureDocuments.push({
      documentId: change.documentId,
      status: change.status,
      position: change.position,
      before: change.before,
      after: change.after,
      labelChanged: change.labelChanged,
      rangesChanged: change.rangesChanged,
      pageSetChanged: change.pageSetChanged,
    });
  }
  return {
    documentLabel: null,
    documentIds: [STRUCTURE_GROUP_ID, ...seen],
    detail: {
      ...counts,
      labelChanged: summary.labelChanged,
      rangesChanged: summary.rangesChanged,
      added: summary.added,
      removed: summary.removed,
      reordered: summary.reordered,
      groupsChanged: summary.groupsChanged ? 1 : 0,
    },
    ...(structureDocuments.length > 0 ? { structureDocuments } : {}),
  };
}

/** 적용 전 상태(`doc`)에서 draft 의 트레이 문구 재료를 만든다. */
export function describeChange(
  doc: ReviewDocument,
  draft: ChangeDraft,
): ChangeDescription {
  const job = doc.jobs.find(item => item.id === draft.jobId);
  const labelOf = (stepId: string | null, documentId: string) =>
    (job && findDocument(job, stepId, documentId)?.label) ?? null;
  const documentOf = (stepId: string | null, documentId: string) =>
    (job && findDocument(job, stepId, documentId)) ?? null;

  switch (draft.kind) {
    case "set_value":
    case "replace_subtree":
    case "insert_item":
    case "remove_item":
    case "move_item":
    case "set_key":
    case "remove_key":
      return describeValueChange(doc, job, draft);
    case "set_label":
      return {
        documentLabel: labelOf(draft.stepId, draft.documentId),
        documentIds: [draft.documentId],
        before: labelOf(draft.stepId, draft.documentId),
        after: draft.label,
      };
    case "reorder_pages": {
      const pages = safePages(documentOf(draft.stepId, draft.documentId));
      return {
        documentLabel: labelOf(draft.stepId, draft.documentId),
        documentIds: [draft.documentId],
        pages: positionsOf(pages, [draft.page]),
        pageRefs: [draft.page],
        after: draft.toIndex + 1,
      };
    }
    case "reorder_documents": {
      const before = job
        ? documentsOf(job).find(
            item =>
              item.stepId === draft.stepId &&
              item.document.document_id === draft.documentId,
          )
        : undefined;
      return {
        documentLabel: labelOf(draft.stepId, draft.documentId),
        documentIds: [draft.documentId],
        ...(before ? { before: before.index + 1 } : {}),
        after: draft.toIndex + 1,
      };
    }
    case "split_document": {
      const pages = safePages(documentOf(draft.stepId, draft.documentId));
      return {
        documentLabel: labelOf(draft.stepId, draft.documentId),
        documentIds: [draft.documentId, draft.newDocumentId],
        pages: positionsOf(pages, [draft.afterPage]),
        pageRefs: [draft.afterPage],
      };
    }
    case "merge_documents":
      return {
        documentLabel: labelOf(draft.stepId, draft.intoDocumentId),
        documentIds: [draft.intoDocumentId, draft.fromDocumentId],
        otherDocumentLabel: labelOf(draft.stepId, draft.fromDocumentId),
      };
    case "move_pages": {
      const pages = safePages(documentOf(draft.stepId, draft.fromDocumentId));
      const targetId =
        "documentId" in draft.to ? draft.to.documentId : draft.to.newDocumentId;
      return {
        documentLabel: labelOf(draft.stepId, draft.fromDocumentId),
        documentIds: [draft.fromDocumentId, targetId],
        pages: positionsOf(pages, draft.pages),
        pageRefs: draft.pages,
        otherDocumentLabel:
          "documentId" in draft.to
            ? labelOf(draft.stepId, draft.to.documentId)
            : draft.to.label !== undefined
              ? draft.to.label
              : labelOf(draft.stepId, draft.fromDocumentId),
      };
    }
    case "exclude_pages": {
      const pages = safePages(documentOf(draft.stepId, draft.fromDocumentId));
      return {
        documentLabel: labelOf(draft.stepId, draft.fromDocumentId),
        documentIds: [draft.fromDocumentId],
        pages: positionsOf(pages, draft.pages),
        pageRefs: draft.pages,
      };
    }
    case "restore_pages":
      return "documentId" in draft.to
        ? {
            documentLabel: labelOf(draft.stepId, draft.to.documentId),
            documentIds: [draft.to.documentId],
            pageRefs: draft.pages,
          }
        : {
            documentLabel: draft.to.label ?? null,
            documentIds: [draft.to.newDocumentId],
            pageRefs: draft.pages,
          };
    case "set_page_ranges": {
      const before = documentOf(draft.stepId, draft.documentId);
      const report =
        job && before
          ? previewPageTake(
              job,
              draft.stepId,
              draft.documentId,
              draft.sourceFiles,
            )
          : null;
      return {
        documentLabel: before?.label ?? null,
        documentIds: withTakenIds(draft.documentId, report),
        ...takeFields(report, id => labelOf(draft.stepId, id)),
        ...(before
          ? {
              beforeSourceFiles: before.source_files,
              before: formatSources(before.source_files),
            }
          : {}),
        sourceFiles: draft.sourceFiles,
        after: formatSources(draft.sourceFiles),
      };
    }
    case "add_document": {
      const report = job
        ? previewPageTake(job, draft.stepId, null, draft.sourceFiles)
        : null;
      return {
        documentLabel: draft.label,
        documentIds: withTakenIds(draft.newDocumentId, report),
        ...takeFields(report, id => labelOf(draft.stepId, id)),
        pageRefs: safeSources(draft.sourceFiles),
        sourceFiles: draft.sourceFiles,
        after: formatSources(draft.sourceFiles),
      };
    }
    case "exclude_document":
    case "restore_document": {
      // 보기가 정해지지 않은 Job 단위 연산이라 모든 보기에서 id 로 찾는다.
      const located = job
        ? documentsOf(job).find(
            item => item.document.document_id === draft.documentId,
          )
        : undefined;
      return {
        documentLabel: located?.document.label ?? null,
        documentIds: [draft.documentId],
      };
    }
    case "move_file":
      return describeMoveFile(job, draft.fileRef, draft.to);
    case "replace_structure":
      return describeReplaceStructure(job, draft);
    default: {
      const unreachable: never = draft;
      return unreachable;
    }
  }
}

/** 항목이 건드리는 문서·결과 id(트레이 묶음·하이라이트용). */
export function entryTargets(entry: ChangeEntry): {
  documentIds: readonly string[];
  resultIds: readonly string[];
} {
  return {
    documentIds: entry.description.documentIds,
    resultIds: isValueEntry(entry) ? [entry.resultId] : [],
  };
}

// ---------------------------------------------------------------------------
// 세션
// ---------------------------------------------------------------------------

function entryId(seq: number): string {
  return `change-${seq}`;
}

/**
 * base 부터 항목을 순서대로 다시 적용한다. 전제가 깨진 항목은 `dropped` 로 빼고
 * 계속한다. 설명은 적용 직전 상태로 다시 계산한다(앞 항목이 빠지면 "전" 값이 달라진다).
 * 모든 연산이 불변이라 base 를 복제하지 않고 구조를 공유한다.
 */
export function replay(
  base: ReviewDocument,
  entries: readonly ChangeEntry[],
): {
  current: ReviewDocument;
  applied: ChangeEntry[];
  dropped: { entry: ChangeEntry; reason: DropReason }[];
} {
  let current = base;
  const applied: ChangeEntry[] = [];
  const dropped: { entry: ChangeEntry; reason: DropReason }[] = [];
  for (const entry of entries) {
    const description = describeChange(current, entry);
    const outcome = applyEntry(current, entry);
    if (!outcome.ok) {
      dropped.push({ entry, reason: outcome.reason });
      continue;
    }
    current = outcome.job;
    applied.push({ ...entry, description });
  }
  return { current, applied, dropped };
}

export function createSession(base: ReviewDocument): ReviewSession {
  return { base, entries: [], current: base, nextSeq: 1 };
}

function sameValueTarget(entry: ChangeEntry | undefined, draft: ChangeDraft) {
  return (
    entry !== undefined &&
    entry.kind === "set_value" &&
    draft.kind === "set_value" &&
    entry.jobId === draft.jobId &&
    entry.resultId === draft.resultId &&
    toPointer(entry.path) === toPointer(draft.path)
  );
}

/**
 * 값 항목 `entry` 가 `draft`(같은 결과의 `set_value`)와 같은 자리나 그 상위·하위를
 * 바꿨는가. 그런 항목이 사이에 있으면 앞의 같은 경로 `set_value` 와 합치지 않는다.
 */
function blocksMerge(entry: ChangeEntry, draft: ValueDraft): boolean {
  if (
    !isValueEntry(entry) ||
    entry.jobId !== draft.jobId ||
    entry.resultId !== draft.resultId
  ) {
    return false;
  }
  const path = targetPath(entry);
  return startsWith(path, draft.path) || startsWith(draft.path, path);
}

/** 합칠 앞 `set_value` 의 위치. 없거나 사이에 막는 항목이 있으면 -1. */
function mergeIndex(
  entries: readonly ChangeEntry[],
  draft: ChangeDraft,
): number {
  if (draft.kind !== "set_value") return -1;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index] as ChangeEntry;
    if (sameValueTarget(entry, draft)) return index;
    if (blocksMerge(entry, draft)) return -1;
  }
  return -1;
}

/**
 * 합칠 앞 `set_label`(같은 Step 보기의 같은 문서)의 위치. 그 사이에 값 항목이나 다른 문서의 라벨
 * 변경만 있으면 합치고, 문서 구성을 바꾼 항목이 있으면 순서가 중요해지므로 합치지 않는다(-1).
 */
function labelMergeIndex(
  entries: readonly ChangeEntry[],
  draft: ChangeDraft,
): number {
  if (draft.kind !== "set_label") return -1;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index] as ChangeEntry;
    if (entry.kind === "set_label") {
      if (
        entry.jobId === draft.jobId &&
        entry.stepId === draft.stepId &&
        entry.documentId === draft.documentId
      ) {
        return index;
      }
      continue;
    }
    if (!isValueEntry(entry)) return -1;
  }
  return -1;
}

/**
 * 변경 결과가 불러온 문서와 완전히 같아졌으면(바꿨다가 모두 되돌린 경우) 항목을 모두 비운다. 값, 라벨,
 * 문서 구성 등 어떤 변경 뒤에도, 되돌린 뒤에도 쓴다. 바뀌지 않은 부분은 같은 객체를 함께 쓰므로 비교는
 * 바뀐 경로만 따라간다.
 */
function settleToBase(session: ReviewSession): ReviewSession {
  if (session.entries.length === 0) return session;
  return jsonEquals(session.current, session.base)
    ? { ...session, entries: [], current: session.base }
    : session;
}

/**
 * 변경 하나를 `current` 에 증분 적용한다(전체 replay 없음). 전제가 맞지 않으면
 * `ok: false` 이고 세션은 그대로다. 앞에 같은 결과·경로의 `set_value` 가 있고 그
 * 사이에 그 경로의 상위·하위를 바꾼 값 항목이 없으면 그 항목에 합치고(자리·`before`
 * 는 처음 것), 합친 값이 처음 값과 같아지면 항목을 지운다 — 이때 `entry` 는 `null`.
 * 합칠 항목이 없는 `set_value` 가 지금 값과 같으면 아무것도 바꾸지 않는다(`entry`
 * 는 `null`, 세션은 그대로) — 같은 입력이 두 번 확정돼도 항목이 생기지 않는다.
 * 같은 문서의 라벨 변경도 앞 항목에 합치고 처음 라벨로 돌아오면 지운다. 어떤 변경이든 그 결과 문서
 * 전체가 불러온 상태와 같아지면 항목을 모두 비운다. 값은 넘어온 그대로 적용한다(입력칸에서 비운
 * 필드를 `null` 로 볼지는 화면이 정한다).
 */
export function addChange(
  session: ReviewSession,
  draft: ChangeDraft,
):
  | { ok: true; session: ReviewSession; entry: ChangeEntry | null }
  | { ok: false; reason: DropReason } {
  const outcome = addChangeRaw(session, draft);
  if (!outcome.ok || outcome.session === session) return outcome;
  const settled = settleToBase(outcome.session);
  return settled === outcome.session
    ? outcome
    : { ok: true, session: settled, entry: null };
}

/** `addChange` 에서 불러온 상태로 돌아왔는지 따지기 전 단계. */
function addChangeRaw(
  session: ReviewSession,
  input: ChangeDraft,
):
  | { ok: true; session: ReviewSession; entry: ChangeEntry | null }
  | { ok: false; reason: DropReason } {
  // 빈 라벨은 적용(`setLabel`)과 같이 `null` 로 — 항목·설명·합치기 비교가 적용 결과와 맞게.
  const draft: ChangeDraft =
    input.kind === "set_label"
      ? { ...input, label: normalizeLabel(input.label) }
      : input;
  const description = describeChange(session.current, draft);
  const at = mergeIndex(session.entries, draft);
  const earlier = session.entries[at];
  const outcome = applyEntry(session.current, draft);
  if (!outcome.ok) return outcome;
  if (
    !earlier &&
    draft.kind === "set_value" &&
    description.before !== undefined &&
    jsonEquals(description.before, draft.value)
  ) {
    return { ok: true, session, entry: null };
  }
  if (earlier && draft.kind === "set_value") {
    const firstBefore = earlier.description.before;
    if (firstBefore !== undefined && jsonEquals(firstBefore, draft.value)) {
      return {
        ok: true,
        session: {
          ...session,
          entries: session.entries.filter((_, index) => index !== at),
          current: outcome.job,
        },
        entry: null,
      };
    }
    const merged = {
      ...earlier,
      value: draft.value,
      description: { ...earlier.description, after: draft.value },
    } as ChangeEntry;
    return {
      ok: true,
      session: {
        ...session,
        entries: session.entries.map((entry, index) =>
          index === at ? merged : entry,
        ),
        current: outcome.job,
      },
      entry: merged,
    };
  }
  const labelAt = labelMergeIndex(session.entries, draft);
  const earlierLabel = session.entries[labelAt];
  if (earlierLabel && draft.kind === "set_label") {
    if (earlierLabel.description.before === draft.label) {
      const dropped = {
        ...session,
        entries: session.entries.filter((_, index) => index !== labelAt),
        current: outcome.job,
      };
      return { ok: true, session: dropped, entry: null };
    }
    const merged = {
      ...earlierLabel,
      label: draft.label,
      description: { ...earlierLabel.description, after: draft.label },
    } as ChangeEntry;
    return {
      ok: true,
      session: {
        ...session,
        entries: session.entries.map((entry, index) =>
          index === labelAt ? merged : entry,
        ),
        current: outcome.job,
      },
      entry: merged,
    };
  }
  const entry: ChangeEntry = {
    ...draft,
    id: entryId(session.nextSeq),
    seq: session.nextSeq,
    description,
  };
  return {
    ok: true,
    session: {
      ...session,
      entries: [...session.entries, entry],
      current: outcome.job,
      nextSeq: session.nextSeq + 1,
    },
    entry,
  };
}

/** 값 항목이 바꾸는 자리(키 연산은 경로 + 키). */
function targetPath(entry: ValueDraft): JsonPath {
  return entry.kind === "set_key" || entry.kind === "remove_key"
    ? [...entry.path, entry.key]
    : entry.path;
}

/**
 * 배열·키·하위 트리를 바꾼 항목이 "소유"하는 경로 접두. 이 접두 아래의 뒤 항목은
 * 그 항목이 만든 자리(배열 index 는 정체성이 아니라 자리)에 기대므로 함께 되돌린다.
 * leaf 하나만 바꾸는 `set_value` 는 소유 접두가 없다.
 */
function ownedPrefix(entry: ChangeEntry): JsonPath | null {
  if (!isValueEntry(entry) || entry.kind === "set_value") return null;
  return targetPath(entry);
}

/**
 * 자리를 통째로 덮어쓰거나 지운 항목이 덮은 경로(하위 트리 교체는 그 경로, 키 삭제는
 * 경로 + 키, 항목 삭제는 배열 경로 + 그 index). 그 경로나 아래를 고친 앞 항목의 결과를
 * 보고 만든 항목이라, 앞 항목을 되돌리면 함께 되돌린다. 그 밖의 종류는 null.
 */
function overwrittenPath(entry: ChangeEntry): JsonPath | null {
  switch (entry.kind) {
    case "replace_subtree":
      return entry.path;
    case "remove_key":
      return [...entry.path, entry.key];
    case "remove_item":
      return [...entry.path, String(entry.index)];
    default:
      return null;
  }
}

/**
 * 뒤 항목 `later` 가 앞 항목 `earlier` 의 결과에 기대는가.
 *
 * - 같은 결과의 값 항목끼리: `later` 가 `earlier` 의 소유 접두 아래를 고쳤거나,
 *   `later` 가 `earlier` 의 자리 또는 그 상위를 덮어썼다.
 * - `later` 가 구조 통째 교체이고 `earlier` 가 같은 Job 의 구조 항목: 교체본은 앞 구조
 *   편집이 반영된 상태를 통째로 담고 있다.
 */
function dependsOn(later: ChangeEntry, earlier: ChangeEntry): boolean {
  if (later.jobId !== earlier.jobId) return false;
  if (isValueEntry(earlier)) {
    if (!isValueEntry(later) || later.resultId !== earlier.resultId) {
      return false;
    }
    const owned = ownedPrefix(earlier);
    if (owned && startsWith(targetPath(later), owned)) return true;
    const covered = overwrittenPath(later);
    return covered !== null && startsWith(targetPath(earlier), covered);
  }
  return later.kind === "replace_structure";
}

function startsWith(path: JsonPath, prefix: JsonPath): boolean {
  return (
    path.length >= prefix.length &&
    prefix.every((token, index) => path[index] === token)
  );
}

/**
 * 구조 항목이 페이지 집합을 바꾼 문서 id. 세션에 저장된 설명(적용 직전 상태 기준)을
 * 읽는다. 페이지 범위 지정은 순서만 바꿨으면 대상을 넣지 않는다.
 */
function pageSetChangedDocuments(entry: ChangeEntry): readonly string[] {
  const description = entry.description;
  const taken = [
    ...(description.takenFrom ?? []).map(take => take.documentId),
    ...(description.removedDocuments ?? []).map(item => item.documentId),
  ];
  switch (entry.kind) {
    case "set_page_ranges": {
      const before = description.beforeSourceFiles;
      const same =
        before !== undefined &&
        pageSetEquals(safeSources(before), safeSources(entry.sourceFiles));
      return same ? taken : [entry.documentId, ...taken];
    }
    case "add_document":
      return [entry.newDocumentId, ...taken];
    case "move_pages": {
      const target =
        "documentId" in entry.to ? entry.to.documentId : entry.to.newDocumentId;
      return target === entry.fromDocumentId
        ? []
        : [entry.fromDocumentId, target];
    }
    case "split_document":
      return [entry.documentId, entry.newDocumentId];
    case "merge_documents":
      return [entry.intoDocumentId, entry.fromDocumentId];
    case "exclude_pages":
      return [entry.fromDocumentId];
    case "restore_pages":
      return [
        "documentId" in entry.to ? entry.to.documentId : entry.to.newDocumentId,
      ];
    case "replace_structure":
      return (description.structureDocuments ?? [])
        .filter(change => change.pageSetChanged)
        .map(change => change.documentId);
    default:
      return [];
  }
}

/**
 * 항목 하나를 되돌린다: 빼고 base 부터 replay. 뒤 항목 중 다음은 함께 빼고
 * `depends_on_reverted` 로 알린다 — 되돌리는 항목에 기대는 항목(`dependsOn`: 소유
 * 접두 아래를 고쳤거나 그 자리·상위를 덮어쓴 값 항목, 구조 항목 뒤의 구조 통째 교체),
 * 페이지 집합을 바꾼 항목이면 그 문서들의 페이지 범위를 다시 적은 항목(앞 항목이 만든
 * 페이지 집합을 전제로 적은 절대 범위라서). 함께 뺀 항목에 기대는 항목·그 항목이 바꾼
 * 문서도 이어서 따진다. 그 밖에 전제가 깨진 뒤 항목(분리한 문서의 라벨 등)도 replay 가
 * 빼고 그 사유로 알린다. `alsoReverted` 는 항목 순서. 없는 id 면 그대로.
 */
export function revertChange(
  session: ReviewSession,
  entryIdToRevert: string,
): {
  session: ReviewSession;
  alsoReverted: { entry: ChangeEntry; reason: DropReason }[];
} {
  const at = session.entries.findIndex(entry => entry.id === entryIdToRevert);
  const reverted = session.entries[at];
  if (!reverted) return { session, alsoReverted: [] };
  const dependent = new Set<string>();
  const removed: ChangeEntry[] = [reverted];
  const documentKey = (jobId: string, documentId: string) =>
    `${jobId}\u0000${documentId}`;
  const changedDocuments = new Set(
    pageSetChangedDocuments(reverted).map(id =>
      documentKey(reverted.jobId, id),
    ),
  );
  for (const entry of session.entries.slice(at + 1)) {
    const depends =
      removed.some(earlier => dependsOn(entry, earlier)) ||
      (entry.kind === "set_page_ranges" &&
        changedDocuments.has(documentKey(entry.jobId, entry.documentId)));
    if (!depends) continue;
    dependent.add(entry.id);
    removed.push(entry);
    for (const id of pageSetChangedDocuments(entry)) {
      changedDocuments.add(documentKey(entry.jobId, id));
    }
  }
  const { current, applied, dropped } = replay(
    session.base,
    session.entries.filter(
      entry => entry.id !== entryIdToRevert && !dependent.has(entry.id),
    ),
  );
  const alsoReverted = [
    ...session.entries
      .filter(entry => dependent.has(entry.id))
      .map(entry => ({ entry, reason: "depends_on_reverted" as DropReason })),
    ...dropped,
  ].sort((a, b) => a.entry.seq - b.entry.seq);
  return {
    session: settleToBase({ ...session, entries: applied, current }),
    alsoReverted,
  };
}

/** 모든 항목을 되돌린다. */
export function resetSession(session: ReviewSession): ReviewSession {
  return { ...session, entries: [], current: session.base };
}

const SERVER_DERIVED_STEP_TYPES = new Set(["validate", "merge"]);

/**
 * 저장(반영) 뒤: `applied_versions` 를 채택한 문서를 새 base 로 하고 항목을 비운다.
 * `current` = 받은 version 으로 이어서 고칠 수 있는가(`adoptAppliedVersions`).
 * `reloadRecommended` = 다시 불러와야 화면이 서버와 같아지는가 — version 을 다
 * 채택하지 못했거나, 구조를 바꿨거나(서버가 결과 연결·`input_changed` 를 다시
 * 판정), 서버가 다시 계산하는 결과(Validate `stale`·Merge 재합성)가 있는 Job 을 보냈을 때.
 */
export function commitSession(
  session: ReviewSession,
  units: readonly ImportUnit[] | null | undefined,
): { session: ReviewSession; current: boolean; reloadRecommended: boolean } {
  const adopted = adoptAppliedVersions(session.current, units);
  const touchedJobs = new Set(session.entries.map(entry => entry.jobId));
  const derived = adopted.doc.jobs.some(job => {
    if (!touchedJobs.has(job.id)) return false;
    const base = session.base.jobs.find(item => item.id === job.id);
    if (base && structureChanged(base, job)) return true;
    return results(job).some(result => {
      const step = Object.hasOwn(adopted.doc.steps, result.step_id)
        ? adopted.doc.steps[result.step_id]
        : undefined;
      return step !== undefined && SERVER_DERIVED_STEP_TYPES.has(step.type);
    });
  });
  return {
    session: createSession(adopted.doc),
    current: adopted.current,
    reloadRecommended: !adopted.current || derived,
  };
}
