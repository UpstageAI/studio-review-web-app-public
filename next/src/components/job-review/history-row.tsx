"use client";

import { ChevronRightIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { memo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDateTime } from "@/lib/format";
import { formatRelativeTime } from "@/lib/relative-time";
import type { JobRevision } from "@/lib/review-api/types";
import type { ChangeDraft, ChangeOrigin, ReviewStep } from "@/lib/review-model";
import type { StructureImpactStatus } from "@/lib/revision-history";
import { cn } from "@/lib/utils";
import { HistoryDetailState } from "./history-detail";
import type { LoadAvailability } from "./history-model";
import type { RetryClock, RevisionDetail } from "./use-job-revisions";

/** 구조를 불러오면 바뀌는 문서와 영향받는 결과(Step 이름). 시트 본문이 계산해 넘긴다. */
export interface StructureImpactView {
  documents: {
    label: string | null;
    status: StructureImpactStatus;
    /** 연결된 결과의 Step 이름(중복 제거). */
    results: string[];
  }[];
  resultCount: number;
}

const IMPACT_DOCUMENTS_SHOWN = 5;

/**
 * 옛 문서 구성을 불러오기 전 영향 경고(`applied` 면 불러온 뒤 요약). 막지 않고 알리기만 한다.
 * `batchHint` 면 같은 저장의 값도 함께 불러오는 "모두 불러오기" 를 알려 준다.
 */
export function ImpactNotice({
  impact,
  applied = false,
  batchHint = false,
  testId,
}: {
  impact: StructureImpactView;
  applied?: boolean;
  batchHint?: boolean;
  testId: string;
}) {
  const t = useTranslations("review.history");
  const counts = {
    documents: impact.documents.length,
    results: impact.resultCount,
  };
  if (applied) {
    return (
      <p
        role="note"
        className="text-xs text-muted-foreground"
        data-testid={testId}
        data-state="applied"
      >
        {t("load.impact.applied", counts)}
      </p>
    );
  }
  const shown = impact.documents.slice(0, IMPACT_DOCUMENTS_SHOWN);
  const more = impact.documents.length - shown.length;
  return (
    <div
      role="note"
      className="flex flex-col gap-1 rounded-md border border-state-warning/40 bg-state-warning-background px-2 py-1.5 text-xs text-state-warning-foreground"
      data-testid={testId}
      data-state="pending"
    >
      <p className="font-medium">{t("load.impact.title", counts)}</p>
      <ul className="flex flex-col gap-0.5">
        {shown.map((document, index) => (
          <li key={index} className="flex flex-col">
            <span>
              {t(`load.impact.${document.status}`, {
                label: document.label ?? t("row.noLabel"),
              })}
            </span>
            {document.status === "added" ? null : (
              <span className="text-muted-foreground">
                {document.results.length > 0
                  ? t("load.impact.results", {
                      names: document.results.join(", "),
                    })
                  : t("load.impact.noResults")}
              </span>
            )}
          </li>
        ))}
      </ul>
      {more > 0 ? <p>{t("load.impact.more", { count: more })}</p> : null}
      {batchHint ? <p>{t("load.impact.batchHint")}</p> : null}
    </div>
  );
}

/** 행에 보일 판정 결과. 시트 본문이 계산해 넘긴다. */
export interface HistoryRowView {
  stepLabel: string;
  step: ReviewStep | null;
  documents: { labels: string[]; more: number } | null;
  isCurrent: boolean;
  /** 펼쳐서 내용을 받은 행만 계산한다. */
  availability: LoadAvailability | null;
  /** 이 행을 불러왔고 지금 값이 그 내용과 같다. */
  applied: boolean;
  /** 이 행을 불러오다 실패한 이유 문구. */
  editError: string | null;
  merge: boolean;
  /** 불러올 수 있는 구조 행이 문서 집합을 바꾸면 그 영향. */
  impact: StructureImpactView | null;
  /** 이 행을 불러왔을 때 계산한 영향(불러온 뒤 요약). */
  appliedImpact: StructureImpactView | null;
}

/** 편집에 불러오기 버튼 · 막힌 이유 · 불러옴 상태 · 실패 안내. 행과 기계 출력 대상이 같이 쓴다. */
export function LoadControls({
  availability,
  applied,
  editError,
  merge,
  impact,
  appliedImpact,
  impactTestId,
  batchHint = false,
  onLoad,
  buttonTestId,
  buttonProps,
}: {
  availability: LoadAvailability;
  applied: boolean;
  editError: string | null;
  merge: boolean;
  impact: StructureImpactView | null;
  appliedImpact: StructureImpactView | null;
  impactTestId: string;
  /** 같은 저장 묶음(2 건 이상)의 행이다 — 영향 경고에 "모두 불러오기" 힌트를 붙인다. */
  batchHint?: boolean;
  onLoad: (draft: ChangeDraft) => void;
  buttonTestId: string;
  buttonProps?: Record<string, string | undefined>;
}) {
  const t = useTranslations("review.history.load");
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={!availability.ok}
          onClick={() => {
            if (availability.ok) onLoad(availability.draft);
          }}
          data-testid={buttonTestId}
          {...buttonProps}
        >
          {t("button")}
        </Button>
        {applied && !editError ? (
          <span
            aria-live="polite"
            className="text-xs text-foreground"
            data-testid="job-review-history-row-loaded"
          >
            {t("done")}
          </span>
        ) : !availability.ok ? (
          <span
            className="text-xs text-muted-foreground"
            data-testid="job-review-history-row-load-blocked"
          >
            {t(`blocked.${availability.block}`)}
          </span>
        ) : null}
      </div>
      {editError ? (
        <p
          role="alert"
          className="text-xs text-destructive"
          data-testid="job-review-history-row-edit-error"
        >
          {t("failed", { reason: editError })}
        </p>
      ) : null}
      {merge && availability.ok ? (
        <p className="text-xs text-muted-foreground">{t("mergeNote")}</p>
      ) : null}
      {impact && availability.ok ? (
        <ImpactNotice
          impact={impact}
          batchHint={batchHint}
          testId={impactTestId}
        />
      ) : applied && !editError && appliedImpact ? (
        <ImpactNotice impact={appliedImpact} applied testId={impactTestId} />
      ) : null}
    </div>
  );
}

