import {
  REVIEW_ACTIVITY_JOBS_MAX,
  REVIEW_ACTIVITY_LIMIT_DEFAULT,
  REVIEW_ACTIVITY_LIMIT_MAX,
  REVIEW_ACTIVITY_LIMIT_MIN,
} from "@/lib/review-api/activity";
import { RESOURCE_ID_PATTERN } from "@/lib/upstage/review";

export type ReviewActivityQuery = {
  limit: number;
  jobs: { collectionId: string; jobId: string }[];
};

export type ReviewActivityQueryResult =
  | { ok: true; query: ReviewActivityQuery }
  | { ok: false; param: "limit" | "jobs"; message: string };

/**
 * `GET /api/review-activity` 쿼리를 읽는다.
 * - `limit`: 정수 1 ~ 20, 없으면 8.
 * - `jobs`: `collectionId:jobId` 를 쉼표로 이은 목록(최대 10 개, 같은 것은 한 번만). 없으면 빈 목록.
 */
export function parseReviewActivityQuery(
  params: URLSearchParams,
): ReviewActivityQueryResult {
  const rawLimit = params.get("limit");
  let limit = REVIEW_ACTIVITY_LIMIT_DEFAULT;
  if (rawLimit !== null) {
    const value = /^\d{1,3}$/.test(rawLimit) ? Number(rawLimit) : NaN;
    if (
      !Number.isInteger(value) ||
      value < REVIEW_ACTIVITY_LIMIT_MIN ||
      value > REVIEW_ACTIVITY_LIMIT_MAX
    ) {
      return {
        ok: false,
        param: "limit",
        message: `limit must be an integer from ${REVIEW_ACTIVITY_LIMIT_MIN} to ${REVIEW_ACTIVITY_LIMIT_MAX}`,
      };
    }
    limit = value;
  }

  const rawJobs = params.get("jobs") ?? "";
  const keys = [...new Set(rawJobs.split(",").filter(key => key !== ""))];
  if (keys.length > REVIEW_ACTIVITY_JOBS_MAX) {
    return {
      ok: false,
      param: "jobs",
      message: `jobs accepts at most ${REVIEW_ACTIVITY_JOBS_MAX} entries`,
    };
  }
  const jobs: ReviewActivityQuery["jobs"] = [];
  for (const key of keys) {
    const parts = key.split(":");
    const [collectionId = "", jobId = ""] = parts;
    if (
      parts.length !== 2 ||
      !RESOURCE_ID_PATTERN.test(collectionId) ||
      !RESOURCE_ID_PATTERN.test(jobId)
    ) {
      return {
        ok: false,
        param: "jobs",
        message: "jobs must be collectionId:jobId pairs",
      };
    }
    jobs.push({ collectionId, jobId });
  }
  return { ok: true, query: { limit, jobs } };
}
