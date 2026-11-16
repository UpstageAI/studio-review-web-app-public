import { useEffect } from "react";
import { createStoredValue } from "@/lib/browser-storage";
import {
  parseRecentJobs,
  RECENT_JOBS_KEY,
  serializeRecentJobs,
  withRecentJob,
  type RecentJob,
} from "@/lib/recent-jobs";

// 이 브라우저에서 최근에 연 검수 Job(`localStorage` `review-recent-jobs`). 같은 탭의 구독자에게는 직접
// 알리고, 다른 탭에서 바뀐 값은 `storage` 이벤트로 받는다.

const EMPTY: readonly RecentJob[] = [];

const stored = createStoredValue<readonly RecentJob[]>({
  key: RECENT_JOBS_KEY,
  area: "local",
  parse: raw => (raw ? parseRecentJobs(raw) : EMPTY),
  serialize: serializeRecentJobs,
  notify: "tab+storage",
});

/** 최근 연 Job(최근 것이 앞). 서버 렌더와 하이드레이션 중에는 빈 목록이다. */
export function useRecentJobs(): readonly RecentJob[] {
  return stored.useValue();
}

type RecentJobInput = Omit<RecentJob, "openedAt">;

/** 방금 연 Job 을 목록 맨 앞에 기록한다. 저장소가 막혀 있으면 조용히 건너뛴다. */
function recordRecentJob(entry: RecentJobInput): void {
  const next = withRecentJob(stored.read(), {
    ...entry,
    openedAt: new Date().toISOString(),
  });
  stored.write(next);
}

/**
 * 검수 화면이 Job 을 불러온 뒤(`entry` 가 생긴 뒤) 그 Job 을 최근 연 Job 으로 기록한다. 이름이 나중에
 * 알려지면 다시 기록해 이름을 채운다.
 */
export function useRecordRecentJob(entry: RecentJobInput | null): void {
  const collectionId = entry?.collectionId ?? null;
  const jobId = entry?.jobId ?? null;
  const collectionName = entry?.collectionName ?? null;
  const jobName = entry?.jobName ?? null;
  useEffect(() => {
    if (collectionId === null || jobId === null) return;
    recordRecentJob({ collectionId, collectionName, jobId, jobName });
  }, [collectionId, collectionName, jobId, jobName]);
}
