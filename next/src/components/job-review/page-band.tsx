"use client";

import { useJobReview } from "./job-review-context";
import { PAGE_TABS_MAX } from "./large-job";
import { PagePositionBand } from "./page-position-band";
import { StructureBand } from "./structure-band";

/**
 * 뷰어 위 띠: 구성 모드는 필름스트립, 값 모드는 긴 문서(`PAGE_TABS_MAX` 쪽 초과)일 때만 위치 바(고친
 * 페이지와 검증 문제가 있는 페이지 표시). 짧은 문서는 뷰어 아래 막대의 쪽 번호 이동으로 충분해 띠를
 * 그리지 않는다(예전 페이지 번호 탭은 그 이동과 같은 일이라 뺐다).
 */
export function PageBand() {
  const { state, docPages } = useJobReview();
  if (state.mode === "structure") return <StructureBand />;
  return docPages.length > PAGE_TABS_MAX ? <PagePositionBand /> : null;
}
