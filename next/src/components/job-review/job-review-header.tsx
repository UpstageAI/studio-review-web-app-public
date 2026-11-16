"use client";

import { ArrowLeftIcon, HistoryIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useRef, type ReactNode } from "react";
import { collectionHref } from "@/components/collections/links";
import { ReviewStatusBadge } from "@/components/collections/review-status-badge";
import { usePublishLeaveGuard } from "@/components/leave-guard-store";
import { ReviewActions } from "@/components/studio-ui-kit/review-actions";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Link, useRouter } from "@/i18n/navigation";
import { isNewTabClick } from "@/lib/links";
import { cn } from "@/lib/utils";
import { useJobReview } from "./job-review-context";
import { isEditableTarget } from "./document-navigation";
import {
  useNoHeaderExtension,
  type UseJobReviewHeaderExtension,
} from "./header-extension";
import { historyAvailability } from "./history-model";
import { JsonMenu } from "./json-menu";
import type { SaveStatus } from "./job-review-state";
import { confirmLeave } from "@/lib/leave-confirm";
import {
  COMPLETE_KEYSHORTCUTS,
  isInDialog,
  reviewShortcutOf,
  SAVE_KEYSHORTCUTS,
} from "./review-shortcuts";
import { saveAndCompleteStep, type PendingComplete } from "./save-and-complete";
import { saveReadiness } from "./save-readiness";
import { useReviewPolicy } from "./review-policy-context";

/** 머리에 보일 짧은 저장 상태(자세한 것은 트레이). */
function shortStatus(
  save: SaveStatus,
): { key: ShortStatusKey; tone: "muted" | "error" | "ok" } | null {
  switch (save.phase) {
    case "uploading":
    case "polling":
      return { key: "saving", tone: "muted" };
    case "reloading":
      return { key: "reloading", tone: "muted" };
    case "saved":
      return save.reloadFailed
        ? { key: "reloadFailed", tone: "error" }
        : {
            key: save.revision === null ? "savedNoRevision" : "saved",
            tone: "ok",
          };
    case "no_change":
      return { key: "noChange", tone: "muted" };
    case "conflict":
      return { key: "conflict", tone: "error" };
    case "blocked":
    case "failed":
    case "stopped":
      return { key: "failed", tone: "error" };
    default:
      return null;
  }
}

/** 버튼 줄의 testid. 스모크와 트레이 닫힘 포커스 복귀가 이 값을 읽는다. */
const ACTION_TEST_IDS = {
  status: "job-review-save-status",
  tray: "job-review-tray-button-open",
  changeCount: "job-review-change-count",
  save: "job-review-button-save",
} as const;

type ShortStatusKey =
  | "saving"
  | "reloading"
  | "saved"
  | "savedNoRevision"
  | "reloadFailed"
  | "noChange"
  | "conflict"
  | "failed";

/** "저장하고 완료" 를 누른 뒤 저장 결과를 기다리는 동안의 표시. */
/**
 * 검수 화면 머리. 한 줄에 왼쪽 돌아가기 화살표(마우스를 올리면 Collection 이름)와 Job 이름(첫 파일명,
 * 마우스를 올리면 모든 파일명과 Job ID), 검수 상태, 가운데 Step 트랙, 오른쪽에 JSON 메뉴(설정에서 켰을
 * 때), 변경 사항, 저장, 주 동작이다. 검수 큐·완료 안내처럼 화면 밖 기능은 머리 확장 hook
 * (`useHeaderExtension`)이 더한다. 저장하지 않은 변경이 있으면 주 동작이 "저장하고 완료" 가 되어 저장이
 * 반영된 뒤 이어서 검수 완료(확장이 다음으로 넘기면 다음 Job 열기)까지 한다. ⌘/Ctrl+S 는 저장, ⌘/Ctrl+Enter
 * 는 주 동작이다.
 */
