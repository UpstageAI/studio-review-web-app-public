import { jsonEquals } from "./json";
import { canEditResult, layouts, results } from "./layout";
import { flattenPages, flattenSources, pageKey, pageSetEquals } from "./pages";
import type {
  FileGroup,
  FileGroups,
  PageRef,
  Result,
  ReviewDocumentEntry,
  ReviewJob,
  SourceRange,
} from "./types";

/** base 와 비교한 문서 하나의 변화. 주소는 `(stepId, documentId)`. */
export type DocumentChange = {
  readonly jobId: string;
  readonly documentId: string;
  readonly stepId: string | null;
  readonly status: "added" | "removed" | "changed" | "same";
  /** 페이지 "집합" 이 다르다(분리·합치기·옮기기·제외). 저장 뒤 결과가 `input_changed` 가 된다. */
  readonly pageSetChanged: boolean;
  /** 집합은 같고 페이지 순서만 다르다. */
  readonly orderOnly: boolean;
  /** 라벨만 다르다(페이지 목록은 같다). */
  readonly labelOnly: boolean;
  /** 양쪽에 다 있는 문서끼리의 상대 순서가 다르다. */
  readonly positionChanged: boolean;
};

function safePages(document: ReviewDocumentEntry): PageRef[] {
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

function sameSequence(a: readonly PageRef[], b: readonly PageRef[]): boolean {
  return (
    a.length === b.length &&
    a.every((page, index) => pageKey(page) === pageKey(b[index] as PageRef))
  );
}

function addressKey(stepId: string | null, documentId: string): string {
  return `${stepId === null ? "" : `s:${stepId}`}\u0000${documentId}`;
}

type Indexed = {
  readonly stepId: string | null;
  readonly document: ReviewDocumentEntry;
  /** 양쪽에 다 있는 문서만 센 보기 안 순번. */
  commonIndex: number;
};

function indexJob(job: ReviewJob): Map<string, Indexed> {
  const out = new Map<string, Indexed>();
  for (const layout of layouts(job)) {
    for (const document of layout.content.documents) {
      out.set(addressKey(layout.step_id, document.document_id), {
        stepId: layout.step_id,
        document,
        commonIndex: -1,
      });
    }
  }
  return out;
}

function assignCommonIndex(
  job: ReviewJob,
  own: Map<string, Indexed>,
  other: Map<string, Indexed>,
) {
  for (const layout of layouts(job)) {
    let index = 0;
    for (const document of layout.content.documents) {
      const key = addressKey(layout.step_id, document.document_id);
      if (!other.has(key)) continue;
      const entry = own.get(key);
      if (entry) entry.commonIndex = index++;
    }
  }
}

/**
 * 문서별 변화. 현재 보기 순서로 `added`·`changed`·`same` 을 내고, 사라진 문서
 * (`removed`)는 base 순서로 뒤에 붙인다.
 */
export function changedDocuments(
  base: ReviewJob,
  current: ReviewJob,
): readonly DocumentChange[] {
  const before = indexJob(base);
  const after = indexJob(current);
  assignCommonIndex(base, before, after);
  assignCommonIndex(current, after, before);
  const out: DocumentChange[] = [];
  for (const [key, now] of after) {
    const was = before.get(key);
    const documentId = now.document.document_id;
    if (!was) {
      out.push({
        jobId: current.id,
        documentId,
        stepId: now.stepId,
        status: "added",
        pageSetChanged: true,
        orderOnly: false,
        labelOnly: false,
        positionChanged: false,
      });
      continue;
    }
    const oldPages = safePages(was.document);
    const newPages = safePages(now.document);
    const pageSetChanged = !pageSetEquals(oldPages, newPages);
    const sequenceSame = sameSequence(oldPages, newPages);
    const labelChanged = was.document.label !== now.document.label;
    const positionChanged = was.commonIndex !== now.commonIndex;
    const changed = !sequenceSame || labelChanged || positionChanged;
    out.push({
      jobId: current.id,
      documentId,
      stepId: now.stepId,
      status: changed ? "changed" : "same",
      pageSetChanged,
      orderOnly: !pageSetChanged && !sequenceSame,
      labelOnly: labelChanged && sequenceSame,
      positionChanged,
    });
  }
  for (const [key, was] of before) {
    if (after.has(key)) continue;
    out.push({
      jobId: base.id,
      documentId: was.document.document_id,
      stepId: was.stepId,
      status: "removed",
      pageSetChanged: true,
      orderOnly: false,
      labelOnly: false,
      positionChanged: false,
    });
  }
  return out;
}

/** `content` 의미가 달라진 결과 id(숫자 정규형·키 순서 무시). current 의 순서. */
export function changedResults(
  base: ReviewJob,
  current: ReviewJob,
): readonly string[] {
  const original = new Map(results(base).map(result => [result.id, result]));
  return results(current)
    .filter(result => {
      const was = original.get(result.id);
      return !was || !jsonEquals(was.content, result.content);
    })
    .map(result => result.id);
}

function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every(item => right.has(item));
}

