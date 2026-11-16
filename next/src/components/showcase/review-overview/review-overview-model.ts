// Collection 목록 "검수" 열과 상세 진행 현황의 계산(순수). 화면 부품은 `review-overview.tsx`·`review-progress.tsx`.
import type {
  ReviewProgress,
  SearchCollectionSummary,
} from "@/lib/review-api/types";

/**
 * 검수할 수 있는 Job 수 ≈ 전체 − 진행 중 − 실패(취소 Job 이 섞이면 조금 크다). 목록 "검수" 열과 상세 진행 현황의
 * 분모. 모르면 `null`.
 */
export function reviewableJobs(row: SearchCollectionSummary): number | null {
  if (typeof row.total_job_count !== "number") return null;
  return Math.max(
    0,
    row.total_job_count -
      (row.pending_job_count ?? 0) -
      (row.failed_job_count ?? 0),
  );
}

/**
 * "검수" 열 정렬 값: 검수 완료 비율(0~1). 기록이 없으면 0. 분모(검수할 수 있는 Job 수)를 모르거나 0 이면
 * 비율을 낼 수 없어 `null`(정렬에서 뒤로), 아직 세는 중이어도 `null`.
 */
export function reviewSortValue(
  row: SearchCollectionSummary,
  counts: Record<string, ReviewProgress> | null,
): number | null {
  if (!counts) return null;
  const done = counts[row.id]?.done ?? 0;
  const total = reviewableJobs(row);
  return total !== null && total > 0 ? Math.min(1, done / total) : null;
}
