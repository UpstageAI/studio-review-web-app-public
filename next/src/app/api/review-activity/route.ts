import type { NextRequest } from "next/server";

import type { ReviewActivityResponse } from "@/lib/review-api/activity";
import {
  countReviewOverview,
  readReviewActivity,
} from "@/lib/review-status-aggregate";

import { reviewStatusUnavailable } from "@/app/api/_lib/review-status-rows";
import { invalidValue } from "@/app/api/_lib/upstream-relay";

import { parseReviewActivityQuery } from "./query";

/**
 * 홈 대시보드용 검수 기록(앱 DB 만 읽고 upstream 은 부르지 않는다).
 * `?limit=8` 행을 상태가 최근에 바뀐 순서로, `?jobs=collectionId:jobId,…` 로 물은 Job 의 기록과
 * 앱 전체 요약을 함께 돌려준다. Collection 이름과 파일명은 DB 에 없어 화면이 브라우저 기록과 합친다.
 */
export async function GET(request: NextRequest) {
  const parsed = parseReviewActivityQuery(request.nextUrl.searchParams);
  if (!parsed.ok) return invalidValue(parsed.message, parsed.param);

  try {
    const [activity, overview] = await Promise.all([
      readReviewActivity(parsed.query.limit, parsed.query.jobs),
      countReviewOverview(),
    ]);
    const body: ReviewActivityResponse = {
      data: activity.recent,
      jobs: activity.jobs,
      overview,
    };
    return Response.json(body, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    return reviewStatusUnavailable(err);
  }
}
