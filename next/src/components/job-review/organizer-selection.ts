// 페이지 정리 화면의 여러 장 선택과 그 선택으로 만드는 일괄 변경의 순수 규칙.
// 선택은 페이지 키(`pageKey`) 집합이고, 일괄 변경은 원본 문서마다 변경 하나(`move_pages`·
// `exclude_pages`)를 만들어 순서대로 적용한다(앞 변경이 먼저 적용된 뒤의 위치로 계산한다).
// 고른 페이지를 끌어 놓은 것도 같은 일괄 변경(`drop`)이라 트레이에 한 묶음으로 보인다.
import type { StructureDocument } from "@/components/studio-ui-kit/structure-editor";
import {
  findDocument,
  flattenPages,
  pageKey,
  type ChangeDraft,
  type DropReason,
  type PageRef,
  type ReviewJob,
} from "@/lib/review-model";
import type { MovePagesPosition } from "./use-structure-actions";

/** 클릭과 함께 누른 키. `toggle` 은 ⌘(macOS)·Ctrl. */
export type Modifiers = { shift: boolean; toggle: boolean };

/** 고른 페이지 키와 Shift 범위의 기준(마지막으로 plain·toggle 클릭한 키). */
export type SelectionState = {
  keys: ReadonlySet<string>;
  anchor: string | null;
};

/** 문서 순 → 문서 안 순으로 늘어놓은 페이지 하나. */
export type OrderedPage = { documentId: string; key: string };

/** 원본 문서 하나에서 고른 페이지들(문서 안 순). */
export type BatchSelection = readonly {
  documentId: string;
  groupId: string;
  keys: readonly string[];
}[];

export type BatchAction =
  | {
      kind: "move";
      targetDocumentId: string;
      position: MovePagesPosition;
    }
  | { kind: "exclude" }
  /** `label` 이 있으면 새 문서 라벨(`null` 은 라벨 없음), 없으면 첫 원본 라벨. */
  | { kind: "new-document"; label?: string | null }
  /**
   * 끌어 놓기: 대상 문서의 `index`(끄는 페이지를 모두 뺀 뒤 기준, 0-based) 앞에 고른 페이지를
   * 문서 순 → 문서 안 순으로 모아 넣는다. `move` 와 달리 대상 문서에 든 고른 페이지도 함께 모인다.
   */
  | { kind: "drop"; targetDocumentId: string; index: number };

export const EMPTY_SELECTION: SelectionState = {
  keys: new Set(),
  anchor: null,
};

/**
 * 여러 장 선택에 들어갈 수 있는 페이지만 문서 순 → 문서 안 순으로 늘어놓는다. 겹친(overlap)
 * 페이지는 두 문서에 같은 키로 있어 선택 집합으로는 어느 쪽인지 가릴 수 없고, 잠긴 문서는 고칠 수
 * 없으므로 둘 다 뺀다.
 */
export function orderedPages(
  strips: readonly StructureDocument[],
): OrderedPage[] {
  return strips.flatMap(strip =>
    strip.locked
      ? []
      : strip.pages.flatMap(page =>
          page.issue === "overlap"
            ? []
            : [{ documentId: strip.documentId, key: page.key }],
        ),
  );
}

function indexOfKey(order: readonly OrderedPage[], key: string): number {
  return order.findIndex(page => page.key === key);
}

/**
 * 클릭 하나로 선택을 바꾼다. plain 은 선택을 비우고 기준만 옮긴다(뷰어 이동만). Shift 는 기준부터
 * 누른 키까지(문서 경계를 넘어 `order` 위치로) 범위를 고르고 기준은 그대로 둔다 — 기준이 없거나
 * `order` 에 없으면 누른 키 하나. toggle 은 누른 키를 넣거나 빼고 기준을 그 키로 옮긴다.
 *
 * 누른 키가 `order` 에 없으면(겹친 페이지·잠긴 문서) 고를 수 없다: plain 은 선택을 비우되 기준은
 * 두지 않고, Shift·toggle 은 선택을 그대로 둔다(같은 객체).
 */
export function applyClick(
  state: SelectionState,
  order: readonly OrderedPage[],
  key: string,
  modifiers: Modifiers,
): SelectionState {
  const to = indexOfKey(order, key);
  if (to < 0) {
    return modifiers.shift || modifiers.toggle
      ? state
      : { keys: new Set(), anchor: null };
  }
  if (modifiers.shift) {
    const from = state.anchor === null ? -1 : indexOfKey(order, state.anchor);
    if (from < 0) return { keys: new Set([key]), anchor: key };
    const [start, end] = from <= to ? [from, to] : [to, from];
    return {
      keys: new Set(order.slice(start, end + 1).map(page => page.key)),
      anchor: state.anchor,
    };
  }
  if (modifiers.toggle) {
    const keys = new Set(state.keys);
    if (keys.has(key)) keys.delete(key);
    else keys.add(key);
    return { keys, anchor: key };
  }
  return { keys: new Set(), anchor: key };
}

