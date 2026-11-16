"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/review-api/review-screen";
import type { JobRevision, JobRevisionOmitted } from "@/lib/review-api/types";
import {
  stringifyJson,
  type JsonValue,
  type ReviewStep,
} from "@/lib/review-model";
import {
  diffStructure,
  diffValues,
  fieldLabel,
  readStructureContent,
  type StructureChange,
  type StructureChangeKind,
  type ValueChange,
} from "@/lib/revision-history";
import type { RetryClock, RevisionDetail } from "./use-job-revisions";

/** 값 비교 표에 그리는 최대 행 수. 넘으면 JSON 보기로 안내한다. */
export const DETAIL_ROW_LIMIT = 200;

/** 표·JSON 에 보일 값. 문자열은 따옴표 없이, 나머지는 JSON. */
function displayValue(value: JsonValue | undefined, none: string): string {
  if (value === undefined) return none;
  if (typeof value === "string") return value;
  return stringifyJson(value);
}

function prettyValue(value: JsonValue): string {
  return typeof value === "string"
    ? value
    : stringifyJson(value, { pretty: true });
}

function omittedKey(omitted: JobRevisionOmitted): "too_large" | "unavailable" {
  return omitted === "too_large" ? "too_large" : "unavailable";
}

/** 행 하나를 펼친 영역의 내용 부분: 받는 중 · 오류 · 비교. */
export function HistoryDetailState({
  detail,
  step,
  retryClock,
  onRetry,
}: {
  detail: RevisionDetail | undefined;
  step: ReviewStep | null;
  retryClock: RetryClock;
  onRetry: () => void;
}) {
  const t = useTranslations("review.history");
  if (!detail || detail.status === "loading") {
    return (
      <p aria-live="polite" className="text-xs text-muted-foreground">
        {t("load.blocked.loading")}
      </p>
    );
  }
  if (detail.status === "error") {
    return (
      <DetailError
        detail={detail}
        retryClock={retryClock}
        onRetry={onRetry}
        testId="job-review-history-detail-button-retry"
      />
    );
  }
  return <HistoryDetail revision={detail.revision} step={step} />;
}

/** 상세(또는 기계 출력) 요청 오류 문구 + 재시도. */
export function DetailError({
  detail,
  retryClock,
  onRetry,
  testId,
}: {
  detail: Extract<RevisionDetail, { status: "error" }>;
  retryClock: RetryClock;
  onRetry: () => void;
  testId: string;
}) {
  const t = useTranslations("review.history");
  const ready = retryClock.readyAt(detail.retryAt);
  let message: string;
  let canRetry = true;
  switch (detail.kind) {
    case "unsupported":
      message = t("errors.unsupported");
      canRetry = false;
      break;
    case "not_found":
      message = t("errors.notFound");
      canRetry = false;
      break;
    case "revision_not_found":
      message = t("errors.revisionNotFound");
      canRetry = false;
      break;
    case "busy":
      message =
        ready || detail.retryAt === null
          ? t("errors.busyReady")
          : t("errors.busy", {
              seconds: retryClock.secondsUntil(detail.retryAt, detail.failedAt),
            });
      break;
    default:
      message = t("errors.detail", {
        code:
          detail.error instanceof ApiError
            ? detail.error.code
            : "network_error",
      });
  }
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-2 text-xs text-destructive"
    >
      <span>{message}</span>
      {canRetry ? (
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={!ready}
          onClick={onRetry}
          data-testid={testId}
        >
          {t("retry")}
        </Button>
      ) : null}
    </div>
  );
}

