"use client";

import { useMemo } from "react";
import {
  pairHighlights,
  resultsForDocument,
  type ExtractItem,
  type LocatedDocument,
  type PageRef,
  type PageSpace,
  type PairedHighlight,
  type ReviewJob,
} from "@/lib/review-model";

/**
 * 선택 문서에 연결된 Extract 결과의 추출값 하이라이트. 좌표는 Job 응답 항목(짝)에서,
 * 값은 현재 편집 상태에서 가져온다. 페이지는 현재 문서의 뷰어 위치로 옮긴다.
 */
export function useExtractHighlights({
  job,
  selected,
  docPages,
  pairing,
  space,
}: {
  job: ReviewJob | null;
  selected: LocatedDocument | null;
  docPages: readonly PageRef[];
  pairing: ReadonlyMap<string, ExtractItem>;
  space: PageSpace | null;
}): PairedHighlight[] {
  return useMemo(() => {
    if (!job || !selected || pairing.size === 0) return [];
    return resultsForDocument(job, selected.document.document_id).flatMap(
      result => {
        const item = pairing.get(result.id);
        return item
          ? pairHighlights(job.id, result, item, space, docPages)
          : [];
      },
    );
  }, [job, selected, docPages, pairing, space]);
}
