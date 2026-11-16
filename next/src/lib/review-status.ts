import "server-only";

import type { JobReviewState } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import type {
  ReviewStatusAction,
  ReviewStatusRecord,
  ReviewStatusValue,
} from "@/lib/review-api/types";

// Job 검수 상태(검수 전·검수 중·검수 완료)를 앱 DB 에 둔다. 파이프라인에는 이 상태가 없다.
// (Collection, Job) 당 한 행이며 행이 없으면 "검수 전" 이다. 로그인이 없으므로 사용자 구분 없이 공유된다.
// Route Handler 에서만 import 한다.

export type { ReviewStatusAction, ReviewStatusRecord, ReviewStatusValue };

export const REVIEW_STATUS_ACTIONS: readonly ReviewStatusAction[] = [
  "start",
  "complete",
  "reopen",
];

/** DB 행(없으면 `null`)을 API 모양으로 바꾼다. */
export function toReviewStatusRecord(
  jobId: string,
  row: { state: JobReviewState; completedAt: Date | null } | null,
): ReviewStatusRecord {
  if (!row) {
    return {
      job_id: jobId,
      review_status: "pending",
      review_completed_at: null,
    };
  }
  return {
    job_id: jobId,
    review_status: row.state === "DONE" ? "done" : "in_progress",
    review_completed_at:
      row.state === "DONE" && row.completedAt
        ? row.completedAt.toISOString()
        : null,
  };
}

/** Job 들의 검수 상태. 기록이 없는 id 는 `pending` 으로 채워 돌려준다. */
export async function readReviewStatuses(
  collectionId: string,
  jobIds: readonly string[],
): Promise<Map<string, ReviewStatusRecord>> {
  const result = new Map<string, ReviewStatusRecord>();
  if (jobIds.length === 0) return result;
  const unique = [...new Set(jobIds)];
  const rows = await prisma.jobReviewStatus.findMany({
    where: { collectionId, jobId: { in: unique } },
    select: { jobId: true, state: true, completedAt: true },
  });
  const byId = new Map(rows.map(row => [row.jobId, row]));
  for (const jobId of unique) {
    result.set(jobId, toReviewStatusRecord(jobId, byId.get(jobId) ?? null));
  }
  return result;
}

/**
 * 검수 상태를 바꾼다.
 * - `start`: 기록이 없을 때만 검수 중으로 만든다(있으면 그대로 — 완료 Job 을 다시 열어도 유지).
 * - `complete`: 검수 완료, 완료 시각 = 지금.
 * - `reopen`: 검수 중, 완료 시각을 지운다.
 */
export async function applyReviewStatusAction(
  collectionId: string,
  jobId: string,
  action: ReviewStatusAction,
): Promise<ReviewStatusRecord> {
  const where = { collectionId_jobId: { collectionId, jobId } };
  const select = { state: true, completedAt: true } as const;
  let row: { state: JobReviewState; completedAt: Date | null };
  if (action === "start") {
    row = await prisma.jobReviewStatus.upsert({
      where,
      create: { collectionId, jobId, state: "IN_PROGRESS" },
      update: {},
      select,
    });
  } else if (action === "complete") {
    const completedAt = new Date();
    row = await prisma.jobReviewStatus.upsert({
      where,
      create: { collectionId, jobId, state: "DONE", completedAt },
      update: { state: "DONE", completedAt },
      select,
    });
  } else {
    row = await prisma.jobReviewStatus.upsert({
      where,
      create: { collectionId, jobId, state: "IN_PROGRESS" },
      update: { state: "IN_PROGRESS", completedAt: null },
      select,
    });
  }
  return toReviewStatusRecord(jobId, row);
}
