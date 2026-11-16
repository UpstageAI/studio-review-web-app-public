"use client";

import { useCallback, useEffect, useRef, type Dispatch } from "react";
import { isAbortError, setReviewStatus } from "@/lib/review-api/client";
import type { ReviewStatusAction } from "@/lib/review-api/types";
import type { JobReviewAction, JobReviewState } from "./job-review-state";

/**
 * Job 검수 상태(앱 DB)를 화면 상태에 잇는다. 불러오기에 성공하면 조용히 검수 중으로 두고(`start` —
 * 이미 완료면 그대로), 검수 완료 Job 의 저장이 반영되면 검수 중으로 되돌린다. Job 이 바뀌거나 화면을
 * 떠나면 진행 중인 요청을 끊는다.
 */
export function useReviewStatus(
  state: JobReviewState,
  dispatch: Dispatch<JobReviewAction>,
): {
  completeReview: () => Promise<boolean>;
  reopenReview: () => Promise<boolean>;
} {
  const { requestKey, collectionId, jobId, status, reviewStatus } = state;
  const updatingRef = useRef(reviewStatus.updating);
  useEffect(() => {
    updatingRef.current = reviewStatus.updating;
  }, [reviewStatus.updating]);

  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    return () => {
      controller.abort();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [requestKey]);

  const send = useCallback(
    async (action: ReviewStatusAction): Promise<boolean> => {
      const controller = controllerRef.current;
      if (!controller || controller.signal.aborted) return false;
      const { signal } = controller;
      updatingRef.current = action;
      dispatch({ type: "REVIEW_STATUS_UPDATING", requestKey, action });
      try {
        const record = await setReviewStatus(collectionId, jobId, action, {
          signal,
        });
        if (signal.aborted) return false;
        dispatch({
          type: "REVIEW_STATUS_UPDATED",
          requestKey,
          action,
          status: record,
        });
        return true;
      } catch (err) {
        if (signal.aborted || isAbortError(err)) return false;
        dispatch({ type: "REVIEW_STATUS_FAILED", requestKey, action });
        return false;
      }
    },
    [collectionId, jobId, requestKey, dispatch],
  );

  // 불러오기 성공 → 검수 중. 실패하면 `startFailed` 로 남아 다시 보내지 않는다.
  const needsStart =
    status === "ready" &&
    reviewStatus.value === "unknown" &&
    reviewStatus.updating === null &&
    !reviewStatus.startFailed;
  useEffect(() => {
    if (needsStart) void send("start");
  }, [needsStart, send]);

  // 검수 완료 Job 의 저장이 반영됐다 → 검수 중으로. 성공·실패 모두 요청 표시를 내려 한 번만 보낸다.
  const needsRevert =
    reviewStatus.revertRequested && reviewStatus.updating === null;
  useEffect(() => {
    if (needsRevert) void send("reopen");
  }, [needsRevert, send]);

  const completeReview = useCallback(
    () =>
      updatingRef.current === null ? send("complete") : Promise.resolve(false),
    [send],
  );
  const reopenReview = useCallback(
    () =>
      updatingRef.current === null ? send("reopen") : Promise.resolve(false),
    [send],
  );
  return { completeReview, reopenReview };
}
