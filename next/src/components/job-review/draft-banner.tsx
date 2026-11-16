"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { draftCompatibility } from "./draft-store";
import { useJobReview } from "./job-review-context";
import { useDropReasonText } from "./use-drop-reason-text";

/**
 * 브라우저에 임시 저장된(저장하지 않은) 변경의 안내 띠. 불러온 문서가 그 변경이 기대는 version 과
 * 같으면 "복원·버리기", 서버 내용이 바뀌었으면 "버리기" 만, 복원이 실패했으면 그 사유와 "버리기",
 * 임시 저장을 쓰지 못하면(상한 초과·저장소 가득 참) 그 사유의 안내만 보인다. 보일 것이 없으면 그리지 않는다.
 * 배너가 떠 있는 채 편집이 성공하면 reducer 가 지난 임시 저장을 버리므로(배너가 사라짐) 그 사실을
 * 미리 한 줄로 알린다.
 */
export function DraftBanner() {
  const t = useTranslations("review.draft");
  const locale = useLocale();
  const { state, dispatch, saving } = useJobReview();
  const reasonText = useDropReasonText();
  const { draft, session, jobId } = state;
  const base = session?.base ?? null;
  const stored = draft.status === "found" ? draft.stored : null;
  const restoreError =
    draft.status === "found" ? (draft.restoreError ?? null) : null;
  // 판정은 지금 불러온 문서(base) 기준이다 — 배너가 떠 있는 동안 저장·다시 불러오기로 base 가
  // 바뀌면 복원 가능 여부도 함께 바뀐다.
  const compatibility = useMemo(
    () => (stored && base ? draftCompatibility(stored, base, jobId) : null),
    [stored, base, jobId],
  );

  let text: string;
  let restorable = false;
  if (draft.status === "write_failed") {
    text = draft.reason === "too_large" ? t("tooLarge") : t("storageFull");
  } else if (stored && compatibility) {
    if (!compatibility.ok) {
      text = t("incompatible");
    } else if (restoreError) {
      text = t("restoreFailed", {
        index: restoreError.index + 1,
        detail: reasonText(restoreError.reason),
      });
    } else {
      text = t("found", {
        count: stored.drafts.length,
        savedAt: formatDateTime(stored.savedAt, locale) ?? stored.savedAt,
      });
      restorable = true;
    }
  } else {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm"
      data-testid="job-review-draft-banner"
    >
      <div className="min-w-0 flex-1">
        <p>{text}</p>
        {stored ? (
          <p
            className="text-muted-foreground"
            data-testid="job-review-draft-hint"
          >
            {t("foundHint")}
          </p>
        ) : null}
      </div>
      {stored ? (
        <div className="flex shrink-0 gap-2">
          {restorable ? (
            <Button
              type="button"
              size="default"
              disabled={saving}
              onClick={() =>
                dispatch({
                  type: "APPLY_MANY",
                  drafts: stored.drafts,
                  source: "draft",
                })
              }
              data-testid="job-review-draft-button-restore"
            >
              {t("restore")}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="default"
            onClick={() => dispatch({ type: "DRAFT_DISMISSED" })}
            data-testid="job-review-draft-button-discard"
          >
            {t("discard")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
