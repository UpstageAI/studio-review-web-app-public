"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CursorPagination } from "@/components/collections/cursor-pagination";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ApiError } from "@/lib/review-api/review-screen";
import type { JobRevision } from "@/lib/review-api/types";
import {
  documentsOf,
  findResult,
  isMergeStepType,
  linkedDocumentIds,
  type ChangeDraft,
  type ChangeOrigin,
  type ReviewDocument,
  type ReviewSession,
} from "@/lib/review-model";
import {
  isCurrentRevision,
  machineTargetKey,
  machineTargets,
  structureImpact,
  type MachineTarget,
  type RevisionOrder,
} from "@/lib/revision-history";
import {
  HistoryList,
  MACHINE_ROW_KEY,
  type GroupLoadSummary,
} from "./history-list";
import type { MachineTargetView } from "./history-machine-row";
import {
  buildHistoryItems,
  documentLabels,
  loadAvailability,
  machinePlacementOf,
  machineTargetVisible,
  planGroupLoad,
  targetChangedSince,
  withOrigin,
  type GroupLoadPlan,
  type LoadAvailability,
} from "./history-model";
import type { HistoryRowView, StructureImpactView } from "./history-row";
import {
  HistoryToolbar,
  type HistorySort,
  type HistoryTypeFilter,
} from "./history-toolbar";
import { useJobReview } from "./job-review-context";
import { isSaving, type SaveStatus } from "./job-review-state";
import { useDropReasonText } from "./use-drop-reason-text";
import { useJobRevisions, type JobRevisions } from "./use-job-revisions";

const EMPTY_KEYS: ReadonlySet<string> = new Set();
const STRUCTURE_TARGET: MachineTarget = { type: "structure" };

/** 이력에서 불러온 draft 의 행 id(출처가 이력 행일 때). */
function revisionIdOf(draft: ChangeDraft): string | null {
  if (draft.kind !== "replace_subtree" && draft.kind !== "replace_structure") {
    return null;
  }
  return draft.origin?.kind === "revision" ? draft.origin.revisionId : null;
}

/**
 * 구조 draft 를 지금 편집(`session.current`)에 넣었을 때의 영향을 화면용으로 바꾼다. 결과는 Step 이름으로
 * 보이고, 문서 집합이 그대로(라벨·순서만 변경)이거나 넣을 수 없는 draft 면 null.
 */
function impactViewOf(
  session: ReviewSession,
  draft: ChangeDraft,
): StructureImpactView | null {
  if (draft.kind !== "replace_structure") return null;
  const job = session.current.jobs[0];
  if (!job) return null;
  const impact = structureImpact(job, draft);
  if (!impact || impact.documents.length === 0) return null;
  const steps = session.current.steps;
  return {
    documents: impact.documents.map(document => ({
      label: document.label,
      status: document.status,
      results: [
        ...new Set(
          document.results.map(
            result => steps[result.stepId]?.name ?? result.stepId,
          ),
        ),
      ],
    })),
    resultCount: impact.resultCount,
  };
}

/** 최초 원본(기계 출력) 대상을 지금 편집에 불러올 수 있는가(`revision` 은 그 대상의 가장 오래된 행). */
function machineAvailability(
  session: ReviewSession,
  save: SaveStatus,
  target: MachineTarget,
  revision: JobRevision | null,
): LoadAvailability {
  return loadAvailability({
    session,
    save,
    revision:
      target.type === "result"
        ? {
            type: "result",
            result: {
              occurrence_id: target.occurrenceId,
              step_id: target.stepId,
            },
          }
        : { type: "structure", result: null },
    detail: revision,
    source: "base_content",
    isCurrent: false,
  });
}

