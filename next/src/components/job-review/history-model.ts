// 변경 이력 시트의 판정(순수).

import type { JobRevision, ReviewCapabilities } from "@/lib/review-api/types";
import {
  addChange,
  canEditResult,
  findResult,
  jsonEquals,
  structureChanged,
  type ChangeDraft,
  type ChangeOrigin,
  type ReviewJob,
  type ReviewSession,
} from "@/lib/review-model";
import {
  groupByOperation,
  isCurrentRevision,
  revisionToDraft,
  type MachineTarget,
  type RevisionDraftFailure,
  type RevisionGroup,
} from "@/lib/revision-history";
import type { HistoryTypeFilter } from "./history-toolbar";
import { isSaving, type SaveStatus } from "./job-review-state";

export type HistoryUnavailableReason = "unsupported" | "unknown";

export type HistoryAvailability =
  { ok: true } | { ok: false; reason: HistoryUnavailableReason };

/**
 * 변경 이력을 열 수 있는가. 지원 여부를 받지 못했으면(`null`) `unknown`, 서버가 `true` 라고 하지
 * 않으면 `unsupported`. 진입점은 숨기지 않고 이 이유로 막는다.
 */
export function historyAvailability(
  capabilities: ReviewCapabilities | null,
): HistoryAvailability {
  if (capabilities === null) return { ok: false, reason: "unknown" };
  if (capabilities.revisions_supported !== true) {
    return { ok: false, reason: "unsupported" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 편집에 불러오기
// ---------------------------------------------------------------------------

/** 편집에 불러올 수 없는 이유. 문구 키 `load.blocked.*` 와 같다. */
export type LoadBlock =
  | "loading"
  | "omitted"
  | "missing_result"
  | "not_editable"
  | "mismatch"
  | "same"
  | "saving"
  | "conflict"
  | "current"
  | "original_missing";

export type LoadAvailability =
  { ok: true; draft: ChangeDraft } | { ok: false; block: LoadBlock };

export interface LoadAvailabilityInput {
  session: ReviewSession;
  save: SaveStatus;
  /** 불러올 대상(행이면 그 행, 최초 원본이면 대상 결과 또는 구조). */
  revision: Pick<JobRevision, "type" | "result">;
  /** 내용을 담은 행(단건 GET 또는 기계 출력 대상의 첫 행). 아직 받지 못했으면 `null`. */
  detail: JobRevision | null;
  /** `content`(그 변경 뒤 값) 또는 `base_content`(첫 행이면 기계 출력). */
  source: "content" | "base_content";
  /** 이 행이 지금 반영된 version 인가(`session.base` 기준). */
  isCurrent: boolean;
}

const DRAFT_BLOCK: Record<RevisionDraftFailure, LoadBlock> = {
  content_unavailable: "omitted",
  invalid_content: "mismatch",
  result_missing: "missing_result",
  result_not_editable: "not_editable",
  structure_missing: "mismatch",
  layout_mismatch: "mismatch",
  file_set_mismatch: "mismatch",
  unchanged: "same",
};

const blocked = (block: LoadBlock): LoadAvailability => ({ ok: false, block });

/**
 * 이력 내용을 지금 편집(`session.current`)에 불러올 수 있는가. 막히면 첫 이유 하나.
 * 순서: 저장 중 → 저장 충돌 → 지금 반영본(`content` 일 때) → 내용 받는 중 → 최초 원본 아님
 * (`base_content` 일 때) → 내용 생략 → 결과 없음 ·
 * 고칠 수 없음 → 지금 구성과 맞지 않음 · 지금 값과 같음.
 */
export function loadAvailability({
  session,
  save,
  revision,
  detail,
  source,
  isCurrent,
}: LoadAvailabilityInput): LoadAvailability {
  if (isSaving(save)) return blocked("saving");
  if (save.phase === "conflict") return blocked("conflict");
  if (source === "content" && isCurrent) return blocked("current");
  if (!detail) return blocked("loading");
  // 최초 원본은 base_version 0 행의 base_content 뿐이다. 다른 행의 base_content 는 직전 version 이다.
  if (source === "base_content" && detail.base_version !== 0) {
    return blocked("original_missing");
  }
  const omitted =
    source === "content" ? detail.content_omitted : detail.base_content_omitted;
  if (omitted) return blocked("omitted");
  const job = session.current.jobs[0];
  if (!job) return blocked("missing_result");
  if (revision.type === "result") {
    const result = revision.result
      ? findResult(job, revision.result.occurrence_id)
      : null;
    if (!result) return blocked("missing_result");
    if (!canEditResult(result)) return blocked("not_editable");
  }
  const outcome = revisionToDraft(job, revision, detail[source]);
  return outcome.ok
    ? { ok: true, draft: outcome.draft }
    : blocked(DRAFT_BLOCK[outcome.reason]);
}

/**
 * `before`(최초 원본을 누른 시점의 편집) 뒤로 그 대상만 바뀌었는가. 결과는 `content` 를, 구조는
 * 문서 구성을 내용으로 비교한다(되돌리기는 같은 값이어도 객체를 새로 만들어 identity 로는 알 수 없다).
 * 비교할 수 없으면(어느 쪽 Job 이나 결과가 없음) 바뀐 것으로 본다.
 */
export function targetChangedSince(
  before: ReviewJob | null,
  after: ReviewJob | null,
  target: MachineTarget,
): boolean {
  if (!before || !after) return true;
  if (target.type === "structure") return structureChanged(before, after);
  const was = findResult(before, target.occurrenceId);
  const now = findResult(after, target.occurrenceId);
  if (!was || !now) return true;
  return !jsonEquals(was.content, now.content);
}

/** 최초 원본 대상이 지금 필터(종류 · 결과)에서 보이는가. 구조는 결과 필터가 없을 때만. */
export function machineTargetVisible(
  target: MachineTarget,
  type: HistoryTypeFilter,
  occurrenceId: string | null,
): boolean {
  return target.type === "structure"
    ? type !== "result" && occurrenceId === null
    : type !== "structure" &&
        (occurrenceId === null || occurrenceId === target.occurrenceId);
}

/**
 * 불러온 draft 에 출처를 붙인다(트레이 표시용). 출처를 가질 수 있는 종류(`replace_subtree`·
 * `replace_structure`)만 붙이고 나머지는 그대로 돌려준다.
 */
export function withOrigin(
  draft: ChangeDraft,
  origin: ChangeOrigin,
): ChangeDraft {
  return draft.kind === "replace_subtree" || draft.kind === "replace_structure"
    ? { ...draft, origin }
    : draft;
}

// ---------------------------------------------------------------------------
// 같은 저장 묶음 한 번에 불러오기
// ---------------------------------------------------------------------------

export interface GroupLoadPlan {
  /** 한 번에 넣을 draft(출처 포함). 구조가 먼저. */
  drafts: readonly ChangeDraft[];
  loaded: number;
  /** 대상별로 남긴 행 수. */
  total: number;
  /** 넣지 못한 행의 이유별 수. */
  blocked: Partial<Record<LoadBlock, number>>;
}

export interface GroupLoadInput {
  session: ReviewSession;
  save: SaveStatus;
  /** 지금 반영된 Job(`session.base`). 행이 그 반영본인지 판정한다. */
  baseJob: ReviewJob | null;
  /** 같은 저장의 행(`include=content`). */
  rows: readonly JobRevision[];
}

function targetKeyOf(row: JobRevision): string {
  return row.type === "structure"
    ? "structure"
    : `result:${row.result?.occurrence_id ?? row.id}`;
}

/**
 * 같은 저장(operation)으로 바뀐 행을 지금 편집에 한 번에 넣을 계획. 같은 대상의 행이 여럿이면
 * version 이 가장 큰 것만 남기고, 구조 행을 먼저(결과 행은 받은 순) 넣는다. 각 행은 앞 행까지 넣은
 * 편집 기준으로 `loadAvailability` 로 판정하고 실제로 `addChange` 해 본다 — 구조를 바꾼 뒤 그 결과가
 * 맞지 않으면 그 행만 `mismatch` 로 빼므로, 모은 draft 를 같은 순서로 `APPLY_BATCH` 하면 실패하지 않는다.
 */
export function planGroupLoad({
  session,
  save,
  baseJob,
  rows,
}: GroupLoadInput): GroupLoadPlan {
  const latestByTarget = new Map<string, JobRevision>();
  for (const row of rows) {
    const key = targetKeyOf(row);
    const seen = latestByTarget.get(key);
    if (!seen || row.version > seen.version) latestByTarget.set(key, row);
  }
  const kept = [...latestByTarget.values()];
  const ordered = [
    ...kept.filter(row => row.type === "structure"),
    ...kept.filter(row => row.type !== "structure"),
  ];
  const drafts: ChangeDraft[] = [];
  const blocked: Partial<Record<LoadBlock, number>> = {};
  const block = (reason: LoadBlock) => {
    blocked[reason] = (blocked[reason] ?? 0) + 1;
  };
  let working = session;
  for (const row of ordered) {
    const availability = loadAvailability({
      session: working,
      save,
      revision: row,
      detail: row,
      source: "content",
      isCurrent: baseJob ? isCurrentRevision(baseJob, row) : false,
    });
    if (!availability.ok) {
      block(availability.block);
      continue;
    }
    const draft = withOrigin(availability.draft, {
      kind: "revision",
      revisionId: row.id,
      version: row.version,
    });
    const outcome = addChange(working, draft);
    if (!outcome.ok) {
      block("mismatch");
      continue;
    }
    working = outcome.session;
    drafts.push(draft);
  }
  return { drafts, loaded: drafts.length, total: ordered.length, blocked };
}

// ---------------------------------------------------------------------------
// 목록 항목
// ---------------------------------------------------------------------------

export type MachinePlacement = "top" | "bottom" | null;

export type HistoryItem =
  | {
      kind: "group";
      group: RevisionGroup;
      /** 이전 페이지에서 시작한 묶음이 이 페이지로 이어진다. */
      continued: boolean;
    }
  | { kind: "row"; revision: JobRevision; groupKey: string | null }
  | { kind: "machine" };

/** 머리줄을 둘 묶음: 같은 저장이 2 건 이상이거나 다른 Collection 에서 반영됐다. */
function hasHeader(group: RevisionGroup): boolean {
  return (
    group.rows.length > 1 || group.operation.from_this_collection === false
  );
}

/**
 * 지금 페이지에 그릴 항목. 묶음은 받은 행 전체(`allRows`)로 판단해, 페이지 첫 행이 이전 페이지에서
 * 시작한 묶음이면 "(이어서)" 머리줄을 다시 둔다. 최초 원본 행은 `machinePlacement` 자리에.
 */
export function buildHistoryItems(
  pageRows: readonly JobRevision[],
  allRows: readonly JobRevision[],
  machinePlacement: MachinePlacement,
): HistoryItem[] {
  const groupOf = new Map<string, RevisionGroup>();
  for (const group of groupByOperation(allRows)) {
    for (const row of group.rows) groupOf.set(row.id, group);
  }
  const out: HistoryItem[] = [];
  if (machinePlacement === "top") out.push({ kind: "machine" });
  let lastGroupKey: string | null = null;
  for (const revision of pageRows) {
    const group = groupOf.get(revision.id);
    if (!group || !hasHeader(group)) {
      out.push({ kind: "row", revision, groupKey: null });
      lastGroupKey = null;
      continue;
    }
    if (group.key !== lastGroupKey) {
      out.push({
        kind: "group",
        group,
        continued: group.rows[0]!.id !== revision.id,
      });
      lastGroupKey = group.key;
    }
    out.push({ kind: "row", revision, groupKey: group.key });
  }
  if (machinePlacement === "bottom") out.push({ kind: "machine" });
  return out;
}

export interface MachinePlacementInput {
  /** 목록 순서. */
  order: "asc" | "desc";
  page: number;
  /** 지금 페이지 뒤에 받은 페이지나 서버에 남은 행이 있다. */
  hasMore: boolean;
}

/** 최신순이면 끝까지 받은 마지막 페이지 끝, 오래된 순이면 1 페이지 처음. */
export function machinePlacementOf({
  order,
  page,
  hasMore,
}: MachinePlacementInput): MachinePlacement {
  if (order === "asc") return page === 1 ? "top" : null;
  return hasMore ? null : "bottom";
}

/** 행에 보일 문서 라벨 앞 `max` 개와 나머지 수. 라벨이 없으면 `noLabel`. */
export function documentLabels(
  docs: readonly { label?: string | null }[] | null | undefined,
  max = 2,
  noLabel = "",
): { labels: string[]; more: number } {
  const list = docs ?? [];
  return {
    labels: list.slice(0, max).map(doc => doc.label || noLabel),
    more: Math.max(0, list.length - max),
  };
}
