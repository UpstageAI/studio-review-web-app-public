"use client";

import { useMemo } from "react";
import type { LocatedDocument } from "@/lib/review-model";
import { useJobReview } from "./job-review-context";

/**
 * 지금 화면에 보이는 문서 목록. 구성 탭은 그 문서 배치 보기의 문서만(보기가 여럿인 Job), 그 밖의
 * 탭은 모든 보기의 문서. 문서 목록과 키보드 문서 이동이 같은 목록을 쓴다.
 */
export function useVisibleDocuments(): readonly LocatedDocument[] {
  const { documents, activeStepTab } = useJobReview();
  const layoutStepId =
    activeStepTab?.kind === "structure" ? activeStepTab.stepId : undefined;
  return useMemo(
    () =>
      layoutStepId === undefined
        ? documents
        : documents.filter(item => item.stepId === layoutStepId),
    [documents, layoutStepId],
  );
}
