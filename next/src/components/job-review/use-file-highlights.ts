"use client";

import { useEffect, useRef, type Dispatch } from "react";
import {
  apiErrorInfo,
  getFileHighlights,
  isAbortError,
} from "@/lib/review-api/review-screen";
import type { PageRef } from "@/lib/review-model";
import { wantedHighlightChunks } from "./highlight-window";
import type { FileEntry, JobReviewAction } from "./job-review-state";

/**
 * Parse 탭이 열려 있을 때(`active`) 뷰어 현재 페이지 주변 묶음의 Parse 하이라이트를 받아
 * `FILE_HIGHLIGHTS_*` 로 알린다. 묶음마다 요청 전에 `LOADING` 을 동기로 기록하므로 deps 가 바뀌어
 * 다시 돌아도 같은 묶음을 두 번 요청하지 않는다(`wantedHighlightChunks` 는 상태가 없는 묶음만 고른다).
 * 창은 묶음 ≤ 2 개 × 문서의 파일 수라 동시 요청이 작고 큐는 없다. 자동 재시도도 없다 — 실패한 묶음은
 * `FILE_HIGHLIGHTS_RETRY`(화면의 "다시 시도")가 상태를 지우면 다음 실행에서 다시 고른다. 실패한 요청은
 * 응답을 받는 즉시 in-flight 에서 빠지므로 재시도가 같은 묶음을 두 번 보내지 않는다.
 * deps 가 바뀔 때 진행 중인 요청을 끊지 않는다 — 페이지를 넘길 때마다 받던 묶음을 버리면 다시
 * 받아야 하기 때문이다. 화면을 떠나거나 다른 Job 으로 바뀔 때(`requestKey`)만 모두 끊는다.
 */
export function useFileHighlights({
  active,
  docPages,
  selectedPageIndex,
  files,
  requestKey,
  dispatch,
}: {
  active: boolean;
  docPages: readonly PageRef[];
  selectedPageIndex: number;
  files: Readonly<Record<string, FileEntry>>;
  requestKey: string;
  dispatch: Dispatch<JobReviewAction>;
}): void {
  const inflight = useRef(new Map<string, AbortController>());

  useEffect(() => {
    if (!active) return;
    for (const want of wantedHighlightChunks(
      docPages,
      selectedPageIndex,
      files,
    )) {
      const { fileRef, fileId, chunk } = want;
      dispatch({ type: "FILE_HIGHLIGHTS_LOADING", fileRef, fileId, chunk });
      // 파일을 다시 받아 묶음 상태가 지워졌어도 같은 파일의 같은 묶음이 아직 오는 중이면 그 응답을 쓴다.
      const key = `${fileRef}\u0000${fileId}\u0000${chunk}`;
      if (inflight.current.has(key)) continue;
      const controller = new AbortController();
      // 끊긴 요청이 늦게 끝나도 같은 키의 새 요청을 지우지 않도록, 지울 때 자기 controller 인지 본다.
      inflight.current.set(key, controller);
      const { signal } = controller;
      getFileHighlights(fileId, { from: want.from, to: want.to, signal }).then(
        response => {
          if (inflight.current.get(key) === controller) {
            inflight.current.delete(key);
          }
          if (signal.aborted) return;
          dispatch({
            type: "FILE_HIGHLIGHTS_LOADED",
            fileRef,
            fileId,
            chunk,
            pages: response.pages,
          });
        },
        (err: unknown) => {
          if (inflight.current.get(key) === controller) {
            inflight.current.delete(key);
          }
          if (signal.aborted || isAbortError(err)) return;
          dispatch({
            type: "FILE_HIGHLIGHTS_FAILED",
            fileRef,
            fileId,
            chunk,
            code: apiErrorInfo(err).code,
          });
        },
      );
    }
  }, [active, docPages, selectedPageIndex, files, dispatch]);

  useEffect(() => {
    const pending = inflight.current;
    return () => {
      for (const controller of pending.values()) controller.abort();
      pending.clear();
    };
  }, [requestKey]);
}