/** 편집 뒤 없어진 키를 뺀다. 바뀐 것이 없으면 같은 객체. */
export function pruneSelection(
  state: SelectionState,
  order: readonly OrderedPage[],
): SelectionState {
  const present = new Set(order.map(page => page.key));
  const keys = new Set([...state.keys].filter(key => present.has(key)));
  const anchor =
    state.anchor !== null && present.has(state.anchor) ? state.anchor : null;
  if (keys.size === state.keys.size && anchor === state.anchor) return state;
  return { keys, anchor };
}

/**
 * 고른 키를 원본 문서별로 묶는다(문서 순 → 문서 안 순). 제외·빠진 칸 페이지는 고를 수 없으므로
 * 문서 띠만 본다. 여러 문서에 겹쳐 든 페이지는 앞 문서에서 한 번만 센다.
 */
export function groupSelection(
  keys: ReadonlySet<string>,
  strips: readonly StructureDocument[],
): BatchSelection {
  const seen = new Set<string>();
  const groups: { documentId: string; groupId: string; keys: string[] }[] = [];
  for (const strip of strips) {
    const picked: string[] = [];
    for (const page of strip.pages) {
      if (!keys.has(page.key) || seen.has(page.key)) continue;
      seen.add(page.key);
      picked.push(page.key);
    }
    if (picked.length > 0) {
      groups.push({
        documentId: strip.documentId,
        groupId: strip.groupId,
        keys: picked,
      });
    }
  }
  return groups;
}

/** 문서 안에서 키에 맞는 페이지들(키 순서). 하나라도 없으면 `null`. */
function pagesOf(
  job: ReviewJob,
  stepId: string | null,
  documentId: string,
  keys: readonly string[],
): PageRef[] | null {
  const document = findDocument(job, stepId, documentId);
  if (!document) return null;
  let pages: PageRef[];
  try {
    pages = flattenPages(document);
  } catch {
    return null;
  }
  const byKey = new Map(pages.map(page => [pageKey(page), page]));
  const refs: PageRef[] = [];
  for (const key of keys) {
    const ref = byKey.get(key);
    if (!ref) return null;
    refs.push(ref);
  }
  return refs;
}

function documentLength(
  job: ReviewJob,
  stepId: string | null,
  documentId: string,
): number | null {
  const document = findDocument(job, stepId, documentId);
  if (!document) return null;
  try {
    return flattenPages(document).length;
  } catch {
    return null;
  }
}

/**
 * 선택을 일괄 변경으로 바꾼다. 원본 문서마다 변경 하나이고 순서대로 적용한다(전부 적용되거나
 * 하나도 적용되지 않는 것은 reducer `APPLY_BATCH` 가 맡는다).
 *
 * - move: 대상과 모든 원본의 그룹이 같아야 한다(`group_mismatch`). 대상 문서에 든 선택 페이지는
 *   건너뛴다. 넣을 자리는 앞 변경이 먼저 적용된 뒤 기준이다 — `end` 는 대상 길이 + 지금까지 옮긴
 *   수, `start` 는 지금까지 옮긴 수, `beforePage n`(대상의 지금 1-based 번호) 은 `n-1` + 지금까지
 *   옮긴 수. 그래서 옮긴 페이지는 원본 문서 순 → 문서 안 순으로 이어 붙는다.
 * - exclude: 원본마다 `exclude_pages`.
 * - drop: 대상과 모든 원본의 그룹이 같아야 한다. 대상 문서에 든 고른 페이지를 먼저 `index` 에
 *   모으고(같은 문서 안 `move_pages`), 다른 원본은 문서 순으로 `index` + 앞 원본들의 고른 수에
 *   넣는다. 그래서 모인 순서가 원본 문서 순 → 문서 안 순이 된다.
 * - new-document: 첫 원본 바로 뒤에 새 문서(`newId`, `label`, 없으면 첫 원본 라벨)를 만들고 나머지 원본은 그
 *   문서 끝에 붙인다. 원본 그룹이 섞이면 `group_mismatch`.
 *
 * 원본 문서의 페이지를 전부 옮기거나 제외하면 그 문서는 모델이 지운다. 모든 변경에 같은
 * `ids.batchId` 를 넣어 트레이가 한 묶음으로 보이고 함께 되돌리게 한다.
 */
