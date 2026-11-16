"use client";

import { useCallback, useEffect, useRef, type Dispatch } from "react";
import type { JobReviewAction, JobReviewState } from "./job-review-state";
import { createSaveController, type SaveController } from "./save-controller";

/**
 * 화면 상태에 저장 흐름(`createSaveController`)을 붙인다. Job 마다 새로 만들고, 화면을 떠나거나
 * Job 이 바뀌면 진행 중인 요청을 끊는다.
 */
export function useSave(
  state: JobReviewState,
  dispatch: Dispatch<JobReviewAction>,
): { save: () => void; reload: () => void } {
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const controllerRef = useRef<SaveController | null>(null);
  const { requestKey } = state;
  useEffect(() => {
    const controller = createSaveController({
      getState: () => stateRef.current,
      dispatch,
    });
    controllerRef.current = controller;
    return () => {
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [dispatch, requestKey]);

  const save = useCallback(() => controllerRef.current?.save(), []);
  const reload = useCallback(() => controllerRef.current?.reload(), []);
  return { save, reload };
}
