"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import {
  DocumentPositionDialog as CoreDocumentPositionDialog,
  type DocumentPositionDialogLabels,
} from "@/components/studio-ui-kit/structure-editor";

export interface DocumentPositionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 옮길 문서의 지금 위치(0-based). */
  index: number;
  /** 옮길 수 있는 첫 위치(1-based). 같은 파일 그룹이 이어진 구간의 처음. */
  min: number;
  /** 옮길 수 있는 끝 위치(1-based). 같은 파일 그룹이 이어진 구간의 끝. */
  max: number;
  /** 새 위치(1-based, `min‥max`). 지금 위치와 같으면 부르지 않는다. */
  onMove: (position: number) => void;
  /**
   * 닫힌 뒤 포커스를 돌려줄 요소(대화 상자를 연 메뉴 버튼). 메뉴 항목에서 열면 메뉴가 먼저 닫혀
   * 기본 복귀 대상이 사라지므로 host 가 찾아 준다. `null` 이면 기본 동작.
   */
  returnFocus?: () => HTMLElement | null;
}

/** 문서의 새 위치 번호를 물어 순서를 바꾸는 대화 상자(필름스트립 띠 메뉴 "위치 지정…"). */
export function DocumentPositionDialog(props: DocumentPositionDialogProps) {
  const t = useTranslations("review.structure.documentPosition");
  const labels = useMemo<DocumentPositionDialogLabels>(
    () => ({
      title: t("title"),
      description: (index, first, last) =>
        t("description", { index, first, last }),
      position: t("position"),
      invalid: (first, last) => t("invalid", { first, last }),
      cancel: t("cancel"),
      move: t("move"),
    }),
    [t],
  );
  return (
    <CoreDocumentPositionDialog
      {...props}
      labels={labels}
      testId="job-review-document-position-dialog"
    />
  );
}
