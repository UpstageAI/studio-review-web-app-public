"use client";

import { JobReviewScreen } from "@/components/job-review/job-review-screen";
import { useQueueHeaderExtension } from "./use-queue-header-extension";

/**
 * 검수 화면에 이 앱의 머리 확장(검수 큐, 최근 기록, 완료 안내)을 꽂는다. 페이지는 서버 컴포넌트라
 * hook 함수를 prop 으로 넘길 수 없어 이 클라이언트 래퍼가 넘긴다.
 */
export function JobReviewWithQueue({
  collectionId,
  jobId,
}: {
  collectionId: string;
  jobId: string;
}) {
  return (
    <JobReviewScreen
      collectionId={collectionId}
      jobId={jobId}
      useHeaderExtension={useQueueHeaderExtension}
    />
  );
}
