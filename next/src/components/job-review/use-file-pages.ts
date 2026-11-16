"use client";

import { useCallback, useEffect, useRef, type Dispatch } from "react";
import {
  apiErrorInfo,
  getFilePages,
  isAbortError,
} from "@/lib/review-api/review-screen";
import { filePagesReady } from "@/lib/review-api/file-pages";
import type { JobFile, JobReviewAction } from "./job-review-state";

/** 파일 페이지를 동시에 받는 수. */
const CONCURRENCY = 2;
/** 아직 그릴 수 없는 파일을 한 번 더 조회하기까지 기다리는 시간. */
const NOT_READY_RETRY_MS = 30_000;

/**
 * Job 의 파일 페이지(이미지 URL)를 순서대로 동시 2 개씩 받아
 * `FILE_LOADED`·`FILE_FAILED` 로 알린다. 아직 그릴 수 없는 파일(페이지 이미지가 빠짐)은 30 초 뒤 한 번 더 받는다.
 * `files` 가 바뀌거나(다시 불러오기) 화면을 떠나면 진행 중인 요청과 타이머를 모두 끊는다.
 * 돌려주는 함수는 지정한 파일을 서버 캐시를 건너뛰고 다시 받는다(서명 URL 만료 대응).
 */
export function useFilePages(
  files: readonly JobFile[],
  dispatch: Dispatch<JobReviewAction>,
): (fileRefs: readonly string[]) => void {
  const filesRef = useRef(files);
  const refreshControllers = useRef(new Map<string, AbortController>());

  useEffect(() => {
    filesRef.current = files;
    if (files.length === 0) return;
    const controller = new AbortController();
    const { signal } = controller;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const queue = [...files];
    const refreshing = refreshControllers.current;

    const load = async (file: JobFile, retried: boolean): Promise<void> => {
      try {
        const response = await getFilePages(file.fileId, { signal });
        if (signal.aborted) return;
        dispatch({ type: "FILE_LOADED", fileRef: file.fileRef, response });
        if (!filePagesReady(response) && !retried) {
          timers.push(
            setTimeout(() => void load(file, true), NOT_READY_RETRY_MS),
          );
        }
      } catch (err) {
        if (signal.aborted || isAbortError(err)) return;
        dispatch({
          type: "FILE_FAILED",
          fileRef: file.fileRef,
          code: apiErrorInfo(err).code,
        });
      }
    };

    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        await load(next, false);
      }
    };
    for (let i = 0; i < Math.min(CONCURRENCY, queue.length); i += 1) {
      void worker();
    }

    return () => {
      controller.abort();
      for (const timer of timers) clearTimeout(timer);
      for (const pending of refreshing.values()) pending.abort();
      refreshing.clear();
    };
  }, [files, dispatch]);

  return useCallback(
    (fileRefs: readonly string[]) => {
      for (const fileRef of new Set(fileRefs)) {
        const file = filesRef.current.find(item => item.fileRef === fileRef);
        if (!file) continue;
        refreshControllers.current.get(fileRef)?.abort();
        const controller = new AbortController();
        refreshControllers.current.set(fileRef, controller);
        const { signal } = controller;
        dispatch({ type: "FILE_LOADING", fileRef });
        getFilePages(file.fileId, { refresh: true, signal }).then(
          response => {
            if (signal.aborted) return;
            refreshControllers.current.delete(fileRef);
            dispatch({ type: "FILE_LOADED", fileRef, response });
          },
          (err: unknown) => {
            if (signal.aborted || isAbortError(err)) return;
            refreshControllers.current.delete(fileRef);
            dispatch({
              type: "FILE_FAILED",
              fileRef,
              code: apiErrorInfo(err).code,
            });
          },
        );
      }
    },
    [dispatch],
  );
}