export function JobReviewHeader({
  track = null,
  useHeaderExtension = useNoHeaderExtension,
}: {
  /** 가운데에 둘 Step 탭 트랙(Studio 워크플로우 화면 머리와 같은 자리). 탭이 하나 이하면 없음. */
  track?: ReactNode;
  /** 머리 확장 hook(`JobReviewScreen` 참고). 마운트된 동안 같은 함수여야 한다. */
  useHeaderExtension?: UseJobReviewHeaderExtension;
}) {
  const t = useTranslations("review.header");
  const ts = useTranslations("review.save.short");
  const tsave = useTranslations("review.save");
  const tnotice = useTranslations("review.reviewStatus.notice");
  const { state, dispatch, job, save, saving, completeReview, reopenReview } =
    useJobReview();
  const conflictHintId = useId();
  const { features } = useReviewPolicy();
  const jsonMenu = features.jsonMenu;
  const historyMenu = features.history;
  const loading = state.status === "loading";
  const files = job?.file_groups?.groups.flatMap(group => group.files) ?? [];
  const firstFileName = files[0]?.name || null;
  const extraFiles = Math.max(files.length - 1, 0);
  const jobName = firstFileName ?? state.jobId;
  const changeCount = state.session?.entries.length ?? 0;
  const dirty = changeCount > 0 || saving;
  const leaveMessage = saving ? t("leaveConfirmSaving") : t("leaveConfirm");
  // 공통 상단 바(처음 화면 링크, 언어 바꾸기)도 떠나기 전에 묻도록 이 상태를 올려 둔다.
  usePublishLeaveGuard(dirty, leaveMessage);
  const router = useRouter();
  const backHref = collectionHref(state.collectionId);
  const status = shortStatus(state.save);
  // 충돌을 받은 뒤 다시 저장해도 같은 충돌이 나므로, 다시 불러올 때까지 저장을 막는다.
  const readiness = saveReadiness({ changeCount, save: state.save, saving });
  const conflicted = readiness.conflicted;
  const extension = useHeaderExtension({
    collectionId: state.collectionId,
    collectionName: state.collectionName,
    jobId: state.jobId,
    firstFileName,
    ready: state.status === "ready",
    dirty,
    leaveMessage,
  });
  const rs = state.reviewStatus;
  const ready =
    state.status === "ready" &&
    rs.value !== "unknown" &&
    !saving &&
    !conflicted &&
    rs.updating === null;
  const canComplete = ready && changeCount === 0;
  // 차단 문제(`blocking`)는 보지 않는다. 눌리면 트레이가 열려 이유를 보여 준다.
  const canSave =
    readiness.hasChanges && !readiness.saving && !readiness.conflicted;
  // 검수 완료 Job 은 고쳐 저장하면 검수 중으로 돌아가므로 "저장하고 완료" 를 두지 않는다.
  const saveFirst = changeCount > 0 && rs.value !== "done";
  const canSaveAndComplete = ready && saveFirst;
  const advanceAfterComplete = extension.advancesAfterComplete;

  const onComplete = async () => {
    const ok = await completeReview();
    if (!ok) return;
    await extension.onCompleted(jobName);
  };

  // "저장하고 완료": 저장을 시작하고, 반영(다시 불러오기까지)되면 완료로 이어 간다. 일부만 반영,
  // 충돌, 실패, 변경 없음이면 멈추고 저장 상태 문구로 알린다.
  const pendingRef = useRef<PendingComplete | null>(null);
  const onSaveAndComplete = () => {
    pendingRef.current = { requestKey: state.requestKey, from: state.save };
    save();
  };
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  });
  useEffect(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    const step = saveAndCompleteStep(pending, {
      requestKey: state.requestKey,
      save: state.save,
      changeCount,
      statusBusy: rs.updating !== null || rs.revertRequested,
    });
    if (step === "wait") return;
    pendingRef.current = null;
    if (step === "complete") void onCompleteRef.current();
  }, [
    state.requestKey,
    state.save,
    changeCount,
    rs.updating,
    rs.revertRequested,
  ]);

  // 전역 단축키. 핸들러는 렌더마다 최신 동작으로 바꿔 둔다.
  const shortcutRef = useRef<{
    save: (() => void) | null;
    complete: (() => void) | null;
  }>({ save: null, complete: null });
  useEffect(() => {
    shortcutRef.current = {
      save: canSave ? save : null,
      complete: canSaveAndComplete
        ? onSaveAndComplete
        : canComplete && rs.value !== "done"
          ? () => void onCompleteRef.current()
          : null,
    };
  });
  useEffect(() => {
    let deferred: ReturnType<typeof setTimeout> | null = null;
    const onKeyDown = (event: KeyboardEvent) => {
      const inDialog = isInDialog(event.target);
      const inEditable = isEditableTarget(event.target);
      const command = reviewShortcutOf(event, { inDialog, inEditable });
      if (!command) return;
      // ⌘/Ctrl+S 는 저장할 것이 없어도 브라우저의 "페이지 저장" 을 막는다.
      event.preventDefault();
      if (command === "save" && inEditable && !inDialog) {
        // 값 칸과 라벨 칸은 blur 에서 확정되므로, 먼저 확정하고 그 변경이 반영된 다음에 저장한다.
        // 확정은 이산 이벤트라 React 가 바로 그리고 effect 까지 끝내므로 다음 작업에서 최신 상태를 읽는다.
        (event.target as HTMLElement).blur();
        if (deferred !== null) clearTimeout(deferred);
        deferred = setTimeout(() => {
          deferred = null;
          shortcutRef.current.save?.();
        }, 0);
        return;
      }
      shortcutRef.current[command]?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (deferred !== null) clearTimeout(deferred);
    };
  }, []);

  const actionLabels = useMemo(
    () => ({ tray: t("tray"), save: t("save"), saving: t("saving") }),
    [t],
  );
  const saveShortcut = t("saveShortcut");
  const completeShortcut = t("completeShortcut");
  const primaryLabel =
    rs.updating === "complete"
      ? t("completing")
      : saveFirst
        ? advanceAfterComplete
          ? t("saveAndNext")
          : t("saveAndComplete")
        : advanceAfterComplete
          ? t("completeAndNext")
          : t("complete");

  return (
    <header className="flex flex-col gap-4 border-b border-border pb-3">
      {/* 머리 확장이 더하는 것(이 앱은 검수 큐와 완료 안내를 공통 상단 바로 옮겨 그린다). */}
      {extension.extras}
      {/* Studio 워크플로우 화면 머리처럼 왼쪽 돌아가기와 제목, 가운데 Step 트랙, 오른쪽 동작 */}
      {/* 줄 높이를 단계 트랙(48px)에 맞춰 두어, 불러온 뒤 트랙이 생겨도 머리 높이가 바뀌지 않는다. */}
      {/* 폭이 모자라면 동작 묶음을 한 줄로 지키고(오른쪽 열 최소 = 묶음 폭) 트랙이 줄어든다(탭 이름 말줄임). */}
      <div className="flex min-h-12 flex-wrap items-center gap-x-6 gap-y-3 xl:grid xl:grid-cols-[minmax(14rem,1fr)_minmax(0,max-content)_minmax(max-content,1fr)]">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="-ml-2 shrink-0 text-muted-dark"
          >
            <Link
              href={backHref}
              onClick={event => {
                // 새 탭·새 창으로 여는 클릭은 이 화면을 떠나지 않으므로 묻지 않는다.
                if (!dirty || isNewTabClick(event)) return;
                event.preventDefault();
                void confirmLeave(dirty, leaveMessage).then(ok => {
                  if (ok) router.push(backHref);
                });
              }}
              aria-label={t("back")}
              title={`${t("back")}\n${state.collectionName || state.collectionId}`}
              data-testid="job-review-link-back"
            >
              <ArrowLeftIcon aria-hidden="true" />
            </Link>
          </Button>
          <h1
            className="flex min-w-0 items-baseline gap-x-2 text-lg font-semibold tracking-tight"
            // 파일이 여럿이면 모든 파일명을, 이어서 Job ID 를 마우스를 올렸을 때 보인다.
            title={[...files.map(file => file.name), state.jobId].join("\n")}
            data-testid="job-review-title"
          >
            {loading ? (
              // 불러오는 동안은 Job ID 대신 자리만 그려, 파일명으로 바뀔 때 글자가 바뀌지 않게 한다.
              <Skeleton className="h-7 w-56" />
            ) : (
              <span
                className={cn(
                  "truncate",
                  firstFileName === null && "font-mono",
                )}
              >
                {jobName}
              </span>
            )}
            {extraFiles > 0 ? (
              <span className="shrink-0 text-sm font-normal text-muted-foreground">
                {t("moreFiles", { count: extraFiles })}
              </span>
            ) : null}
          </h1>
          {job ? (
            <ReviewStatusBadge
              status={rs.value !== "unknown" ? rs.value : undefined}
              completedAt={rs.completedAt}
              testId="job-review-badge-review-status"
            />
          ) : null}
        </div>
        {track ? (
          <div className="min-w-0 max-w-full xl:justify-self-center">
            {track}
          </div>
        ) : loading ? (
          <Skeleton className="h-12 w-[28rem] max-w-full rounded-full xl:justify-self-center" />
        ) : (
          <span aria-hidden="true" className="hidden xl:block" />
        )}
        {loading ? (
          <div className="flex items-center gap-2 xl:justify-self-end">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-16" />
            <Skeleton className="h-9 w-24" />
          </div>
        ) : null}
        {job && (
          <ReviewActions
            className="xl:justify-self-end"
            status={
              status
                ? {
                    text:
                      status.key === "saved"
                        ? ts("savedNoRevision")
                        : ts(status.key),
                    tone: status.tone,
                    // 저장 버전 번호는 검수자에게 필요 없어 글자로 두지 않고, 문의할 때 쓰도록 마우스를
                    // 올리면 보인다.
                    title:
                      status.key === "saved" && state.save.phase === "saved"
                        ? ts("savedRevision", {
                            revision: state.save.revision ?? 0,
                          })
                        : undefined,
                  }
                : null
            }
            actions={
              <>
                {jsonMenu ? <JsonMenu /> : null}
                {historyMenu ? <HistoryButton /> : null}
              </>
            }
            changeCount={changeCount}
            trayOpen={state.trayOpen}
            onOpenTray={() => dispatch({ type: "OPEN_TRAY" })}
            onSave={save}
            saveDisabled={!canSave}
            saving={saving}
            saveEmphasized={changeCount > 0 && !saveFirst}
            saveTitle={`${t("save")} (${saveShortcut})`}
            saveKeyShortcuts={SAVE_KEYSHORTCUTS}
            saveDescribedBy={conflicted ? conflictHintId : undefined}
            primary={
              rs.value === "done"
                ? {
                    label:
                      rs.updating === "reopen" ? t("completing") : t("reopen"),
                    disabled: rs.updating !== null,
                    onClick: () => void reopenReview(),
                    variant: "outline",
                    testId: "job-review-button-reopen",
                  }
                : {
                    label: primaryLabel,
                    disabled: saveFirst ? !canSaveAndComplete : !canComplete,
                    onClick: () =>
                      saveFirst ? onSaveAndComplete() : void onComplete(),
                    title: `${primaryLabel} (${completeShortcut})`,
                    keyShortcuts: COMPLETE_KEYSHORTCUTS,
                    testId: "job-review-button-complete",
                    buttonProps: {
                      "data-advance": advanceAfterComplete ? "true" : "false",
                      "data-save-first": saveFirst ? "true" : "false",
                    },
                  }
            }
            labels={actionLabels}
            testIds={ACTION_TEST_IDS}
          />
        )}
      </div>
      {/* 검수 상태 안내는 길 수 있어 버튼 줄에 두면 버튼이 다음 줄로 밀린다. 버튼 줄 아래 한 줄에 둔다. */}
      {job ? (
        <p
          aria-live="polite"
          className={cn(
            "-mt-2 text-xs empty:hidden xl:text-right",
            rs.notice === "failed"
              ? "text-destructive"
              : "text-muted-foreground",
          )}
          data-testid="job-review-review-status-notice"
        >
          {rs.notice ? tnotice(rs.notice) : null}
        </p>
      ) : null}
      {conflicted ? (
        <p
          id={conflictHintId}
          className="text-xs text-destructive"
          data-testid="job-review-save-conflict-hint"
        >
          {tsave("conflictHint")}
        </p>
      ) : null}
    </header>
  );
}

