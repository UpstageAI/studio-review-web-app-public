"use client";

import { useEffect, useState } from "react";
import { getReviewProgressOverview } from "@/lib/review-api/client";
import type { ReviewProgressOverview } from "@/lib/review-api/types";

type OverviewState = {
  key: string;
  data: ReviewProgressOverview | null;
  failed: boolean;
};

/**
 * Collection 목록 한 페이지의 검수 현황(앱 DB)과 앱 전체 요약. 페이지(보이는 Collection id 묶음)가
 * 바뀌면 다시 센다. 앱 전체 요약은 다음 페이지를 세는 동안에도 지난 값을 보여 깜빡이지 않게 한다.
 * 페이지에 Collection 이 없어도(빈 목록, 목록을 받는 중) 앱 전체 요약은 받아야 하므로 빈 id 묶음으로도
 * 요청한다.
 */
export function useReviewOverview(ids: readonly string[]) {
  const key = ids.join(",");
  const [state, setState] = useState<OverviewState | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getReviewProgressOverview(key === "" ? [] : key.split(","), {
      signal: controller.signal,
    }).then(
      data => {
        if (!controller.signal.aborted) setState({ key, data, failed: false });
      },
      () => {
        if (!controller.signal.aborted) {
          setState({ key, data: null, failed: true });
        }
      },
    );
    return () => controller.abort();
  }, [key]);

  const current = state?.key === key ? state : null;
  return {
    /** 이 페이지의 Collection 별 수를 세는 중. */
    loading: current === null,
    failed: current?.failed ?? false,
    /** Collection id → 수. 기록이 없는 Collection 은 없다. 세는 중이면 `null`. */
    collections: current?.data?.collections ?? null,
    /** 앱 전체 요약(지난 페이지에서 센 값일 수 있다). */
    overview: state?.data?.overview ?? null,
  };
}
