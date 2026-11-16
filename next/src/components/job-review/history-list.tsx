"use client";

import { CircleAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { memo } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { JobRevision } from "@/lib/review-api/types";
import type { ChangeDraft, ChangeOrigin } from "@/lib/review-model";
import type { MachineTarget, RevisionGroup } from "@/lib/revision-history";
import { DetailError } from "./history-detail";
import type { HistoryItem, LoadBlock } from "./history-model";
import {
  HistoryMachineRow,
  type MachineTargetView,
} from "./history-machine-row";
import { HistoryRow, type HistoryRowView } from "./history-row";
import type {
  OperationDetail,
  RetryClock,
  RevisionDetail,
} from "./use-job-revisions";

/** 머리줄 키(`expanded` 에서 기계 행을 가리킨다). */
export const MACHINE_ROW_KEY = "machine";

/** 묶음을 한 번에 불러온 결과(지금 base 기준). 시트 본문이 계산해 넘긴다. */
export interface GroupLoadSummary {
  loaded: number;
  total: number;
  blocked: Partial<Record<LoadBlock, number>>;
}

/** 지금 페이지의 행 목록(묶음 상자 · 행 · 최초 원본 행). 머리줄이 있는 묶음은 테두리 상자로 감싼다. */
export const HistoryList = memo(function HistoryList({
  items,
  views,
  expanded,
  details,
  now,
  onToggle,
  onLoad,
  onRetryDetail,
  retryClock,
  machineTargets,
  onFetchMachine,
  operations,
  groupSummaries,
  groupBlock,
  onLoadGroup,
}: {
  items: readonly HistoryItem[];
  views: ReadonlyMap<string, HistoryRowView>;
  expanded: ReadonlySet<string>;
  details: ReadonlyMap<string, RevisionDetail>;
  now: number;
  onToggle: (key: string) => void;
  onLoad: (key: string, draft: ChangeDraft, origin: ChangeOrigin) => void;
  onRetryDetail: (revisionId: string) => void;
  retryClock: RetryClock;
  machineTargets: readonly MachineTargetView[];
  onFetchMachine: (target: MachineTarget) => void;
  operations: ReadonlyMap<string, OperationDetail>;
  groupSummaries: ReadonlyMap<string, GroupLoadSummary>;
  /** 묶음 불러오기를 막는 이유(저장 중 · 충돌). */
  groupBlock: Extract<LoadBlock, "saving" | "conflict"> | null;
  onLoadGroup: (operationId: string) => void;
}) {
  const renderRow = (revision: JobRevision, inGroup = false) => {
    const view = views.get(revision.id);
    if (!view) return null;
    return (
      <HistoryRow
        key={revision.id}
        revision={revision}
        view={view}
        expanded={expanded.has(revision.id)}
        detail={details.get(revision.id)}
        now={now}
        onToggle={onToggle}
        onLoad={onLoad}
        onRetryDetail={onRetryDetail}
        retryClock={retryClock}
        inGroup={inGroup}
      />
    );
  };
  return (
    <ol className="flex flex-col gap-1.5" data-testid="job-review-history-list">
      {segmentsOf(items).map(segment => {
        if (segment.kind === "group") {
          const several = segment.continued || segment.group.rows.length > 1;
          const operationId = segment.group.operation.id;
          return (
            <li
              key={`group:${segment.group.key}`}
              className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/40 p-1.5"
              data-testid="job-review-history-group-box"
              data-operation-id={segment.group.operation.id}
            >
              <GroupHeader
                group={segment.group}
                continued={segment.continued}
                loadState={operations.get(operationId)}
                summary={groupSummaries.get(operationId) ?? null}
                hardBlock={groupBlock}
                retryClock={retryClock}
                onLoadAll={onLoadGroup}
              />
              <ol className="flex flex-col gap-1.5">
                {segment.rows.map(revision => renderRow(revision, several))}
              </ol>
            </li>
          );
        }
        if (segment.kind === "machine") {
          return (
            <HistoryMachineRow
              key={MACHINE_ROW_KEY}
              targets={machineTargets}
              expanded={expanded.has(MACHINE_ROW_KEY)}
              onToggle={() => onToggle(MACHINE_ROW_KEY)}
              onFetch={onFetchMachine}
              onLoad={onLoad}
              retryClock={retryClock}
            />
          );
        }
        return renderRow(segment.revision);
      })}
    </ol>
  );
});

type Segment =
  | {
      kind: "group";
      group: RevisionGroup;
      continued: boolean;
      rows: JobRevision[];
    }
  | { kind: "row"; revision: JobRevision }
  | { kind: "machine" };

/** 머리줄 뒤에 이어지는 같은 묶음 행을 머리줄과 한 덩어리로 모은다. */
function segmentsOf(items: readonly HistoryItem[]): Segment[] {
  const out: Segment[] = [];
  let open: Extract<Segment, { kind: "group" }> | null = null;
  for (const item of items) {
    if (item.kind === "group") {
      open = {
        kind: "group",
        group: item.group,
        continued: item.continued,
        rows: [],
      };
      out.push(open);
    } else if (
      item.kind === "row" &&
      open &&
      item.groupKey === open.group.key
    ) {
      open.rows.push(item.revision);
    } else {
      open = null;
      out.push(
        item.kind === "row"
          ? { kind: "row", revision: item.revision }
          : { kind: "machine" },
      );
    }
  }
  return out;
}

/**
 * 묶음 머리줄. 이름 옆 원형 ! 에 마우스를 올리거나 포커스하면 뜻을 설명한다. 같은 저장 2 건 이상이면
 * "모두 불러오기" 로 그 저장의 변경을 한 번에 편집에 넣고 결과를 요약한다.
 */
function GroupHeader({
  group,
  continued,
  loadState,
  summary,
  hardBlock,
  retryClock,
  onLoadAll,
}: {
  group: RevisionGroup;
  continued: boolean;
  loadState: OperationDetail | undefined;
  summary: GroupLoadSummary | null;
  hardBlock: Extract<LoadBlock, "saving" | "conflict"> | null;
  retryClock: RetryClock;
  onLoadAll: (operationId: string) => void;
}) {
  const t = useTranslations("review.history.group");
  const several = continued || group.rows.length > 1;
  const count = Math.max(group.operation.change_count ?? 0, group.rows.length);
  const labels: { key: "same" | "foreign"; text: string }[] = [];
  if (several) {
    labels.push({
      key: "same",
      text: continued ? t("continued", { count }) : t("same", { count }),
    });
  }
  if (group.operation.from_this_collection === false) {
    labels.push({ key: "foreign", text: t("foreign") });
  }
  const operationId = group.operation.id;
  const loading = loadState?.status === "loading";
  return (
    <div
      className="flex flex-col gap-1 px-1 text-xs"
      data-testid="job-review-history-group"
      data-operation-id={operationId}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-medium text-muted-foreground">
        {labels.map(label => (
          <span key={label.key} className="inline-flex items-center gap-1">
            {label.text}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={t(`${label.key}Help`)}
                  className="inline-flex rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  data-testid={`job-review-history-group-info-${label.key}`}
                >
                  <CircleAlertIcon aria-hidden className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-64">
                {t(`${label.key}Help`)}
              </TooltipContent>
            </Tooltip>
          </span>
        ))}
        {several ? (
          <Button
            type="button"
            size="xs"
            variant="outline"
            className="ml-auto"
            disabled={loading || hardBlock !== null}
            onClick={() => onLoadAll(operationId)}
            data-testid="job-review-history-group-button-load-all"
            data-operation-id={operationId}
          >
            {loading ? t("loading") : t("loadAll", { count })}
          </Button>
        ) : null}
      </div>
      {several ? (
        <GroupLoadStatus
          loadState={loadState}
          summary={summary}
          hardBlock={hardBlock}
          retryClock={retryClock}
          onRetry={() => onLoadAll(operationId)}
        />
      ) : null}
    </div>
  );
}

/** 묶음 불러오기의 막힘 · 받기 오류 · 결과 요약. */
function GroupLoadStatus({
  loadState,
  summary,
  hardBlock,
  retryClock,
  onRetry,
}: {
  loadState: OperationDetail | undefined;
  summary: GroupLoadSummary | null;
  hardBlock: Extract<LoadBlock, "saving" | "conflict"> | null;
  retryClock: RetryClock;
  onRetry: () => void;
}) {
  const t = useTranslations("review.history");
  if (loadState?.status === "error") {
    return (
      <DetailError
        detail={loadState}
        retryClock={retryClock}
        onRetry={onRetry}
        testId="job-review-history-group-button-retry"
      />
    );
  }
  if (hardBlock) {
    return (
      <p className="text-muted-foreground">{t(`load.blocked.${hardBlock}`)}</p>
    );
  }
  if (summary) {
    let text: string;
    if (summary.loaded === 0) {
      const reasons = Object.keys(summary.blocked) as LoadBlock[];
      text =
        reasons.length === 1
          ? `${t("group.loadNone")} — ${t(`load.blocked.${reasons[0]!}`)}`
          : t("group.loadNone");
    } else if (summary.loaded === summary.total) {
      text = t("group.loaded", { loaded: summary.loaded });
    } else {
      text = t("group.loadedPartial", {
        loaded: summary.loaded,
        total: summary.total,
      });
    }
    return (
      <p
        aria-live="polite"
        className="text-foreground"
        data-testid="job-review-history-group-load-summary"
        data-loaded={summary.loaded}
        data-total={summary.total}
      >
        {text}
      </p>
    );
  }
  return null;
}