/**
 * 변경 이력 시트 열기. 항상 보이고, 이 Collection 이 이력을 지원하지 않거나 지원 여부를 모르면 막은 채
 * 이유를 툴팁으로 보인다(막힌 버튼은 포인터·포커스를 받지 않으므로 바깥 span 이 툴팁을 연다).
 * 저장 중에도 열 수 있다(보기 전용).
 */
function HistoryButton() {
  const t = useTranslations("review.header");
  const { state, dispatch } = useJobReview();
  const tooltipId = useId();
  const availability = historyAvailability(state.capabilities);
  const button = (
    <Button
      type="button"
      variant="outline"
      size="default"
      aria-haspopup="dialog"
      aria-expanded={state.history.open}
      disabled={!availability.ok}
      aria-describedby={availability.ok ? undefined : tooltipId}
      onClick={() => dispatch({ type: "OPEN_HISTORY" })}
      data-testid="job-review-history-button-open"
    >
      <HistoryIcon aria-hidden />
      {t("history")}
    </Button>
  );
  if (availability.ok) return button;
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="inline-flex"
            tabIndex={0}
            aria-describedby={tooltipId}
            data-testid="job-review-history-button-open-wrapper"
          >
            {button}
          </span>
        </TooltipTrigger>
        <TooltipContent
          id={tooltipId}
          data-testid="job-review-history-unavailable-tooltip"
        >
          {t(`historyUnavailable.${availability.reason}`)}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
