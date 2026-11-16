"use client";

import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import { HeaderSlot } from "@/components/showcase/header-slot";
import { useRecordRecentJob } from "@/components/showcase/home/recent-jobs-store";
import {
  announceCompletion,
  getCompletionNotice,
  getServerCompletionNotice,
  subscribeCompletionNotice,
} from "@/components/showcase/review-queue/completion-notice";
import type { UseJobReviewHeaderExtension } from "@/components/job-review/header-extension";
import { ReviewQueueBar } from "@/components/showcase/review-queue/review-queue-bar";
import { usePrefetchNextJob } from "@/components/showcase/review-queue/use-prefetch-next-job";
import { useReviewQueue } from "@/components/showcase/review-queue/use-review-queue";

/**
 * 이 앱의 검수 화면 머리 확장. 불러온 Job 을 홈 대시보드의 "최근 검수" 로 기록하고, 검수 큐(이전·다음
 * Job, 다음 Job 미리 받기)와 완료 안내를 공통 상단 바의 화면 자리에 그린다. 큐 안에서 "완료하면 다음
 * Job 열기" 가 켜져 있으면 주 동작이 "…하고 다음" 이 되고 완료 뒤 다음 Job 으로 옮긴다.
 */
export const useQueueHeaderExtension: UseJobReviewHeaderExtension = ({
  collectionId,
  collectionName,
  jobId,
  firstFileName,
  ready,
  dirty,
  leaveMessage,
}) => {
  const t = useTranslations("review.header");
  // 불러온 Job 을 홈 대시보드의 "최근 검수" 이름으로 쓰도록 이 브라우저에 기록한다.
  useRecordRecentJob(
    ready
      ? { collectionId, collectionName, jobId, jobName: firstFileName }
      : null,
  );
  const queue = useReviewQueue(collectionId, jobId, { dirty, leaveMessage });
  usePrefetchNextJob(
    collectionId,
    queue.inQueue ? (queue.next?.job_id ?? null) : null,
  );
  const completion = useSyncExternalStore(
    subscribeCompletionNotice,
    getCompletionNotice,
    getServerCompletionNotice,
  );
  // 다음 Job 이 받아 둔 큐에 없어도 이어 받을 페이지가 있으면 완료 뒤 이어서 연다.
  const advancesAfterComplete =
    queue.inQueue && queue.advance && (queue.next !== null || queue.more);

  const onCompleted = async (jobName: string) => {
    announceCompletion(jobName);
    if (advancesAfterComplete) await queue.goNext();
  };

  const extras = (
    // 검수 큐(이전, 다음 Job)와 완료 안내는 공통 상단 바의 화면 자리에 그린다.
    <HeaderSlot>
      <span
        role="status"
        // 비어 있어도 화면 낭독기가 알림을 놓치지 않게 숨기지 않고 화면에서만 뺀다.
        className="truncate text-sm text-muted-dark empty:sr-only"
        data-testid="job-review-completion-notice"
      >
        {completion ? t("completedNotice", { name: completion.name }) : null}
      </span>
      {queue.inQueue ? <ReviewQueueBar controls={queue} /> : null}
    </HeaderSlot>
  );

  return { extras, advancesAfterComplete, onCompleted };
};