/** 변경 전 → 변경 후 비교(값은 표, 구조는 문장)와 JSON 보기. */
export function HistoryDetail({
  revision,
  step,
}: {
  revision: JobRevision;
  step: ReviewStep | null;
}) {
  const t = useTranslations("review.history.detail");
  const [showJson, setShowJson] = useState(false);
  const after = revision.content ?? null;
  const before = revision.base_content ?? null;

  let body: ReactNode;
  if (revision.content_omitted || after === null) {
    body = (
      <p
        className="text-xs text-muted-foreground"
        data-testid="job-review-history-detail-omitted"
      >
        {t(`omitted.${omittedKey(revision.content_omitted ?? "unavailable")}`)}
      </p>
    );
  } else if (revision.base_content_omitted || before === null) {
    body = (
      <p
        className="text-xs text-muted-foreground"
        data-testid="job-review-history-detail-omitted"
      >
        {t(
          `baseOmitted.${omittedKey(revision.base_content_omitted ?? "unavailable")}`,
        )}
      </p>
    );
  } else if (revision.type === "structure") {
    body = <StructureDiff before={before} after={after} />;
  } else {
    body = <ValueDiffTable before={before} after={after} step={step} />;
  }

  return (
    <div
      className="flex flex-col gap-2"
      data-testid="job-review-history-detail"
    >
      {revision.base_version === 0 && before !== null ? (
        <p className="text-xs text-muted-foreground">{t("machineBefore")}</p>
      ) : null}
      {body}
      {after !== null || before !== null ? (
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="self-start"
            aria-expanded={showJson}
            onClick={() => setShowJson(value => !value)}
            data-testid="job-review-history-detail-button-json"
          >
            {showJson ? t("hideJson") : t("showJson")}
          </Button>
          {showJson ? (
            <>
              {after !== null ? (
                <JsonBlock title={t("jsonAfter")} value={after} />
              ) : null}
              {before !== null ? (
                <JsonBlock title={t("jsonBefore")} value={before} />
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function JsonBlock({ title, value }: { title: string; value: JsonValue }) {
  const text = useMemo(() => prettyValue(value), [value]);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{title}</span>
      <pre className="max-h-96 overflow-auto rounded-md border border-border bg-muted/40 p-2 text-xs whitespace-pre-wrap break-words">
        {text}
      </pre>
    </div>
  );
}

function ValueDiffTable({
  before,
  after,
  step,
}: {
  before: JsonValue;
  after: JsonValue;
  step: ReviewStep | null;
}) {
  const t = useTranslations("review.history.detail");
  const diff = useMemo(() => diffValues(before, after), [before, after]);
  if (diff.changes.length === 0) {
    return <p className="text-xs text-muted-foreground">{t("noDiff")}</p>;
  }
  const shown = diff.changes.slice(0, DETAIL_ROW_LIMIT);
  const more = diff.changes.length - shown.length;
  return (
    <div className="flex flex-col gap-1">
      <div role="table" className="flex flex-col text-xs">
        <div
          role="row"
          className="hidden grid-cols-3 gap-2 border-b border-border pb-1 font-medium text-muted-foreground sm:grid"
        >
          <span role="columnheader">{t("field")}</span>
          <span role="columnheader">{t("before")}</span>
          <span role="columnheader">{t("after")}</span>
        </div>
        {shown.map((change, index) => (
          <ValueDiffRow
            key={`${change.kind}:${change.path.join("/")}:${index}`}
            change={change}
            label={labelOf(step, change, before, after)}
          />
        ))}
      </div>
      {diff.reorderedArrays.length > 0 ? (
        <p className="text-xs text-muted-foreground">{t("reordered")}</p>
      ) : null}
      {more > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("moreRows", { count: more })}
        </p>
      ) : null}
    </div>
  );
}

function labelOf(
  step: ReviewStep | null,
  change: ValueChange,
  before: JsonValue,
  after: JsonValue,
): string {
  const parts =
    change.kind === "removed"
      ? fieldLabel(step, before, change.beforePath ?? change.path)
      : fieldLabel(step, after, change.afterPath ?? change.path);
  return parts.length > 0 ? parts.join(" › ") : (step?.name ?? "");
}

function ValueDiffRow({
  change,
  label,
}: {
  change: ValueChange;
  label: string;
}) {
  const t = useTranslations("review.history.detail");
  const cell = "min-w-0 whitespace-pre-wrap break-words line-clamp-6";
  return (
    <div
      role="row"
      className="grid grid-cols-2 gap-x-2 gap-y-0.5 border-b border-border py-1.5 last:border-b-0 sm:grid-cols-3"
    >
      <span
        role="cell"
        className={`col-span-2 font-medium sm:col-span-1 ${cell}`}
      >
        {label}
      </span>
      <span
        role="cell"
        aria-label={t("before")}
        className={`text-muted-foreground ${change.before === undefined ? "italic" : "line-through decoration-muted-foreground/50"} ${cell}`}
      >
        {displayValue(change.before, t("none"))}
      </span>
      <span
        role="cell"
        aria-label={t("after")}
        className={`${change.after === undefined ? "text-muted-foreground italic" : "text-foreground"} ${cell}`}
      >
        {displayValue(change.after, t("none"))}
      </span>
    </div>
  );
}

const STRUCTURE_KEYS = {
  fileAdded: "fileAdded",
  fileRemoved: "fileRemoved",
  fileMoved: "fileMoved",
  documentAdded: "documentAdded",
  documentRemoved: "documentRemoved",
  documentLabel: "documentLabel",
  documentMoved: "documentMoved",
  documentPages: "documentPages",
  documentsReordered: "documentsReordered",
  documentExcluded: "documentExcluded",
  documentIncluded: "documentIncluded",
  pagesExcluded: "pagesExcluded",
  pagesIncluded: "pagesIncluded",
} as const satisfies Record<StructureChangeKind, string>;

function StructureDiff({
  before,
  after,
}: {
  before: JsonValue;
  after: JsonValue;
}) {
  const t = useTranslations("review.history.detail");
  const changes = useMemo(() => {
    const a = readStructureContent(before);
    const b = readStructureContent(after);
    return a && b ? diffStructure(a, b) : null;
  }, [before, after]);
  if (changes === null || changes.length === 0) {
    return <p className="text-xs text-muted-foreground">{t("noDiff")}</p>;
  }
  const noLabel = t("structure.noLabel");
  const sentence = (change: StructureChange): string => {
    const key = `structure.${STRUCTURE_KEYS[change.kind]}` as const;
    switch (change.kind) {
      case "fileAdded":
      case "fileRemoved":
      case "fileMoved":
        return t(key, { file: change.name ?? change.fileRef });
      case "documentAdded":
      case "documentRemoved":
      case "documentMoved":
      case "documentExcluded":
      case "documentIncluded":
        return t(key, { label: change.label ?? noLabel });
      case "documentLabel":
        return t(key, {
          document: change.documentId,
          from: change.from ?? noLabel,
          to: change.to ?? noLabel,
        });
      case "documentPages":
        return t(key, { document: change.label ?? change.documentId });
      default:
        return t(key);
    }
  };
  const shown = changes.slice(0, DETAIL_ROW_LIMIT);
  return (
    <div className="flex flex-col gap-1">
      <ul className="flex list-disc flex-col gap-0.5 pl-4 text-xs">
        {shown.map((change, index) => (
          <li key={`${change.kind}:${index}`}>{sentence(change)}</li>
        ))}
      </ul>
      {changes.length > shown.length ? (
        <p className="text-xs text-muted-foreground">
          {t("moreRows", { count: changes.length - shown.length })}
        </p>
      ) : null}
    </div>
  );
}
