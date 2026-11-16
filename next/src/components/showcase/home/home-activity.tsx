"use client";

import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import { recentJobKey } from "@/lib/recent-jobs";
import {
  hasReviewActivity,
  mergeRecentActivity,
  pickContinueJob,
  type ActivityInput,
} from "./dashboard-model";
import { HomeDashboard, RECENT_ROWS } from "./home-dashboard";
import { useRecentJobs } from "./recent-jobs-store";
import { useReviewActivity } from "./use-review-activity";

const noopSubscribe = () => () => {};

/** 하이드레이션이 끝났는지. 서버 렌더와 하이드레이션 중에는 거짓이다. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

/**
 * 홈의 소개 카드 자리. 검수 기록이 없으면 소개 카드(`steps`)를 그대로 보이고, 있으면(앱 DB 에 기록이
 * 있거나 이 브라우저에서 연 Job 이 있으면) 대시보드와 작게 줄인 소개(`compactSteps`)를 보여 한 화면에
 * 들어가게 한다. 이 브라우저에서 연 Job 이 있으면 기록을 받기 전부터 대시보드 자리를 잡고, 없으면 받은 뒤
 * 기록이 있을 때만 보인다.
 */
export function HomeActivity({
  steps,
  compactSteps,
}: {
  steps: ReactNode;
  compactSteps: ReactNode;
}) {
  const hydrated = useHydrated();
  const recentJobs = useRecentJobs();
  const jobKeys = useMemo(
    () => recentJobs.map(job => recentJobKey(job.collectionId, job.jobId)),
    [recentJobs],
  );
  const settled = useReviewActivity(jobKeys, hydrated);
  const data = settled?.data ?? null;
  const activity: ActivityInput | null = useMemo(
    () =>
      data && settled
        ? { data: data.data, jobs: data.jobs, asked: settled.asked }
        : null,
    [data, settled],
  );

  if (!hasReviewActivity(data?.overview ?? null, recentJobs)) return steps;

  const loading = settled === null;
  const failed = settled !== null && data === null;
  return (
    // 홈 `<main>` 이 이 표시를 보고 위아래 여백을 줄인다.
    <div data-home-dashboard className="flex flex-col gap-6">
      <HomeDashboard
        overview={loading ? undefined : (data?.overview ?? null)}
        continueJob={
          loading ? undefined : pickContinueJob(activity, recentJobs)
        }
        recent={
          loading
            ? undefined
            : mergeRecentActivity(activity, recentJobs, RECENT_ROWS)
        }
        failed={failed}
        now={settled?.at ?? 0}
      />
      {compactSteps}
    </div>
  );
}