export function batchDrafts(
  job: ReviewJob,
  stepId: string | null,
  selection: BatchSelection,
  action: BatchAction,
  ids: { newDocumentId: string; batchId: string },
): ChangeDraft[] | { reason: DropReason } {
  const { newDocumentId: newId, batchId } = ids;
  const sources =
    action.kind === "move"
      ? selection.filter(item => item.documentId !== action.targetDocumentId)
      : selection;
  if (sources.length === 0) return { reason: "page_not_in_document" };
  const refs: PageRef[][] = [];
  for (const item of sources) {
    const pages = pagesOf(job, stepId, item.documentId, item.keys);
    if (!pages || pages.length === 0) {
      return { reason: "page_not_in_document" };
    }
    refs.push(pages);
  }
  const jobId = job.id;

  if (action.kind === "exclude") {
    return sources.map((item, index) => ({
      kind: "exclude_pages",
      jobId,
      stepId,
      fromDocumentId: item.documentId,
      pages: refs[index]!,
      batchId,
    }));
  }

  if (action.kind === "move") {
    const target = findDocument(job, stepId, action.targetDocumentId);
    const targetLength = documentLength(job, stepId, action.targetDocumentId);
    if (!target || targetLength === null) return { reason: "target_missing" };
    if (sources.some(item => item.groupId !== target.group_id)) {
      return { reason: "group_mismatch" };
    }
    let base: number;
    if (action.position === "end") base = targetLength;
    else if (action.position === "start") base = 0;
    else {
      const before = action.position.beforePage;
      if (
        !Number.isInteger(before) ||
        before < 1 ||
        before > targetLength + 1
      ) {
        return { reason: "index_out_of_range" };
      }
      base = before - 1;
    }
    let moved = 0;
    return sources.map((item, index) => {
      const pages = refs[index]!;
      const draft: ChangeDraft = {
        kind: "move_pages",
        jobId,
        stepId,
        fromDocumentId: item.documentId,
        pages,
        to: { documentId: action.targetDocumentId, index: base + moved },
        batchId,
      };
      moved += pages.length;
      return draft;
    });
  }

  if (action.kind === "drop") {
    const targetId = action.targetDocumentId;
    const target = findDocument(job, stepId, targetId);
    if (!target) return { reason: "target_missing" };
    if (sources.some(item => item.groupId !== target.group_id)) {
      return { reason: "group_mismatch" };
    }
    if (!Number.isInteger(action.index) || action.index < 0) {
      return { reason: "index_out_of_range" };
    }
    // 같은 문서 하나뿐이고 자리가 그대로인 drop 은 격자가 놓기 전에 거부한다.
    const ownAt = sources.findIndex(item => item.documentId === targetId);
    const drafts: ChangeDraft[] = [];
    // 대상 문서 자신의 고른 페이지를 먼저 그 자리에 모은다(같은 문서 안 "빼고 끼우기"). 그래야
    // 다른 문서의 페이지를 끼우는 자리가 "뺀 뒤 기준" 과 맞는다.
    if (ownAt >= 0) {
      drafts.push({
        kind: "move_pages",
        jobId,
        stepId,
        fromDocumentId: targetId,
        pages: refs[ownAt]!,
        to: { documentId: targetId, index: action.index },
        batchId,
      });
    }
    let moved = 0;
    sources.forEach((item, index) => {
      const pages = refs[index]!;
      if (index !== ownAt) {
        drafts.push({
          kind: "move_pages",
          jobId,
          stepId,
          fromDocumentId: item.documentId,
          pages,
          to: { documentId: targetId, index: action.index + moved },
          batchId,
        });
      }
      moved += pages.length;
    });
    return drafts;
  }

  const first = sources[0]!;
  if (sources.some(item => item.groupId !== first.groupId)) {
    return { reason: "group_mismatch" };
  }
  let moved = 0;
  return sources.map((item, index) => {
    const pages = refs[index]!;
    const draft: ChangeDraft = {
      kind: "move_pages",
      jobId,
      stepId,
      fromDocumentId: item.documentId,
      pages,
      to:
        index === 0
          ? action.label !== undefined
            ? {
                newDocumentId: newId,
                afterDocumentId: first.documentId,
                label: action.label,
              }
            : { newDocumentId: newId, afterDocumentId: first.documentId }
          : { documentId: newId, index: moved },
      batchId,
    };
    moved += pages.length;
    return draft;
  });
}

/**
 * "여기서 나누기" 의 대상: 정확히 한 장을 골랐고 그 장이 문서의 첫 페이지가 아닐 때, 그 문서와
 * 바로 앞 페이지 키(그 뒤에서 나눈다). 그 밖은 `null`.
 */
export function splitTargetOf(
  selection: BatchSelection,
  strips: readonly StructureDocument[],
): { documentId: string; afterPageKey: string } | null {
  if (selection.length !== 1) return null;
  const only = selection[0]!;
  if (only.keys.length !== 1) return null;
  const strip = strips.find(item => item.documentId === only.documentId);
  if (!strip) return null;
  const index = strip.pages.findIndex(page => page.key === only.keys[0]);
  if (index <= 0) return null;
  return {
    documentId: only.documentId,
    afterPageKey: strip.pages[index - 1]!.key,
  };
}

/**
 * 문서 안 순번(1-based)을 이어진 구간으로 줄여 적는다: `[1, 2, 3, 5]` → `"1–3, 5"`. 순서는 정렬해
 * 쓰고 같은 번호는 한 번만 센다.
 */
export function formatPageRuns(positions: readonly number[]): string {
  const sorted = [...new Set(positions)].sort((a, b) => a - b);
  const runs: string[] = [];
  let start = 0;
  for (let i = 1; i <= sorted.length; i += 1) {
    if (i < sorted.length && sorted[i] === sorted[i - 1]! + 1) continue;
    const first = sorted[start]!;
    const last = sorted[i - 1]!;
    runs.push(first === last ? String(first) : `${first}–${last}`);
    start = i;
  }
  return runs.join(", ");
}
