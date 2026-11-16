"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export interface OrganizerSelectionBarProps {
  count: number;
  /** 편집할 수 없는 보기면 모든 조작을 막는다(선택 해제만 남는다). */
  disabled: boolean;
  /** 고른 페이지가 여러 파일 그룹에 걸쳐 있다(옮기기·새 문서로를 막고 힌트를 보인다). */
  mixedGroups: boolean;
  /** 정확히 한 장이고 그 문서의 첫 페이지가 아니다. */
  canSplit: boolean;
  error: string | null;
  onMove: () => void;
  onExclude: () => void;
  onNewDocument: () => void;
  onSplit: () => void;
  onClear: () => void;
}

/**
 * 바 자리. 고른 것이 없을 때의 안내 글과 toolbar 가 같은 최소 높이(34px)를 차지해, 선택이 생기거나
 * 비어도 아래 격자가 밀리지 않는다. 안내 글은 입력란처럼 보이지 않게 테두리 없는 캡션으로 두고(두 줄까지),
 * toolbar 만 옅은 회색 바탕으로 띄운다.
 */
// 바(위아래 여백 4px + 28px 버튼)와 안내 줄이 같은 높이(36px)라 바뀌어도 격자가 움직이지 않는다.
const BAR_SLOT = "flex min-h-9 min-w-0 items-center text-xs";

/**
 * 페이지 정리 화면 격자 위에 붙는 일괄 바: 고른 장 수와 한 번에 하는 조작(다른 문서로 옮기기…, 제외,
 * 새 문서로 분리…, 여기서 나누기)과 오른쪽 끝의 선택 해제. 옮기기와 새 문서로 분리는 같은 대화 상자를
 * 연다(새 문서는 늘 고를 수 있어 대상 문서가 없어도 막히지 않는다). 고른 것이 없으면 같은 자리에 끌어
 * 옮기기와 여러 장 선택 방법을 짧게 알려 준다.
 */
export function OrganizerSelectionBar({
  count,
  disabled,
  mixedGroups,
  canSplit,
  error,
  onMove,
  onExclude,
  onNewDocument,
  onSplit,
  onClear,
}: OrganizerSelectionBarProps) {
  const t = useTranslations("review.organizer.selection");
  const button = (
    label: string,
    testId: string,
    onClick: () => void,
    enabled: boolean,
  ) => (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={!enabled}
      onClick={onClick}
      // 바가 옅은 회색이라 hover 는 흰 바탕으로 띄운다.
      className="cursor-pointer hover:bg-background"
      data-testid={`job-review-organizer-selection-button-${testId}`}
    >
      {label}
    </Button>
  );

  if (count === 0) {
    return (
      <div className="flex min-w-0 shrink-0 flex-col gap-1">
        <p
          className={`${BAR_SLOT} text-muted-foreground`}
          data-testid="job-review-organizer-selection-empty"
        >
          <span className="line-clamp-2 min-w-0">{t("hint")}</span>
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 shrink-0 flex-col gap-1">
      <div
        role="toolbar"
        aria-label={t("label")}
        className={`${BAR_SLOT} flex-wrap gap-1 rounded-md bg-muted px-2 py-1`}
        data-testid="job-review-organizer-selection"
      >
        <span
          aria-live="polite"
          className="mr-1 font-medium tabular-nums"
          data-testid="job-review-organizer-selection-count"
        >
          {t("count", { count })}
        </span>
        {button(t("move"), "move", onMove, !disabled && !mixedGroups)}
        {button(t("exclude"), "exclude", onExclude, !disabled)}
        {button(
          t("newDocument"),
          "new-document",
          onNewDocument,
          !disabled && !mixedGroups,
        )}
        {button(t("split"), "split", onSplit, !disabled && canSplit)}
        {mixedGroups ? (
          <span
            className="ml-1 text-muted-foreground"
            data-testid="job-review-organizer-selection-mixed"
          >
            {t("mixedGroups")}
          </span>
        ) : null}
        <span className="ml-auto">
          {button(t("clear"), "clear", onClear, true)}
        </span>
      </div>
      {error ? (
        <p
          role="alert"
          className="text-xs text-destructive"
          data-testid="job-review-organizer-selection-error"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
