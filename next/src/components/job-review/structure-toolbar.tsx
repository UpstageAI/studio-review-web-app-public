"use client";

import { useTranslations } from "next-intl";
import { useId, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  documentPages,
  labelChoices,
  pageKey,
  type DropReason,
} from "@/lib/review-model";
import { useJobReview } from "./job-review-context";
import { MovePagesDialog } from "./move-pages-dialog";
import { movePagesTargets, type MovePagesTarget } from "./move-pages-targets";
import { markSelectPage } from "./perf-marks";
import { neighborsOf, type NeighborInfo } from "./structure-toolbar-model";
import { isKnownDropReason } from "./structure-view";
import { useStructureActions } from "./use-structure-actions";
import { useVisibleDocuments } from "./use-visible-documents";
import { useReviewPolicy } from "./review-policy-context";

/**
 * 구성 모드의 뷰어 툴바. 경계 띠(앞 문서 끝 · 현재 위치 · 뒤 문서 시작)로 이웃 문서를 오가고,
 * 보고 있는 페이지를 그 자리에서 나누기, 이웃 문서로 보내기, 제외하며, 범위를 지정해 여러 페이지를
 * 한 번에 옮긴다. 이웃은 문서 목록, 키보드 이동과 같은 "보이는 문서" 기준이다. 경계 이동과 편집 버튼은
 * 설정의 "페이지 편집 도구" 를 켰을 때만 보이고, 끈 때(기본)는 보기 컨트롤만 남는다.
 *
 * `trailing` 은 첫 줄(문서 경계) 오른쪽 끝에 구분선과 함께 붙는 보기 컨트롤(페이지 썸네일, 페이지 정리)
 * 자리다. 툴바는 뷰어 칼럼 맨 위에 고정이라 컨트롤이 띠를 펼치거나 접어도 움직이지 않는다. 컨트롤이
 * 하나도 그려지지 않으면 구분선도 숨는다. 고른 문서가 없으면 툴바 대신 그 컨트롤만 한 줄로 그린다.
 */
