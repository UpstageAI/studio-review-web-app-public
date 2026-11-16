"use client";

import { ChevronRightIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { memo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ChangeDraft, ChangeOrigin } from "@/lib/review-model";
import type { MachineTarget } from "@/lib/revision-history";
import { cn } from "@/lib/utils";
import { DetailError } from "./history-detail";
import type { LoadAvailability } from "./history-model";
import { LoadControls, type StructureImpactView } from "./history-row";
import type { RetryClock, RevisionDetail } from "./use-job-revisions";

/** 최초 원본 대상 하나의 표시 정보. */
export interface MachineTargetView {
  key: string;
  target: MachineTarget;
  /** Step 이름(구조면 "문서 구성"). */
  label: string;
  documents: string | null;
  detail: RevisionDetail | undefined;
  availability: LoadAvailability;
  applied: boolean;
  editError: string | null;
  merge: boolean;
  /** 받는 동안 그 대상의 편집이 바뀌어 자동으로 넣지 않았다. */
  skipped: boolean;
  /** 받아 둔 최초 원본(구조)이 문서 집합을 바꾸면 그 영향. */
  impact: StructureImpactView | null;
  /** 이 대상을 불러왔을 때 계산한 영향(불러온 뒤 요약). */
  appliedImpact: StructureImpactView | null;
}

/**
 * "최초 원본"(기계 출력) 행. 펼치면 한 번이라도 저장된 대상마다 불러오기 버튼을 둔다. 결과 대상은 처음
 * 누르면 그 대상의 기계 출력(가장 오래된 행의 `base_content`)을 받고, 받기가 끝나면 상위(`onFetch` 를
 * 넘긴 쪽)가 바로 편집에 불러온다. 받는 동안 그 대상이 바뀌었으면 넣지 않고 안내(`skipped`)만 보인다.
 * 문서 구성 대상은 상위가 펼칠 때 받아 두므로 누르기 전에 막힌 이유나 문서 집합 영향이 보인다. 이미 받은
 * 대상은 누르면 곧바로 불러온다.
 */
export const HistoryMachineRow = memo(function HistoryMachineRow({
  targets,
  expanded,
  onToggle,
  onFetch,
  onLoad,
  retryClock,
}: {
  targets: readonly MachineTargetView[];
  expanded: boolean;
  onToggle: () => void;
  onFetch: (target: MachineTarget) => void;
  onLoad: (key: string, draft: ChangeDraft, origin: ChangeOrigin) => void;
  retryClock: RetryClock;
}) {
  const t = useTranslations("review.history");
  const regionId = "job-review-history-machine-detail";
  return (
    <li
      className="flex flex-col rounded-md border border-dashed border-border"
      data-testid="job-review-history-machine-row"
    >
      <div className="flex min-w-0 items-center gap-2 px-2 py-1.5">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={regionId}
          aria-label={t("machine.toggle")}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          data-testid="job-review-history-machine-toggle"
        >
          <ChevronRightIcon
            aria-hidden
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              expanded && "rotate-90",
            )}
          />
          <Badge variant="secondary" className="shrink-0">
            {t("machine.title")}
          </Badge>
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {t("machine.description")}
          </span>
        </button>
      </div>
      {expanded ? (
        <div
          id={regionId}
          role="region"
          aria-label={t("machine.title")}
          className="flex flex-col gap-2 border-t border-border px-3 py-2"
        >
          {targets.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("machine.none")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {targets.map(view => (
                <MachineTargetLine
                  key={view.key}
                  view={view}
                  onFetch={onFetch}
                  onLoad={onLoad}
                  retryClock={retryClock}
                />
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </li>
  );
});

function MachineTargetLine({
  view,
  onFetch,
  onLoad,
  retryClock,
}: {
  view: MachineTargetView;
  onFetch: (target: MachineTarget) => void;
  onLoad: (key: string, draft: ChangeDraft, origin: ChangeOrigin) => void;
  retryClock: RetryClock;
}) {
  const t = useTranslations("review.history");
  const occurrenceId =
    view.target.type === "result" ? view.target.occurrenceId : undefined;
  const testId = "job-review-history-machine-button-load";
  const { detail, availability } = view;
  // 저장 중 · 충돌은 내용을 받기 전에도 막는다.
  const hardBlock =
    !availability.ok &&
    (availability.block === "saving" || availability.block === "conflict");

  let controls;
  if (detail?.status === "ready" || hardBlock) {
    controls = (
      <>
        <LoadControls
          availability={availability}
          applied={view.applied}
          editError={view.editError}
          merge={view.merge}
          impact={view.impact}
          appliedImpact={view.appliedImpact}
          impactTestId="job-review-history-machine-impact"
          onLoad={draft => onLoad(view.key, draft, { kind: "original" })}
          buttonTestId={testId}
          buttonProps={{ "data-occurrence-id": occurrenceId }}
        />
        {view.skipped && availability.ok ? (
          <p
            aria-live="polite"
            className="text-xs text-muted-foreground"
            data-testid="job-review-history-machine-skipped"
          >
            {t("machine.skipped")}
          </p>
        ) : null}
      </>
    );
  } else if (detail?.status === "error") {
    controls = (
      <DetailError
        detail={detail}
        retryClock={retryClock}
        onRetry={() => onFetch(view.target)}
        testId="job-review-history-detail-button-retry"
      />
    );
  } else {
    const loading = detail?.status === "loading";
    controls = (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={loading}
          onClick={() => onFetch(view.target)}
          data-testid={testId}
          data-occurrence-id={occurrenceId}
        >
          {t("load.button")}
        </Button>
        {loading ? (
          <span
            aria-live="polite"
            className="text-xs text-muted-foreground"
            data-testid="job-review-history-row-load-blocked"
          >
            {t("machineLoading")}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <li className="flex flex-col gap-1">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
        <span className="font-medium">{view.label}</span>
        {view.documents ? (
          <span
            className="min-w-0 truncate text-xs text-muted-foreground"
            title={t("row.documentsHint")}
          >
            {view.documents}
          </span>
        ) : null}
      </div>
      {controls}
    </li>
  );
}
