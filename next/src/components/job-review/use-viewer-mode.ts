"use client";

import { useCallback, useState } from "react";
import { localStore } from "@/lib/browser-storage";
import {
  readViewerMode,
  writeViewerMode,
  type ViewerMode,
} from "./viewer-mode";

/**
 * 뷰어 모드와 바꾸는 함수. 처음 값은 브라우저 기억에서 읽고(없으면 연속 스크롤), 바꾸면 함께
 * 기억한다. 뷰어는 불러온 뒤 클라이언트에서만 그려지므로 서버 렌더와 어긋나지 않는다.
 */
export function useViewerMode(): [ViewerMode, (mode: ViewerMode) => void] {
  const [mode, setMode] = useState<ViewerMode>(() =>
    readViewerMode(localStore()),
  );
  const update = useCallback((next: ViewerMode) => {
    setMode(next);
    writeViewerMode(localStore(), next);
  }, []);
  return [mode, update];
}
