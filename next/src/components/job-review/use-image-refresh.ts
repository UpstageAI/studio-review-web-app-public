"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  createRefreshGate,
  failedImageUrl,
  fileRefOfImage,
} from "./image-refresh";
import type { FileEntry } from "./job-review-state";

/**
 * 페이지 이미지가 로드에 실패하면 그 파일의 이미지 URL 을 서버 캐시를 건너뛰고 다시 받는다(만료된
 * 서명 URL 대응, `image-refresh`). 문서 전체에서 capture 단계 `error` 를 들어 뷰어(연속 스크롤의
 * `<img>`), 필름스트립, 페이지 정리 썸네일을 함께 본다(`error` 는 bubble 하지 않지만 capture 는 된다).
 * 화면 밖에서 이미지를 미리 읽는 경로(한 장씩 보기)는 돌려주는 함수로 직접 알린다. 같은 파일은 쉬는
 * 시간 안에 한 번만, 이미 다시 받는 중인 파일은 건너뛴다.
 */
export function useImageRefresh(
  files: Readonly<Record<string, FileEntry>>,
  refreshFiles: (fileRefs: readonly string[]) => void,
): (url: string) => void {
  const latest = useRef({ files, refreshFiles });
  useEffect(() => {
    latest.current = { files, refreshFiles };
  });
  const gateRef = useRef<ReturnType<typeof createRefreshGate> | null>(null);

  const report = useCallback((url: string) => {
    const { files: current, refreshFiles: refresh } = latest.current;
    const fileRef = fileRefOfImage(current, url);
    if (!fileRef || current[fileRef]?.status === "loading") return;
    gateRef.current ??= createRefreshGate();
    if (!gateRef.current(fileRef, Date.now())) return;
    refresh([fileRef]);
  }, []);

  useEffect(() => {
    const onError = (event: Event) => {
      const target = event.target;
      const url = failedImageUrl(target instanceof Element ? target : null);
      if (url) report(url);
    };
    document.addEventListener("error", onError, true);
    return () => document.removeEventListener("error", onError, true);
  }, [report]);

  return report;
}