/** 그룹 구성(그룹 순서·파일 순서·`layout_step_id`)이 같은가. */
function sameGroups(before: FileGroups, after: FileGroups): boolean {
  return (
    before.groups.length === after.groups.length &&
    after.groups.every((group, index) => {
      const old = before.groups[index] as FileGroup;
      return (
        old.group_id === group.group_id &&
        old.layout_step_id === group.layout_step_id &&
        old.files.length === group.files.length &&
        group.files.every(
          (file, at) => old.files[at]?.file_ref === file.file_ref,
        )
      );
    })
  );
}

/**
 * 구조(`file_groups` + 문서 배치 보기)의 의미가 달라졌는가. 문서 구성·라벨·문서
 * 순서·페이지 순서·`excluded_*`·그룹 구성 중 하나라도 다르면 true. 인접 범위 병합처럼
 * 펼친 페이지가 같은 표기 차이는 변경이 아니다.
 */
export function structureChanged(base: ReviewJob, current: ReviewJob): boolean {
  const before = base.file_groups;
  const after = current.file_groups;
  if (!before || !after) return Boolean(before) !== Boolean(after);
  if (groupSettingsChanged(base, current)) return true;
  const oldLayouts = layouts(base);
  const newLayouts = layouts(current);
  if (oldLayouts.length !== newLayouts.length) return true;
  return newLayouts.some(layout => {
    const was = oldLayouts.find(item => item.step_id === layout.step_id);
    if (!was) return true;
    const a = was.content.documents;
    const b = layout.content.documents;
    if (a.length !== b.length) return true;
    return b.some((document, index) => {
      const old = a[index] as ReviewDocumentEntry;
      return (
        old.document_id !== document.document_id ||
        old.group_id !== document.group_id ||
        old.label !== document.label ||
        !sameSequence(safePages(old), safePages(document))
      );
    });
  });
}

/** 구조 통째 교체에서 라벨·페이지 범위가 바뀌었거나 추가·삭제된 문서 하나. */
export type StructureDocumentChange = {
  readonly documentId: string;
  readonly stepId: string | null;
  readonly status: "added" | "removed" | "changed";
  /** 보기 안 위치(1 기준). 교체 뒤 순서이고, 사라진 문서는 교체 전 순서. */
  readonly position: number;
  /** 라벨(교체 전·뒤). 없는 쪽은 null. */
  readonly before: string | null;
  readonly after: string | null;
  readonly labelChanged: boolean;
  /** 페이지 집합 또는 페이지 순서가 다르다. */
  readonly rangesChanged: boolean;
  readonly pageSetChanged: boolean;
};

export type StructureReplacementSummary = {
  readonly labelChanged: number;
  readonly rangesChanged: number;
  readonly added: number;
  readonly removed: number;
  /** 양쪽에 다 있는 문서끼리의 상대 순서가 바뀐 문서 수. */
  readonly reordered: number;
  /** 그룹 구성·제외 페이지·제외 문서 중 하나라도 다르다. */
  readonly groupsChanged: boolean;
  /** 라벨·범위·추가·삭제가 있는 문서(`changedDocuments` 순서). 순서만 바뀐 문서는 세기만 한다. */
  readonly documents: readonly StructureDocumentChange[];
};

function positions(job: ReviewJob): Map<string, number> {
  const out = new Map<string, number>();
  for (const layout of layouts(job)) {
    layout.content.documents.forEach((document, index) => {
      out.set(addressKey(layout.step_id, document.document_id), index + 1);
    });
  }
  return out;
}

function groupSettingsChanged(base: ReviewJob, current: ReviewJob): boolean {
  const before = base.file_groups;
  const after = current.file_groups;
  if (!before || !after) return Boolean(before) !== Boolean(after);
  return (
    !pageSetEquals(
      safeSources(before.excluded_pages),
      safeSources(after.excluded_pages),
    ) ||
    !sameStringSet(before.excluded_documents, after.excluded_documents) ||
    !sameGroups(before, after)
  );
}

