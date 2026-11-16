"use client";

import { CircleCheckIcon, CircleXIcon, TriangleAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { DocumentLabelField } from "@/components/studio-ui-kit/document-label-field";
import { PageRangeEditor } from "@/components/studio-ui-kit/page-range-editor";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DOCUMENT_LABEL_MAX_LENGTH,
  groupOf,
  labelChoices,
  type IssueCode,
  type ValidationIssue,
} from "@/lib/review-model";
import { cn } from "@/lib/utils";
import { FileGroupSection } from "./file-group-section";
import { useFilmstripOpen } from "./filmstrip-open-context";
import { useJobReview } from "./job-review-context";
import { documentKey } from "./job-review-state";
import { NewDocumentDialog } from "./new-document-dialog";
import { useOrganizer } from "./organizer-context";
import { showsFilmstripBand } from "./organizer-view";
import { pageRangeRows, sourcesFromRows } from "./structure-view";
import { usePageRangeLabels } from "./use-page-range-labels";
import { useDropReasonText } from "./use-drop-reason-text";
import { useStructureActions } from "./use-structure-actions";
import { useReviewPolicy } from "./review-policy-context";

/** 라벨 select 트리거만 칸 너비를 채운다(입력은 기본 class 그대로). */
const LABEL_FIELD_CLASS_NAMES = { trigger: "w-full" } as const;

/** 저장 전 검증 요약에 보이는 순서. 목록에 없는 코드는 끝에 코드 이름으로. */
const ISSUE_CODES: readonly IssueCode[] = [
  "page_missing",
  "duplicate_review_page",
  "page_overlap",
  "page_out_of_range",
  "label_not_in_config",
  "review_file_unavailable",
  "review_group_unavailable",
  "review_document_unavailable",
  "review_step_unavailable",
  "duplicate_review_file",
  "review_limit_exceeded",
  "schema_violation",
  "result_not_editable",
  "package_limit_exceeded",
];

/**
 * 구성 모드 작업 패널: 선택 문서의 라벨(설정 라벨이 있으면 select)·페이지 범위 입력·
 * 문서 제외/복귀·새 문서로 분리·재확인 안내, Job 의 파일 그룹(파일 이동)과 저장 전
 * 검증 요약.
 */