/** 반영 시각(상대) + 툴팁(절대 시각 · 작성자 · 참조 · 사유). */
function RevisionTime({
  revision,
  now,
}: {
  revision: JobRevision;
  now: number;
}) {
  const t = useTranslations("review.history.row");
  const locale = useLocale();
  const relative = formatRelativeTime(revision.published_at, locale, now);
  const absolute = formatDateTime(revision.published_at, locale) ?? "";
  const copied = revision.origin?.type === "copy";
  const lines = [
    copied
      ? t("copiedAt", { time: absolute })
      : t("publishedAt", { time: absolute }),
  ];
  if (revision.created_by)
    lines.push(t("createdBy", { name: revision.created_by }));
  if (revision.operation.client_reference) {
    lines.push(t("reference", { value: revision.operation.client_reference }));
  }
  if (revision.operation.reason) {
    lines.push(t("reason", { value: revision.operation.reason }));
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <time
          tabIndex={0}
          dateTime={new Date(revision.published_at * 1000).toISOString()}
          className="shrink-0 text-xs text-muted-foreground tabular-nums"
        >
          {relative ?? absolute}
        </time>
      </TooltipTrigger>
      <TooltipContent className="flex flex-col gap-0.5">
        {lines.map(line => (
          <span key={line}>{line}</span>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}

/** 변경 1 건. 머리줄을 누르면 내용을 받아 비교와 불러오기를 보인다. */
export const HistoryRow = memo(function HistoryRow({
  revision,
  view,
  expanded,
  detail,
  now,
  onToggle,
  onLoad,
  onRetryDetail,
  retryClock,
  inGroup = false,
}: {
  revision: JobRevision;
  view: HistoryRowView;
  expanded: boolean;
  detail: RevisionDetail | undefined;
  now: number;
  onToggle: (revisionId: string) => void;
  onLoad: (key: string, draft: ChangeDraft, origin: ChangeOrigin) => void;
  onRetryDetail: (revisionId: string) => void;
  retryClock: RetryClock;
  /** 같은 저장 2 건 이상의 묶음 안 행이다. */
  inGroup?: boolean;
}) {
  const t = useTranslations("review.history.row");
  const regionId = `job-review-history-detail-${revision.id}`;
  const name =
    revision.type === "structure" ? t("type.structure") : view.stepLabel;
  return (
    <li
      className="flex flex-col rounded-md border border-border"
      data-testid="job-review-history-row"
      data-revision-id={revision.id}
      data-type={revision.type}
      data-occurrence-id={revision.result?.occurrence_id}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1.5">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={regionId}
          aria-label={t("toggle", { name })}
          onClick={() => onToggle(revision.id)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          data-testid="job-review-history-row-toggle"
        >
          <ChevronRightIcon
            aria-hidden
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              expanded && "rotate-90",
            )}
          />
          <Badge variant="outline" className="shrink-0">
            {t(`type.${revision.type}`)}
          </Badge>
          {revision.type === "result" ? (
            <span className="min-w-0 truncate font-medium">
              {view.stepLabel}
            </span>
          ) : null}
          {view.documents ? (
            <span
              className="min-w-0 truncate text-xs text-muted-foreground"
              title={t("documentsHint")}
            >
              {view.documents.labels.length === 0
                ? t("noDocuments")
                : view.documents.labels.join(", ")}
              {view.documents.more > 0
                ? ` ${t("documentsMore", { count: view.documents.more })}`
                : null}
            </span>
          ) : null}
          <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
            {t("version", {
              from: revision.base_version,
              to: revision.version,
            })}
          </span>
        </button>
        <RowBadges revision={revision} isCurrent={view.isCurrent} />
        <RevisionTime revision={revision} now={now} />
      </div>
      {expanded ? (
        <div
          id={regionId}
          role="region"
          aria-label={name}
          className="flex flex-col gap-2 border-t border-border px-3 py-2"
        >
          <HistoryDetailState
            detail={detail}
            step={view.step}
            retryClock={retryClock}
            onRetry={() => onRetryDetail(revision.id)}
          />
          {view.availability &&
          (detail?.status === "ready" ||
            (!view.availability.ok &&
              view.availability.block !== "loading")) ? (
            <LoadControls
              availability={view.availability}
              applied={view.applied}
              editError={view.editError}
              merge={view.merge}
              impact={view.impact}
              appliedImpact={view.appliedImpact}
              impactTestId="job-review-history-row-impact"
              batchHint={inGroup}
              onLoad={draft =>
                onLoad(revision.id, draft, {
                  kind: "revision",
                  revisionId: revision.id,
                  version: revision.version,
                })
              }
              buttonTestId="job-review-history-row-button-load"
            />
          ) : null}
        </div>
      ) : null}
    </li>
  );
});

function RowBadges({
  revision,
  isCurrent,
}: {
  revision: JobRevision;
  isCurrent: boolean;
}) {
  const t = useTranslations("review.history.row.badge");
  return (
    <>
      {isCurrent ? (
        <Badge data-testid="job-review-history-row-badge-current">
          {t("current")}
        </Badge>
      ) : null}
      {revision.base_version === 0 ? (
        <Badge
          variant="secondary"
          data-testid="job-review-history-row-badge-machine"
        >
          {t("fromMachine")}
        </Badge>
      ) : null}
      {revision.origin?.type === "copy" ? (
        <Badge
          variant="secondary"
          data-testid="job-review-history-row-badge-copied"
        >
          {t("copied")}
        </Badge>
      ) : null}
      {revision.operation.kind === "migration" ? (
        <Badge
          variant="secondary"
          data-testid="job-review-history-row-badge-system"
        >
          {t("system")}
        </Badge>
      ) : null}
    </>
  );
}
