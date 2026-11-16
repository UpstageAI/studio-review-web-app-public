// 홈 대시보드용 검수 기록 BFF(`GET /api/review-activity`) 의 응답 모양과 브라우저 호출.

import { requestJson, type RequestOptions } from "./client";
import type { ReviewProgress, ReviewStatusValue } from "./types";

/** 앱 DB 의 검수 기록 한 행. 기록이 있으면 검수 중이거나 검수 완료다(검수 전은 행이 없다). */
export interface ReviewActivityRow {
  collection_id: string;
  job_id: string;
  review_status: Exclude<ReviewStatusValue, "pending">;
  /** 처음 검수를 시작한 시각(ISO 8601). */
  started_at: string;
  /** 검수 완료 시각(ISO 8601). 완료가 아니면 `null` */
  completed_at: string | null;
  /** 상태가 마지막으로 바뀐 시각(ISO 8601). */
  updated_at: string;
}

/** `GET /api/review-activity` 응답. */
export interface ReviewActivityResponse {
  /** 상태가 최근에 바뀐 순서(`updated_at` 내림차순)로 `limit` 행. */
  data: ReviewActivityRow[];
  /** `jobs` 로 물은 Job 중 기록이 있는 것. 없는 Job 은 검수 전이다. */
  jobs: ReviewActivityRow[];
  /** 앱 DB 전체 요약(`GET /api/review-progress` 의 `overview` 와 같다). */
  overview: ReviewProgress & { collections_in_progress: number };
}

/** 한 번에 받을 수 있는 최근 행 수 범위와 기본값. */
export const REVIEW_ACTIVITY_LIMIT_MIN = 1;
export const REVIEW_ACTIVITY_LIMIT_MAX = 20;
export const REVIEW_ACTIVITY_LIMIT_DEFAULT = 8;

/** 한 번에 물을 수 있는 Job 수(이 브라우저가 기억하는 최근 Job 수와 같다). */
export const REVIEW_ACTIVITY_JOBS_MAX = 10;

/**
 * 최근 검수 기록과 앱 전체 요약. `jobs` 는 `collectionId:jobId` 목록으로, 최근 행에 없더라도 그 Job 들의
 * 상태를 함께 받는다.
 */
export function getReviewActivity(
  query: { limit?: number; jobs?: readonly string[] } = {},
  opts: RequestOptions = {},
): Promise<ReviewActivityResponse> {
  return requestJson("/api/review-activity", {
    ...opts,
    query: {
      limit: query.limit,
      jobs: query.jobs && query.jobs.length > 0 ? query.jobs.join(",") : null,
    },
  });
}