export function StructurePanel() {
  const t = useTranslations("review.structure");
  const tsave = useTranslations("review.save");
  const { state, job, selected, docPages, docChanges, issues } = useJobReview();
  const actions = useStructureActions();
  const pageTools = useReviewPolicy().features.pageTools;
  const rangeLabels = usePageRangeLabels();
  const labelFieldLabels = useMemo(
    () => ({
      noLabel: t("noLabel"),
      notInConfigOption: (label: string) => t("notInConfigOption", { label }),
    }),
    [t],
  );
  const [creating, setCreating] = useState(false);
  const reasonText = useDropReasonText();
  const [filmstripOpen] = useFilmstripOpen();
  const { open: organizerOpen } = useOrganizer();
  const groupId = selected?.document.group_id;
  const fileOptions = useMemo(
    () =>
      job && groupId !== undefined
        ? (groupOf(job, groupId)?.files ?? []).map(file => ({
            fileRef: file.file_ref,
            name: file.name || file.file_ref,
          }))
        : [],
    [job, groupId],
  );
  const sourceFiles = selected?.document.source_files;
  const rows = useMemo(() => pageRangeRows(sourceFiles ?? []), [sourceFiles]);
  if (!job || !selected || !state.session) return null;

  const { document } = selected;
  const excluded =
    job.file_groups?.excluded_documents.includes(document.document_id) ?? false;
  const choices = labelChoices(
    state.session.current,
    job,
    document.document_id,
    selected.stepId,
  );
  const outside =
    choices !== null &&
    document.label !== null &&
    !choices.includes(document.label);
  // 새 문서로 분리 대화 상자의 첫 범위 행: 보던 쪽(파일 + 쪽 번호).
  const viewing =
    docPages[Math.min(state.selectedPageIndex, docPages.length - 1)];
  const initialRow = viewing
    ? { fileRef: viewing.file_ref, text: String(viewing.page) }
    : undefined;
  const change = docChanges.get(
    documentKey({ stepId: selected.stepId, documentId: document.document_id }),
  );

  // 구조 편집 실패는 필름스트립 띠·정리 화면이 보인다. 둘 다 숨어 있으면(띠를 접음) 여기에 보여
  // 조용히 실패하지 않게 한다. 둘이 보일 때는 같은 문구가 겹치지 않게 그리지 않는다.
  const bandShown = showsFilmstripBand(
    state.mode,
    filmstripOpen,
    organizerOpen,
  );
  const editErrorText =
    state.editError && !bandShown ? reasonText(state.editError) : null;

  return (
    <div className="flex flex-col gap-4">
      {editErrorText ? (
        <p
          role="alert"
          className="text-xs text-destructive"
          data-testid="job-review-structure-edit-error"
        >
          {editErrorText}
        </p>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="job-review-structure-label"
          className="text-xs font-medium text-muted-foreground"
        >
          {t("label")}
        </label>
        <DocumentLabelField
          key={
            choices
              ? undefined
              : `${document.document_id}\u0000${document.label ?? ""}`
          }
          value={document.label}
          onValueChange={label =>
            actions.filmstrip.onLabelChange(document.document_id, label)
          }
          choices={choices}
          maxLength={DOCUMENT_LABEL_MAX_LENGTH}
          disabled={!actions.editable}
          id="job-review-structure-label"
          labels={labelFieldLabels}
          testId="job-review-structure"
          classNames={LABEL_FIELD_CLASS_NAMES}
        />
        {outside ? (
          <p className="text-xs text-muted-foreground">{t("notInConfig")}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <h3 className="text-xs font-medium text-muted-foreground">
          {t("pageRanges.title")}
        </h3>
        <PageRangeEditor
          key={document.document_id}
          rows={rows}
          fileOptions={fileOptions}
          validate={rangeLabels.validate}
          onCommit={next => {
            const parsed = sourcesFromRows(next);
            if (parsed) actions.onSetPageRanges(document.document_id, parsed);
          }}
          disabled={!actions.editable}
          labels={rangeLabels.labels}
          testId="job-review-structure-ranges"
        />
      </div>

      {excluded ? (
        <p
          className="rounded-md border border-border bg-muted/50 px-3 py-2 text-xs"
          data-testid="job-review-structure-excluded"
        >
          {t("excludedNotice")}
        </p>
      ) : null}

      {/* 문서 제외와 새 문서로 분리는 설정의 "페이지 편집 도구" 를 켰을 때만 보인다. 이미 제외된 문서의
          되돌리기는 설정과 상관없이 늘 보여, 도구를 꺼 둔 채로도 제외를 풀 수 있게 한다. */}
      {pageTools || excluded ? (
        <div className="flex flex-wrap gap-2">
          {/* 제외되지 않은 문서는 페이지 편집 도구를 켰을 때만 여기까지 온다. */}
          {excluded ? (
            <Button
              type="button"
              variant="outline"
              size="default"
              disabled={!actions.editable}
              onClick={() =>
                actions.filmstrip.onRestoreDocument(document.document_id)
              }
              data-testid="job-review-structure-button-restore"
            >
              {t("restoreDocument")}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="default"
              disabled={!actions.editable}
              onClick={() =>
                actions.filmstrip.onExcludeDocument(document.document_id)
              }
              data-testid="job-review-structure-button-exclude"
            >
              {t("excludeDocument")}
            </Button>
          )}
          {pageTools ? (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="default"
                    disabled={!actions.editable || fileOptions.length === 0}
                    onClick={() => setCreating(true)}
                    data-testid="job-review-structure-button-new-document"
                  >
                    {t("newDocument.open")}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-72">
                  {t("newDocument.hint")}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}
        </div>
      ) : null}
      <NewDocumentDialog
        open={creating}
        onOpenChange={setCreating}
        groupId={document.group_id}
        fileOptions={fileOptions}
        labelChoices={choices}
        afterDocumentId={document.document_id}
        initialRow={initialRow}
        onCreate={actions.onAddDocument}
      />

      {change?.pageSetChanged ? (
        <p
          className="rounded-md border border-border bg-muted/50 px-3 py-2 text-xs"
          data-testid="job-review-structure-recheck"
        >
          {t("recheck")}
        </p>
      ) : null}

      {state.save.phase === "conflict" && state.save.conflict.structure ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/50 px-3 py-2 text-xs text-destructive"
          data-testid="job-review-structure-conflict"
        >
          {tsave("conflictStructure")}
        </p>
      ) : null}

      <FileGroupSection />

      <IssueSummary issues={issues} />
    </div>
  );
}

/**
 * 저장 전 검증 요약. 고칠 때마다 시스템이 문서 구성과 값을 검사한 결과를 코드별 개수로 보인다. 저장을
 * 막는 문제가 없으면 초록 통과 줄, 저장을 막는 문제는 빨간 줄, 저장은 되지만 알아 둘 것은 노란 줄이다.
 */
function IssueSummary({ issues }: { issues: readonly ValidationIssue[] }) {
  const t = useTranslations("review.issues");
  const counts = new Map<string, { count: number; error: boolean }>();
  for (const issue of issues) {
    // `num_pages` 를 모르는 파일 안내는 필름스트립 위에 따로 보인다.
    if (issue.detail?.coverageUnknown) continue;
    const entry = counts.get(issue.code) ?? { count: 0, error: false };
    entry.count += 1;
    entry.error ||= issue.severity === "error";
    counts.set(issue.code, entry);
  }
  const ordered = [...counts.entries()].sort(([a], [b]) => rank(a) - rank(b));
  const blockingKinds = ordered.filter(([, entry]) => entry.error).length;
  const blocking = blockingKinds > 0;

  // 낭독은 요약 한 줄만(통과 줄, 아니면 막는 문제 수). 아래 목록은 고칠 때마다 바뀌므로 읽어 주지 않는다.
  return (
    <section
      aria-labelledby="job-review-issues-title"
      className="flex flex-col gap-1.5"
      data-testid="job-review-structure-issues"
    >
      <div className="flex flex-col gap-0.5">
        <h3
          id="job-review-issues-title"
          className="text-xs font-medium text-muted-foreground"
        >
          {t("title")}
        </h3>
        <p className="text-xs text-muted-foreground">{t("hint")}</p>
      </div>
      {/* 막는 문제가 있을 때는 낭독 전용 — 감싼 칸째 sr-only 로 빼 세로 간격에 끼지 않게 한다. */}
      <div
        aria-live="polite"
        className={blocking ? "sr-only" : undefined}
        data-testid="job-review-structure-issues-status"
      >
        {blocking ? (
          <p>{t("blockingSummary", { count: blockingKinds })}</p>
        ) : (
          <p
            className="flex items-start gap-2 rounded-md border border-state-success/30 bg-state-success-background px-3 py-2 text-sm font-medium text-state-success-foreground"
            data-testid="job-review-structure-issues-ok"
          >
            <CircleCheckIcon
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-state-success"
            />
            {t("ok")}
          </p>
        )}
      </div>
      {ordered.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm">
          {ordered.map(([code, entry]) => {
            const Icon = entry.error ? CircleXIcon : TriangleAlertIcon;
            return (
              <li
                key={code}
                className={cn(
                  "flex items-start gap-2 rounded-md border px-3 py-2",
                  entry.error
                    ? "border-state-error/30 bg-state-error-background text-state-error-foreground"
                    : "border-state-warning/40 bg-state-warning-background text-state-warning-foreground",
                )}
                data-severity={entry.error ? "error" : "warning"}
              >
                <Icon
                  aria-hidden="true"
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    entry.error ? "text-state-error" : "text-state-warning",
                  )}
                />
                <span>
                  <span className="sr-only">
                    {entry.error ? t("blocking") : t("notBlocking")}
                  </span>
                  {isKnown(code)
                    ? t(code, { count: entry.count })
                    : t("other", { code, count: entry.count })}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

function isKnown(code: string): code is IssueCode {
  return (ISSUE_CODES as readonly string[]).includes(code);
}

function rank(code: string): number {
  const index = (ISSUE_CODES as readonly string[]).indexOf(code);
  return index < 0 ? ISSUE_CODES.length : index;
}