/** 구조를 통째로 바꾼 전후(`before` → `after`)의 바뀐 수와 바뀐 문서. */
export function summarizeStructureReplacement(
  before: ReviewJob,
  after: ReviewJob,
): StructureReplacementSummary {
  const oldIndex = indexJob(before);
  const newIndex = indexJob(after);
  const oldPositions = positions(before);
  const newPositions = positions(after);
  const documents: StructureDocumentChange[] = [];
  let labelChanged = 0;
  let rangesChanged = 0;
  let added = 0;
  let removed = 0;
  let reordered = 0;
  for (const change of changedDocuments(before, after)) {
    if (change.status === "same") continue;
    const key = addressKey(change.stepId, change.documentId);
    const was = oldIndex.get(key)?.document ?? null;
    const now = newIndex.get(key)?.document ?? null;
    const label = {
      before: was?.label ?? null,
      after: now?.label ?? null,
    };
    if (change.status === "changed") {
      if (change.positionChanged) reordered += 1;
      const labelDiffers = label.before !== label.after;
      const ranges = change.pageSetChanged || change.orderOnly;
      if (labelDiffers) labelChanged += 1;
      if (ranges) rangesChanged += 1;
      if (!labelDiffers && !ranges) continue;
      documents.push({
        documentId: change.documentId,
        stepId: change.stepId,
        status: "changed",
        position: newPositions.get(key) ?? 0,
        ...label,
        labelChanged: labelDiffers,
        rangesChanged: ranges,
        pageSetChanged: change.pageSetChanged,
      });
      continue;
    }
    if (change.status === "added") added += 1;
    else removed += 1;
    documents.push({
      documentId: change.documentId,
      stepId: change.stepId,
      status: change.status,
      position:
        (change.status === "added"
          ? newPositions.get(key)
          : oldPositions.get(key)) ?? 0,
      ...label,
      labelChanged: false,
      rangesChanged: false,
      pageSetChanged: true,
    });
  }
  return {
    labelChanged,
    rangesChanged,
    added,
    removed,
    reordered,
    groupsChanged: groupSettingsChanged(before, after),
    documents,
  };
}

/**
 * 값 입력을 잠글 문서 id. 기본은 페이지 집합이 바뀐 문서만(서버는 결과가 읽은
 * 페이지 집합만 비교한다). `lockOnOrderChange` 면 페이지 순서만 바뀐 문서도 잠근다.
 */
export function lockedDocumentIds(
  changes: readonly DocumentChange[],
  options: { lockOnOrderChange?: boolean } = {},
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const change of changes) {
    if (
      change.pageSetChanged ||
      (options.lockOnOrderChange === true && change.orderOnly)
    ) {
      out.add(change.documentId);
    }
  }
  return out;
}

export type ValueLockReason =
  | "input_changed"
  | "unlinked"
  | "missing"
  | "unsupported_state"
  | "structure_changed";

/** 값 입력을 막는 서버 결과 상태 중 이유 이름이 따로 있는 것. 그 밖의 편집 불가 상태는 `unsupported_state`. */
export const LOCKED_RESULT_STATES: readonly ValueLockReason[] = [
  "input_changed",
  "unlinked",
  "missing",
];

/**
 * 값 입력을 막는 이유. 서버 `state` 가 먼저이고(`input_changed`·`unlinked`·
 * `missing`, 모르는 상태는 `unsupported_state`), 그다음 연결 문서의 페이지 집합이
 * 이 세션에서 바뀌었거나 문서가 사라졌으면 `structure_changed`. 막지 않으면 `null`.
 * `changes` 는 이 결과가 읽는 문서의 변화(`linkedDocumentIds`)를 넘긴다.
 */
export function valueLockReason(
  result: Result,
  changes?: DocumentChange | readonly DocumentChange[] | null,
): ValueLockReason | null {
  if (!canEditResult(result)) {
    return (
      LOCKED_RESULT_STATES.find(reason => reason === result.state) ??
      "unsupported_state"
    );
  }
  const list: readonly DocumentChange[] =
    changes == null
      ? []
      : Array.isArray(changes)
        ? changes
        : [changes as DocumentChange];
  return list.some(
    change => change.pageSetChanged || change.status === "removed",
  )
    ? "structure_changed"
    : null;
}
