// 홈 대시보드에 보일 값을 앱 DB 기록과 이 브라우저의 최근 연 Job 에서 만드는 순수 함수들.

import { toTimestamp } from "@/lib/format";
import { recentJobKey, type RecentJob } from "@/lib/recent-jobs";
import type {
  ReviewActivityResponse,
  ReviewActivityRow,
} from "@/lib/review-api/activity";
import type { ReviewStatusValue } from "@/lib/review-api/types";

/** 대시보드 한 줄(최근 검수 목록 행, 이어서 검수할 Job). */
export type DashboardJob = {
  key: string;
  collectionId: string;
  jobId: string;
  /** 이 브라우저에서 연 적이 없으면 `null`(화면은 ID 로 보인다). */
  collectionName: string | null;
  jobName: string | null;
  /** 상태를 모르면(기록을 받지 못했거나 아직 묻지 않은 Job) `undefined`. */
  status: ReviewStatusValue | undefined;
  completedAt: string | null;
  /** 마지막 활동 시각(epoch 밀리초): 상태가 바뀐 시각과 이 브라우저에서 연 시각 중 늦은 것. */
  at: number | null;
};

/** 대시보드에 넘기는 받은 기록. `asked` 는 요청에 실어 상태를 물은 Job 키. */
export type ActivityInput = Pick<ReviewActivityResponse, "data" | "jobs"> & {
  asked: readonly string[];
};

/** 홈에 대시보드를 보일지. 앱 DB 에 검수 기록이 있거나 이 브라우저에서 연 Job 이 있으면 보인다. */
export function hasReviewActivity(
  overview: ReviewActivityResponse["overview"] | null,
  recentJobs: readonly RecentJob[],
): boolean {
  if (recentJobs.length > 0) return true;
  return overview !== null && overview.done + overview.in_progress > 0;
}

function rowsByKey(
  activity: ActivityInput | null,
): Map<string, ReviewActivityRow> {
  const rows = new Map<string, ReviewActivityRow>();
  if (!activity) return rows;
  for (const row of [...activity.data, ...activity.jobs]) {
    const key = recentJobKey(row.collection_id, row.job_id);
    if (!rows.has(key)) rows.set(key, row);
  }
  return rows;
}

function latest(...values: (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length > 0 ? Math.max(...present) : null;
}

function toDashboardJob(
  key: string,
  row: ReviewActivityRow | undefined,
  local: RecentJob | undefined,
  asked: ReadonlySet<string>,
): DashboardJob {
  const collectionId = row?.collection_id ?? local?.collectionId ?? "";
  const jobId = row?.job_id ?? local?.jobId ?? "";
  // 기록이 없는 Job 은 검수 전이다. 다만 물어보지 않은 Job 이면 모른다.
  const status: ReviewStatusValue | undefined = row
    ? row.review_status
    : asked.has(key)
      ? "pending"
      : undefined;
  return {
    key,
    collectionId,
    jobId,
    collectionName: local?.collectionName ?? null,
    jobName: local?.jobName ?? null,
    status,
    completedAt: row?.completed_at ?? null,
    at: latest(
      toTimestamp(row?.updated_at ?? null),
      toTimestamp(local?.openedAt ?? null),
    ),
  };
}

/**
 * 최근 검수 목록: 앱 DB 의 최근 기록과 이 브라우저에서 연 Job 을 합쳐 마지막 활동이 늦은 순서로 `limit`
 * 줄. 이름은 브라우저 기록에서 가져오고, 상태는 DB 기록에서 가져온다(`activity` 가 `null` 이면 모름).
 */
export function mergeRecentActivity(
  activity: ActivityInput | null,
  recentJobs: readonly RecentJob[],
  limit: number,
): DashboardJob[] {
  const rows = rowsByKey(activity);
  const asked = new Set(activity?.asked ?? []);
  const local = new Map<string, RecentJob>();
  for (const job of recentJobs) {
    const key = recentJobKey(job.collectionId, job.jobId);
    if (!local.has(key)) local.set(key, job);
  }
  const keys = new Set<string>([
    ...(activity?.data ?? []).map(row =>
      recentJobKey(row.collection_id, row.job_id),
    ),
    ...local.keys(),
  ]);
  return [...keys]
    .map(key => toDashboardJob(key, rows.get(key), local.get(key), asked))
    .sort((a, b) => {
      if (a.at !== b.at) {
        if (a.at === null) return 1;
        if (b.at === null) return -1;
        return b.at - a.at;
      }
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    })
    .slice(0, Math.max(0, limit));
}

function openedJob(
  job: RecentJob,
  status: ReviewStatusValue | undefined,
): DashboardJob {
  return {
    key: recentJobKey(job.collectionId, job.jobId),
    collectionId: job.collectionId,
    jobId: job.jobId,
    collectionName: job.collectionName,
    jobName: job.jobName,
    status,
    completedAt: null,
    at: toTimestamp(job.openedAt),
  };
}

/**
 * 이어서 검수할 Job: 이 브라우저에서 가장 최근에 연 Job 중 아직 검수 중인 것(시각은 연 시각). 그런 Job 이
 * 없으면 `null`. 검수 기록을 받지 못했으면(`activity` 가 `null`) 상태를 모르므로 가장 최근에 연 Job 을
 * 상태 없이 돌려준다.
 */
export function pickContinueJob(
  activity: ActivityInput | null,
  recentJobs: readonly RecentJob[],
): DashboardJob | null {
  const newestFirst = [...recentJobs].sort(
    (a, b) => (toTimestamp(b.openedAt) ?? 0) - (toTimestamp(a.openedAt) ?? 0),
  );
  if (!activity) {
    const job = newestFirst[0];
    return job ? openedJob(job, undefined) : null;
  }
  const rows = rowsByKey(activity);
  const job = newestFirst.find(
    item =>
      rows.get(recentJobKey(item.collectionId, item.jobId))?.review_status ===
      "in_progress",
  );
  return job ? openedJob(job, "in_progress") : null;
}