/** 변경 이력 시트. 열림 상태는 reducer(`state.history`)가 가진다. */
export function HistorySheet() {
  const t = useTranslations("review.history");
  const { state, dispatch } = useJobReview();
  const { open, resultId } = state.history;
  // 닫히면 reducer 의 `resultId` 가 지워지므로 연 결과를 따로 기억해 포커스를 돌려줄 곳을 정한다.
  const originRef = useRef<string | null>(null);
  useEffect(() => {
    if (open) originRef.current = resultId;
  }, [open, resultId]);

  return (
    <Sheet
      open={open}
      onOpenChange={next => {
        if (!next) dispatch({ type: "CLOSE_HISTORY" });
      }}
    >
      <SheetContent
        side="right"
        showCloseButton={false}
        onCloseAutoFocus={event => {
          // 시트는 트리거 없이 열리므로 연 자리(결과 메뉴 또는 헤더 버튼)로 포커스를 돌린다.
          const origin = originRef.current;
          const opener =
            (origin
              ? document.querySelector<HTMLElement>(
                  `[data-result-id="${CSS.escape(origin)}"] [data-testid="job-review-result-button-menu"]`,
                )
              : null) ??
            document.querySelector<HTMLElement>(
              '[data-testid="job-review-history-button-open"]',
            );
          if (opener) {
            event.preventDefault();
            opener.focus();
          }
        }}
        className="gap-0 data-[side=right]:w-full data-[side=right]:sm:w-1/2 data-[side=right]:sm:max-w-none"
        data-testid="job-review-history-sheet"
      >
        <SheetHeader className="flex-row items-start justify-between gap-2 border-b border-border">
          <div className="flex min-w-0 flex-col gap-0.5">
            <SheetTitle>{t("title")}</SheetTitle>
            <SheetDescription>{t("description")}</SheetDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => dispatch({ type: "CLOSE_HISTORY" })}
            data-testid="job-review-history-button-close"
          >
            {t("close")}
          </Button>
        </SheetHeader>
        {open && state.session ? (
          <HistoryBody key={resultId ?? ""} initialResultId={resultId} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function HistoryBody({ initialResultId }: { initialResultId: string | null }) {
  const t = useTranslations("review.history");
  const { state, dispatch } = useJobReview();
  const session = state.session;
  const [type, setType] = useState<HistoryTypeFilter>(null);
  const [occurrenceId, setOccurrenceId] = useState(initialResultId);
  const [sort, setSort] = useState<HistorySort>("newest");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // 마지막으로 불러온 행(또는 기계 출력 대상)들. 저장이 반영돼 base 가 바뀌면 지운 것으로 본다.
  // 구조를 불러왔으면 불러오기 직전 편집 기준의 영향(`impact`)도 남겨 불러온 뒤 요약에 쓴다.
  const [applied, setApplied] = useState<{
    keys: ReadonlySet<string>;
    base: ReviewDocument;
    impact: StructureImpactView | null;
  } | null>(null);
  // 저장 묶음별 마지막 "모두 불러오기" 결과. 그때의 base 와 지금 base 가 다르면 지운 것으로 본다.
  const [groupLoads, setGroupLoads] = useState<
    ReadonlyMap<string, GroupLoadPlan & { base: ReviewDocument }>
  >(() => new Map());
  // 최초 원본을 받는 동안 그 대상의 편집이 바뀌어 자동으로 넣지 않은 대상(`MACHINE_ROW_KEY:` 키).
  const [skippedKey, setSkippedKey] = useState<string | null>(null);
  const order: RevisionOrder = sort === "oldest" ? "asc" : "desc";
  const revisions = useJobRevisions({
    collectionId: state.collectionId,
    jobId: state.jobId,
    enabled: true,
    filter: { type, occurrenceId, order },
    // 저장 중에는 다시 받지 않고, 반영된 세션(base)이 바뀌면 처음부터 다시 받아 보던 페이지로 돌아간다.
    refreshKey: isSaving(state.save) ? null : (session?.base ?? null),
  });
  const dropReasonText = useDropReasonText();

  const appliedLive = applied && session && applied.base === session.base;
  const appliedKeys = appliedLive ? applied.keys : EMPTY_KEYS;
  const appliedImpact = appliedLive ? applied.impact : null;
  const editErrorText =
    appliedKeys.size > 0 && state.editError
      ? dropReasonText(state.editError)
      : null;
  const noLabel = t("row.noLabel");
  const structureName = t("row.type.structure");
  const { loadDetail, loadMachine, loadOperation, operations } = revisions;

  const onTypeChange = useCallback((next: HistoryTypeFilter) => {
    setType(next);
    // 구조 이력에는 결과 필터를 함께 걸 수 없다.
    if (next === "structure") setOccurrenceId(null);
  }, []);
  const onClearResult = useCallback(() => setOccurrenceId(null), []);

  const machineOpen = expanded.has(MACHINE_ROW_KEY);
  // 이벤트 핸들러·받기 콜백이 읽는 지금 상태. 렌더 중에는 읽지 않는다.
  const latest = useRef({
    session,
    save: state.save,
    machineOpen,
    type,
    occurrenceId,
  });
  useEffect(() => {
    latest.current = {
      session,
      save: state.save,
      machineOpen,
      type,
      occurrenceId,
    };
  });

  // 최초 원본 행을 펼치면 문서 구성 대상은 바로 받아 둔다 — 누르기 전에 같은 값인지와 문서 집합
  // 영향을 보이고, 누르면 받아 둔 내용으로 넣는다. 결과 대상은 누를 때 받는다(대상 수만큼 요청하지 않게).
  const onToggle = useCallback(
    (key: string) => {
      const opening = !expanded.has(key);
      setExpanded(prev => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      if (!opening) return;
      if (key !== MACHINE_ROW_KEY) {
        loadDetail(key);
        return;
      }
      const now = latest.current;
      const baseJob = now.session?.base.jobs[0];
      if (
        baseJob &&
        machineTargets(baseJob).some(target => target.type === "structure") &&
        machineTargetVisible(STRUCTURE_TARGET, now.type, now.occurrenceId)
      ) {
        loadMachine(STRUCTURE_TARGET);
      }
    },
    [expanded, loadDetail, loadMachine],
  );

  // 불러온 시점의 base 로 표시를 남긴다(받는 동안 저장이 반영됐으면 새 base 기준).
  // 출처는 트레이가 "어디서 불러왔는지" 보이는 데만 쓴다.
  const onLoad = useCallback(
    (key: string, draft: ChangeDraft, origin: ChangeOrigin) => {
      const now = latest.current.session;
      if (!now) return;
      const impact = impactViewOf(now, draft);
      dispatch({ type: "APPLY", draft: withOrigin(draft, origin) });
      setApplied({ keys: new Set([key]), base: now.base, impact });
      setSkippedKey(null);
    },
    [dispatch],
  );

  // 받은 묶음 행을 도착(또는 누른) 시점의 편집으로 판정해 넣을 수 있는 것만 한 번에 넣는다.
  const applyGroup = useCallback(
    (operationId: string, rows: readonly JobRevision[]) => {
      const now = latest.current;
      if (!now.session) return;
      const base = now.session.base;
      const plan = planGroupLoad({
        session: now.session,
        save: now.save,
        baseJob: base.jobs[0] ?? null,
        rows,
      });
      if (plan.drafts.length > 0) {
        const structure = plan.drafts.find(
          draft => draft.kind === "replace_structure",
        );
        const impact = structure ? impactViewOf(now.session, structure) : null;
        dispatch({ type: "APPLY_BATCH", drafts: plan.drafts });
        setApplied({
          keys: new Set(
            plan.drafts.flatMap(draft => revisionIdOf(draft) ?? []),
          ),
          base,
          impact,
        });
        setSkippedKey(null);
      }
      setGroupLoads(prev => new Map(prev).set(operationId, { ...plan, base }));
    },
    [dispatch],
  );

  const onLoadGroup = useCallback(
    (operationId: string) => {
      const known = operations.get(operationId);
      if (known?.status === "ready") applyGroup(operationId, known.rows);
      else loadOperation(operationId, rows => applyGroup(operationId, rows));
    },
    [operations, loadOperation, applyGroup],
  );

  const groupSummaries = useMemo(() => {
    const out = new Map<string, GroupLoadSummary>();
    if (!session) return out;
    for (const [id, load] of groupLoads) {
      if (load.base !== session.base) continue;
      out.set(id, {
        loaded: load.loaded,
        total: load.total,
        blocked: load.blocked,
      });
    }
    return out;
  }, [session, groupLoads]);
  const groupBlock = isSaving(state.save)
    ? "saving"
    : state.save.phase === "conflict"
      ? "conflict"
      : null;

  const views = useMemo(() => {
    const out = new Map<string, HistoryRowView>();
    if (!session) return out;
    const baseJob = session.base.jobs[0] ?? null;
    const steps = session.current.steps;
    for (const revision of revisions.pageItems) {
      const step = revision.result
        ? (steps[revision.result.step_id] ?? null)
        : null;
      const isCurrent = baseJob ? isCurrentRevision(baseJob, revision) : false;
      const detail = revisions.details.get(revision.id);
      const availability = expanded.has(revision.id)
        ? loadAvailability({
            session,
            save: state.save,
            revision,
            detail: detail?.status === "ready" ? detail.revision : null,
            source: "content",
            isCurrent,
          })
        : null;
      const mine = appliedKeys.has(revision.id);
      const loaded =
        mine &&
        availability !== null &&
        !availability.ok &&
        availability.block === "same" &&
        !state.editError;
      out.set(revision.id, {
        stepLabel:
          revision.result?.step_name ||
          step?.name ||
          revision.result?.step_id ||
          structureName,
        step,
        documents:
          revision.type === "result"
            ? documentLabels(revision.result?.documents, 2, noLabel)
            : null,
        isCurrent,
        availability,
        applied: loaded,
        editError: mine ? editErrorText : null,
        merge: isMergeStepType(step?.type ?? revision.result?.step_type),
        impact: availability?.ok
          ? impactViewOf(session, availability.draft)
          : null,
        // 묶음으로 구조와 값을 함께 넣었으면 요약은 구조 행에만 붙인다.
        appliedImpact:
          loaded && revision.type === "structure" ? appliedImpact : null,
      });
    }
    return out;
  }, [
    session,
    state.save,
    state.editError,
    revisions.pageItems,
    revisions.details,
    expanded,
    appliedKeys,
    appliedImpact,
    editErrorText,
    noLabel,
    structureName,
  ]);

  const machineViews = useMemo((): MachineTargetView[] => {
    if (!session || !machineOpen) return [];
    const baseJob = session.base.jobs[0];
    if (!baseJob) return [];
    const steps = session.current.steps;
    const labels = new Map(
      documentsOf(baseJob).map(({ document }) => [
        document.document_id,
        document.label,
      ]),
    );
    return machineTargets(baseJob)
      .filter(target => machineTargetVisible(target, type, occurrenceId))
      .map(target => {
        const key = machineTargetKey(target);
        const appliedAs = `${MACHINE_ROW_KEY}:${key}`;
        const detail = revisions.machine.get(key);
        const step =
          target.type === "result" ? (steps[target.stepId] ?? null) : null;
        const result =
          target.type === "result"
            ? findResult(baseJob, target.occurrenceId)
            : null;
        const docs = result
          ? documentLabels(
              linkedDocumentIds(result).map(id => ({
                label: labels.get(id) ?? null,
              })),
              2,
              noLabel,
            )
          : null;
        const availability = machineAvailability(
          session,
          state.save,
          target,
          detail?.status === "ready" ? detail.revision : null,
        );
        const mine = appliedKeys.has(appliedAs);
        const loaded =
          mine &&
          !availability.ok &&
          availability.block === "same" &&
          !state.editError;
        return {
          key: appliedAs,
          target,
          label:
            target.type === "result"
              ? (step?.name ?? target.stepId)
              : structureName,
          documents: docs
            ? [
                ...docs.labels,
                ...(docs.more > 0
                  ? [t("row.documentsMore", { count: docs.more })]
                  : []),
              ].join(", ")
            : null,
          detail,
          availability,
          applied: loaded,
          editError: mine ? editErrorText : null,
          merge: isMergeStepType(step?.type),
          skipped: skippedKey === appliedAs,
          impact: availability.ok
            ? impactViewOf(session, availability.draft)
            : null,
          appliedImpact:
            loaded && target.type === "structure" ? appliedImpact : null,
        };
      });
  }, [
    session,
    machineOpen,
    type,
    occurrenceId,
    revisions.machine,
    state.save,
    state.editError,
    appliedKeys,
    appliedImpact,
    skippedKey,
    editErrorText,
    noLabel,
    structureName,
    t,
  ]);

  // 결과 대상의 기계 출력은 누른 뒤에 받는다. 받기가 끝난 시점의 편집 상태로 다시 판정해 불러올 수
  // 있으면 같은 클릭으로 편집에 넣고, 막히면(같은 값 · 생략 등) 이유만 보인다. 기계 행을 접었거나
  // 필터로 그 대상이 숨겨졌으면 넣지 않는다. 받는 동안 그 대상의 편집이 바뀌었으면 덮어쓰지 않고
  // 버튼과 안내만 남긴다(다시 누르면 받아 둔 출력으로 불러온다). 문서 구성 대상은 받기만 한다 —
  // 문서 집합 영향을 먼저 보이고 버튼으로 넣는다(보통은 펼칠 때 이미 받아 둔다).
  const onFetchMachine = useCallback(
    (target: MachineTarget) => {
      if (target.type === "structure") {
        loadMachine(target);
        return;
      }
      const key = `${MACHINE_ROW_KEY}:${machineTargetKey(target)}`;
      const before = latest.current.session?.current.jobs[0] ?? null;
      setSkippedKey(null);
      loadMachine(target, revision => {
        const now = latest.current;
        if (
          !now.session ||
          !now.machineOpen ||
          !machineTargetVisible(target, now.type, now.occurrenceId)
        ) {
          return;
        }
        const availability = machineAvailability(
          now.session,
          now.save,
          target,
          revision,
        );
        if (!availability.ok) return;
        if (
          targetChangedSince(
            before,
            now.session.current.jobs[0] ?? null,
            target,
          )
        ) {
          setSkippedKey(key);
          return;
        }
        onLoad(key, availability.draft, { kind: "original" });
      });
    },
    [loadMachine, onLoad],
  );

  const placement = machinePlacementOf({
    order,
    page: revisions.page,
    hasMore: revisions.hasMore,
  });
  const items = useMemo(
    () => buildHistoryItems(revisions.pageItems, revisions.rows, placement),
    [revisions.pageItems, revisions.rows, placement],
  );

  const resultName = useMemo(() => {
    if (occurrenceId === null) return null;
    const job = session?.current.jobs[0];
    const result = job ? findResult(job, occurrenceId) : null;
    const stepName = result
      ? session?.current.steps[result.step_id]?.name
      : null;
    // 지금 문서에 없는 결과면 이력 행이 가진 Step 이름으로.
    return (
      stepName ??
      revisions.rows.find(row => row.result?.occurrence_id === occurrenceId)
        ?.result?.step_name ??
      occurrenceId
    );
  }, [occurrenceId, session, revisions.rows]);

  // 사용자가 페이지를 넘기면 목록 맨 위로 올리고 새 페이지 첫 행에 포커스를 둔다. 저장 뒤 다시
  // 받아 보던 페이지로 돌아갈 때는 포커스를 옮기지 않는다.
  const scrollRef = useRef<HTMLDivElement>(null);
  const shownPage = useRef(revisions.page);
  const navigatedRef = useRef(false);
  const { nextPage, previousPage, goToPage } = revisions;
  const onNextPage = useCallback(() => {
    navigatedRef.current = true;
    nextPage();
  }, [nextPage]);
  const onPreviousPage = useCallback(() => {
    navigatedRef.current = true;
    previousPage();
  }, [previousPage]);
  const onGoToPage = useCallback(
    (page: number) => {
      navigatedRef.current = true;
      goToPage(page);
    },
    [goToPage],
  );
  useEffect(() => {
    if (shownPage.current === revisions.page) return;
    shownPage.current = revisions.page;
    if (!navigatedRef.current) return;
    navigatedRef.current = false;
    const list = scrollRef.current;
    if (!list) return;
    list.scrollTo({ top: 0 });
    list
      .querySelector<HTMLElement>(
        '[data-testid="job-review-history-row-toggle"], [data-testid="job-review-history-machine-toggle"]',
      )
      ?.focus({ preventScroll: true });
  }, [revisions.page]);

  const filtered = type !== null || occurrenceId !== null;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-0 flex-1 flex-col">
        <HistoryToolbar
          type={type}
          onTypeChange={onTypeChange}
          resultName={resultName}
          onClearResult={onClearResult}
          sort={sort}
          onSortChange={setSort}
        />
        <HistoryNotices
          saving={isSaving(state.save)}
          draftFound={state.draft.status === "found"}
        />
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
        >
          {revisions.phase === "error" ? (
            <HistoryError revisions={revisions} />
          ) : revisions.phase !== "ready" ? (
            <p aria-live="polite" className="text-sm text-muted-foreground">
              {t("loading")}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {revisions.rows.length === 0 ? (
                <p
                  className="text-sm text-muted-foreground"
                  data-testid="job-review-history-empty"
                >
                  {filtered ? t("emptyFiltered") : t("empty")}
                </p>
              ) : null}
              {items.length > 0 ? (
                <HistoryList
                  items={items}
                  views={views}
                  expanded={expanded}
                  details={revisions.details}
                  now={revisions.fetchedAt ?? 0}
                  onToggle={onToggle}
                  onLoad={onLoad}
                  onRetryDetail={loadDetail}
                  retryClock={revisions.retryClock}
                  machineTargets={machineViews}
                  onFetchMachine={onFetchMachine}
                  operations={operations}
                  groupSummaries={groupSummaries}
                  groupBlock={groupBlock}
                  onLoadGroup={onLoadGroup}
                />
              ) : null}
            </div>
          )}
        </div>
        {revisions.phase === "ready" ? (
          <div className="flex flex-col gap-1 border-t border-border px-4 py-2 empty:hidden">
            {revisions.blockLoading ? (
              <p aria-live="polite" className="text-xs text-muted-foreground">
                {t("loadingBlock")}
              </p>
            ) : null}
            {revisions.blockError ? (
              <HistoryError revisions={revisions} />
            ) : null}
            <CursorPagination
              page={revisions.page}
              pageNumbers={revisions.pageNumbers}
              canGoBack={revisions.canGoBack}
              hasMore={revisions.hasMore}
              loading={revisions.blockLoading || revisions.blockError}
              onPrevious={onPreviousPage}
              onNext={onNextPage}
              onGoTo={onGoToPage}
              testIdPrefix="job-review-history"
            />
          </div>
        ) : null}
      </div>
    </TooltipProvider>
  );
}

/** 저장 중 안내와 복원하지 않은 임시 저장 경고. */
function HistoryNotices({
  saving,
  draftFound,
}: {
  saving: boolean;
  draftFound: boolean;
}) {
  const t = useTranslations("review.history");
  if (!saving && !draftFound) return null;
  return (
    <div className="flex flex-col gap-1 border-b border-border px-4 py-2 text-xs">
      {saving ? (
        <p aria-live="polite" className="text-muted-foreground">
          {t("savingNotice")}
        </p>
      ) : null}
      {draftFound ? (
        <p
          className="text-muted-foreground"
          data-testid="job-review-history-draft-warning"
        >
          {t("load.draftWarning")}
        </p>
      ) : null}
    </div>
  );
}

function HistoryError({ revisions }: { revisions: JobRevisions }) {
  const t = useTranslations("review.history");
  const kind = revisions.errorKind;
  const canRetry = kind !== "unsupported" && kind !== "not_found";
  let message: string;
  switch (kind) {
    case "unsupported":
      message = t("errors.unsupported");
      break;
    case "not_found":
      message = t("errors.notFound");
      break;
    case "busy":
      message =
        revisions.retryReady ||
        revisions.retryAt === null ||
        revisions.failedAt === null
          ? t("errors.busyReady")
          : t("errors.busy", {
              seconds: revisions.retryClock.secondsUntil(
                revisions.retryAt,
                revisions.failedAt,
              ),
            });
      break;
    default:
      message = t("errors.generic", {
        code:
          revisions.error instanceof ApiError
            ? revisions.error.code
            : "network_error",
      });
  }
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-2 text-sm text-destructive"
      data-testid="job-review-history-error"
    >
      <span>{message}</span>
      {canRetry ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!revisions.retryReady}
          onClick={revisions.retry}
          data-testid="job-review-history-button-retry"
        >
          {t("retry")}
        </Button>
      ) : null}
    </div>
  );
}
