import { useEffect, useState } from "react";
import { isAbortError } from "@/lib/review-api/client";
import {
  getReviewActivity,
  type ReviewActivityResponse,
} from "@/lib/review-api/activity";

/** 받은 검수 기록. `data` 가 `null` 이면 받지 못했다. */
export type SettledActivity = {
  data: ReviewActivityResponse | null;
  /** 요청에 실어 상태를 물은 Job(`collectionId:jobId`). */
  asked: readonly string[];
  /** 결과를 받은 시각(epoch 밀리초). 상대 시각의 기준이다. */
  at: number;
};

/** 앱 DB 에서 받을 최근 행 수. 화면은 브라우저 기록과 합쳐 그중 일부만 보인다. */
const RECENT_FETCH_LIMIT = 8;

// 마지막으로 받은 결과. 다른 화면에 갔다가 홈으로 돌아오면 이 값을 먼저 보여 자리가 흔들리지 않게 하고
// 새로 받는다. 첫 화면(하이드레이션)에서는 비어 있어 서버 렌더와 같다.
let lastResult: SettledActivity | null = null;

/**
 * 홈 대시보드용 검수 기록과 앱 전체 요약. `jobKeys`(이 브라우저가 최근 연 Job)가 바뀌면 다시 받는다.
 * `enabled` 가 거짓인 동안(하이드레이션 중)은 받지 않는다. 받기 전에는 `null`.
 */
export function useReviewActivity(
  jobKeys: readonly string[],
  enabled: boolean,
): SettledActivity | null {
  const key = jobKeys.join(",");
  const [settled, setSettled] = useState<SettledActivity | null>(
    () => lastResult,
  );

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const asked = key === "" ? [] : key.split(",");
    getReviewActivity(
      { limit: RECENT_FETCH_LIMIT, jobs: asked },
      { signal: controller.signal },
    ).then(
      data => {
        if (controller.signal.aborted) return;
        const next = { data, asked, at: Date.now() };
        lastResult = next;
        setSettled(next);
      },
      (err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return;
        // 전에 받은 값이 있으면 그대로 두고, 없으면 받지 못했다고 남긴다.
        setSettled(prev =>
          prev?.data ? prev : { data: null, asked, at: Date.now() },
        );
      },
    );
    return () => controller.abort();
  }, [enabled, key]);

  return settled;
}
