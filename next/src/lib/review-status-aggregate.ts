import "server-only";

import type { JobReviewState } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import type { ReviewActivityRow } from "@/lib/review-api/activity";

// 검수 상태 DB 행을 모아 세거나 홈 대시보드용으로 읽는다(진행 현황·검수 기록).
// 상태 읽기·바꾸기는 `@/lib/review-status` 에 있다. Route Handler 에서만 import 한다.

/** Collection 의 상태별 Job 수. 검수 전(기록 없음)은 세지 않는다. */
export async function countReviewProgress(
  collectionId: string,
): Promise<{ done: number; in_progress: number }> {
  const groups = await prisma.jobReviewStatus.groupBy({
    by: ["state"],
    where: { collectionId },
    _count: { _all: true },
  });
  const counts = { done: 0, in_progress: 0 };
  for (const group of groups) {
    const count = group._count._all;
    if (group.state === "DONE") counts.done += count;
    else counts.in_progress += count;
  }
  return counts;
}

/**
 * 여러 Collection 의 검수 상태별 Job 수를 한 번에 센다. 행이 없는 Collection 은 결과에 넣지 않는다
 * (화면은 없으면 0 으로 본다).
 */
export async function countReviewProgressMany(
  collectionIds: readonly string[],
): Promise<Record<string, { done: number; in_progress: number }>> {
  if (collectionIds.length === 0) return {};
  const groups = await prisma.jobReviewStatus.groupBy({
    by: ["collectionId", "state"],
    where: { collectionId: { in: [...collectionIds] } },
    _count: { _all: true },
  });
  const out: Record<string, { done: number; in_progress: number }> = {};
  for (const group of groups) {
    const counts = (out[group.collectionId] ??= { done: 0, in_progress: 0 });
    if (group.state === "DONE") counts.done += group._count._all;
    else counts.in_progress += group._count._all;
  }
  return out;
}

/**
 * 이 앱 DB 전체의 검수 현황: 검수 완료, 검수 중 Job 수와, 검수 중 Job 이 하나라도 있는 Collection 수.
 * 로그인이 없어 이 서버를 쓰는 모든 사람의 기록을 함께 센다.
 */
export async function countReviewOverview(): Promise<{
  done: number;
  in_progress: number;
  collections_in_progress: number;
}> {
  const groups = await prisma.jobReviewStatus.groupBy({
    by: ["collectionId", "state"],
    _count: { _all: true },
  });
  const overview = { done: 0, in_progress: 0, collections_in_progress: 0 };
  const active = new Set<string>();
  for (const group of groups) {
    if (group.state === "DONE") {
      overview.done += group._count._all;
    } else {
      overview.in_progress += group._count._all;
      active.add(group.collectionId);
    }
  }
  overview.collections_in_progress = active.size;
  return overview;
}

/** 검수 기록 DB 행을 홈 대시보드 API 모양으로 바꾼다. */
export function toReviewActivityRow(row: {
  collectionId: string;
  jobId: string;
  state: JobReviewState;
  startedAt: Date;
  completedAt: Date | null;
  updatedAt: Date;
}): ReviewActivityRow {
  const done = row.state === "DONE";
  return {
    collection_id: row.collectionId,
    job_id: row.jobId,
    review_status: done ? "done" : "in_progress",
    started_at: row.startedAt.toISOString(),
    completed_at:
      done && row.completedAt ? row.completedAt.toISOString() : null,
    updated_at: row.updatedAt.toISOString(),
  };
}

const ACTIVITY_SELECT = {
  collectionId: true,
  jobId: true,
  state: true,
  startedAt: true,
  completedAt: true,
  updatedAt: true,
} as const;

/**
 * 홈 대시보드용 검수 기록. `recent` 는 상태가 최근에 바뀐 순서로 `limit` 행이고, `jobs` 는 물은
 * (Collection, Job) 중 기록이 있는 행이다(이 브라우저가 최근에 연 Job 이 `recent` 밖에 있어도 상태를
 * 알 수 있게). 로그인이 없어 이 서버를 쓰는 모든 사람의 기록이다.
 */
export async function readReviewActivity(
  limit: number,
  jobs: readonly { collectionId: string; jobId: string }[],
): Promise<{ recent: ReviewActivityRow[]; jobs: ReviewActivityRow[] }> {
  const [recentRows, jobRows] = await Promise.all([
    prisma.jobReviewStatus.findMany({
      orderBy: [
        { updatedAt: "desc" },
        { collectionId: "asc" },
        { jobId: "asc" },
      ],
      take: limit,
      select: ACTIVITY_SELECT,
    }),
    jobs.length === 0
      ? Promise.resolve([])
      : prisma.jobReviewStatus.findMany({
          where: {
            OR: jobs.map(job => ({
              collectionId: job.collectionId,
              jobId: job.jobId,
            })),
          },
          select: ACTIVITY_SELECT,
        }),
  ]);
  return {
    recent: recentRows.map(toReviewActivityRow),
    jobs: jobRows.map(toReviewActivityRow),
  };
}