export function StructureToolbar({ trailing }: { trailing?: ReactNode }) {
  const t = useTranslations("review.structure.toolbar");
  const ts = useTranslations("review.structure");
  const tf = useTranslations("review.filmstrip");
  const { state, dispatch, job, selected, docPages } = useJobReview();
  const visible = useVisibleDocuments();
  const actions = useStructureActions();
  const pageTools = useReviewPolicy().features.pageTools;
  // 툴바 동작이 적용되지 않은 사유. 다른 문서로 가면 보이지 않는다.
  const [error, setError] = useState<{
    documentId: string;
    text: string;
  } | null>(null);
  const [moving, setMoving] = useState(false);
  const previousReasonId = useId();
  const nextReasonId = useId();

  const neighbors = useMemo(
    () => neighborsOf(visible, state.selectedDocument),
    [visible, state.selectedDocument],
  );
  const targets = useMemo<MovePagesTarget[]>(() => {
    if (!selected) return [];
    const { group_id: groupId, document_id: selfId } = selected.document;
    // 다른 그룹 후보는 movePagesTargets 가 버리므로 페이지 수를 세지 않는다. index 가 전체 순서
    // 기준이라 후보 배열의 길이·순서는 그대로 둔다.
    return movePagesTargets(
      visible.map(item => ({
        documentId: item.document.document_id,
        groupId: item.document.group_id,
        label: item.document.label,
        pageCount:
          item.document.group_id === groupId
            ? documentPages(item.document).length
            : 0,
      })),
      { groupId, excludeDocumentId: selfId },
    );
  }, [visible, selected]);
  // 새 문서로 분리할 때 고를 수 있는 라벨(현재 문서와 같은 설정 라벨).
  const session = state.session?.current;
  const selectedId = selected?.document.document_id;
  const selectedStepId = selected?.stepId;
  const choices = useMemo(
    () =>
      session && job && selectedId !== undefined
        ? labelChoices(session, job, selectedId, selectedStepId)
        : null,
    [session, job, selectedId, selectedStepId],
  );

  // 고른 문서가 없거나 페이지 편집 도구를 끈 때(기본)는 보기 컨트롤(페이지 썸네일, 페이지 정리)만 그린다.
  // 이때도 컨테이너 쿼리 기준을 두어, 열이 좁으면 보기 컨트롤의 글자가 접힌다.
  if (!selected || !pageTools) {
    return trailing ? (
      <div className="@container flex min-w-0 shrink-0 items-center justify-end gap-1 empty:hidden">
        {trailing}
      </div>
    ) : null;
  }

  const documentId = selected.document.document_id;
  const pageIndex = Math.min(
    state.selectedPageIndex,
    Math.max(docPages.length - 1, 0),
  );
  const current = docPages[pageIndex];
  const editable = actions.editable;
  const { previous, next } = neighbors;
  // 이웃으로 보낼 수 없는 사유. 버튼은 포커스를 잃지 않게 aria-disabled 로만 막고 사유를 연결한다.
  const previousReason = previous?.sameGroup
    ? null
    : previous
      ? t("previousOtherGroup")
      : t("noPreviousDocument");
  const nextReason = next?.sameGroup
    ? null
    : next
      ? t("nextOtherGroup")
      : t("noNextDocument");
  const errorText =
    error && error.documentId === documentId ? error.text : null;

  const reasonText = (reason: DropReason) =>
    isKnownDropReason(reason)
      ? ts(`errors.${reason}`)
      : ts("errors.generic", { code: reason });
  const goTo = (neighbor: NeighborInfo, index: number) => {
    dispatch({
      type: "SELECT_DOCUMENT",
      document: { stepId: neighbor.stepId, documentId: neighbor.documentId },
    });
    markSelectPage(index, "toolbar");
    dispatch({ type: "SELECT_PAGE", index });
  };
  const splitHere = () => {
    const before = docPages[pageIndex - 1];
    if (!before) return;
    const outcome = actions.onSplitAndSelect(documentId, pageKey(before));
    setError(
      outcome.ok ? null : { documentId, text: reasonText(outcome.reason) },
    );
  };
  const sendTo = (neighbor: NeighborInfo | null, index: number) => {
    if (!current || !neighbor || !neighbor.sameGroup) return;
    setError(null);
    actions.filmstrip.onMovePage(
      documentId,
      pageKey(current),
      neighbor.documentId,
      index,
    );
  };

  return (
    <div className="flex min-w-0 shrink-0 flex-col gap-1">
      <div
        role="group"
        aria-label={t("label")}
        // 컨테이너 쿼리: 툴바 폭이 좁으면 보기 컨트롤의 글자를 접어 문서 경계 글이 들어갈 자리를 남긴다.
        className="@container flex min-w-0 flex-col gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs"
        data-testid="job-review-structure-toolbar"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {/* 경계에서도 버튼을 남겨 두고 aria-disabled 로만 막는다(disabled 는 포커스를 잃는다). */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-disabled={previous ? undefined : true}
            onClick={() => {
              if (!previous) return;
              goTo(previous, Math.max(previous.pageCount - 1, 0));
            }}
            className={previous ? undefined : "cursor-not-allowed opacity-50"}
            data-testid="job-review-structure-toolbar-button-previous"
          >
            {previous
              ? t("previousEnd", {
                  index: previous.index + 1,
                  page: previous.lastPage?.page ?? 0,
                })
              : t("noPrevious")}
          </Button>
          <span
            className="min-w-0 flex-1 truncate text-center text-muted-foreground"
            data-testid="job-review-structure-toolbar-current"
          >
            {t("current", {
              index: neighbors.position + 1,
              label: selected.document.label ?? tf("untitled"),
              page: docPages.length === 0 ? 0 : pageIndex + 1,
              total: docPages.length,
            })}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-disabled={next ? undefined : true}
            onClick={() => {
              if (!next) return;
              goTo(next, 0);
            }}
            className={next ? undefined : "cursor-not-allowed opacity-50"}
            data-testid="job-review-structure-toolbar-button-next"
          >
            {next
              ? t("nextStart", {
                  index: next.index + 1,
                  page: next.firstPage?.page ?? 0,
                })
              : t("noNext")}
          </Button>
          {/* 컨트롤이 하나도 그려지지 않으면(`:empty`) 구분선째 숨는다. */}
          {trailing ? (
            <div className="flex shrink-0 items-center gap-1 border-l border-border pl-2 empty:hidden">
              {trailing}
            </div>
          ) : null}
        </div>
        <TooltipProvider delayDuration={200}>
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!editable || pageIndex === 0 || !current}
                  onClick={splitHere}
                  data-testid="job-review-structure-toolbar-button-split"
                >
                  {t("splitHere")}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-72">
                {t("splitHereHint")}
              </TooltipContent>
            </Tooltip>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!editable || !current}
              aria-disabled={previousReason ? true : undefined}
              aria-describedby={previousReason ? previousReasonId : undefined}
              title={previousReason ?? undefined}
              className={
                previousReason ? "cursor-not-allowed opacity-50" : undefined
              }
              onClick={() => sendTo(previous, previous?.pageCount ?? 0)}
              data-testid="job-review-structure-toolbar-button-to-previous"
            >
              {t("toPrevious")}
            </Button>
            {previousReason ? (
              <span id={previousReasonId} className="sr-only">
                {previousReason}
              </span>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!editable || !current}
              aria-disabled={nextReason ? true : undefined}
              aria-describedby={nextReason ? nextReasonId : undefined}
              title={nextReason ?? undefined}
              className={
                nextReason ? "cursor-not-allowed opacity-50" : undefined
              }
              onClick={() => sendTo(next, 0)}
              data-testid="job-review-structure-toolbar-button-to-next"
            >
              {t("toNext")}
            </Button>
            {nextReason ? (
              <span id={nextReasonId} className="sr-only">
                {nextReason}
              </span>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!editable || !current}
              onClick={() => {
                if (!current) return;
                setError(null);
                actions.filmstrip.onExcludePage(documentId, pageKey(current));
              }}
              data-testid="job-review-structure-toolbar-button-exclude"
            >
              {t("excludePage")}
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!editable || !current}
                  onClick={() => setMoving(true)}
                  data-testid="job-review-structure-toolbar-button-move-pages"
                >
                  {t("movePages")}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-72">
                {t("movePagesHint")}
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>
      {errorText ? (
        <p
          role="alert"
          className="text-xs text-destructive"
          data-testid="job-review-structure-toolbar-error"
        >
          {errorText}
        </p>
      ) : null}
      <MovePagesDialog
        open={moving}
        onOpenChange={setMoving}
        documentId={documentId}
        docPages={docPages}
        currentIndex={pageIndex}
        targets={targets}
        labelChoices={choices}
        defaultLabel={selected.document.label}
        onMove={actions.onMovePages}
      />
    </div>
  );
}
