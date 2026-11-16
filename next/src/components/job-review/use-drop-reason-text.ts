"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";
import type { DropReason } from "@/lib/review-model";
import { isKnownDropReason } from "./structure-view";

/**
 * 구조 편집 실패 사유(`editError`, 일괄 편집 결과)를 문구로. 알려진 사유는 번역 키, 아니면 generic
 * 문구에 코드를 붙인다. 필름스트립 띠·정리 화면·구성 작업 패널과 임시 저장 복원·JSON 적용 실패
 * 안내가 같은 문구를 쓴다.
 */
export function useDropReasonText(): (reason: DropReason) => string {
  const ts = useTranslations("review.structure");
  return useCallback(
    (reason: DropReason) =>
      isKnownDropReason(reason)
        ? ts(`errors.${reason}`)
        : ts("errors.generic", { code: reason }),
    [ts],
  );
}
