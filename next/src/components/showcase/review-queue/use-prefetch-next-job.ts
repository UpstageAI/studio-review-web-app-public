"use client";

import { useEffect } from "react";
import { getFilePages, getJobFiles } from "@/lib/review-api/client";

/** 지금 Job 을 먼저 불러오도록 미리 받기를 미루는 시간. */
export const PREFETCH_DELAY_MS = 1500;
/** 브라우저 캐시에 올려 둘 앞쪽 페이지 이미지 수. */
export const PREFETCH_PAGE_IMAGES = 2;

/**
 * 검수 큐의 다음 Job 첫 파일 페이지를 미리 받아 둔다. `/api/files/{fileId}` 를 한 번 불러 서버의
 * 파일 응답 캐시를 데우고, 앞 몇 쪽 이미지를 브라우저가 받아 두게 해서 "완료 후 다음 Job" 직후
 * 빈 뷰어가 보이는 시간을 줄인다. 실패는 화면에 알리지 않는다(다음 Job 을 열 때 평소대로 받는다).
 * 다음 Job 이 바뀌거나 화면을 떠나면 진행 중인 요청을 끊는다.
 */
export function usePrefetchNextJob(
  collectionId: string,
  nextJobId: string | null,
): void {
  useEffect(() => {
    if (!nextJobId) return;
    const controller = new AbortController();
    const { signal } = controller;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const files = await getJobFiles(collectionId, nextJobId, { signal });
          const first = files.data[0];
          if (!first || signal.aborted) return;
          const pages = await getFilePages(first.id, { signal });
          if (signal.aborted) return;
          for (const page of pages.pages.slice(0, PREFETCH_PAGE_IMAGES)) {
            if (!page.image_url) continue;
            const image = new Image();
            image.decoding = "async";
            image.src = page.image_url;
          }
        } catch {
          // 미리 받기는 덤이다. 끊겼거나 실패하면 다음 Job 을 열 때 평소대로 받는다.
        }
      })();
    }, PREFETCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [collectionId, nextJobId]);
}
