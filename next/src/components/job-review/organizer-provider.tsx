"use client";

import { useCallback, useId, useMemo, useState, type ReactNode } from "react";
import type { PageGridSize } from "@/components/studio-ui-kit/structure-editor";
import { OrganizerContext } from "./organizer-context";
import {
  readOrganizerView,
  writeOrganizerOpen,
  writeOrganizerSize,
} from "./organizer-view";
import { localStore } from "@/lib/browser-storage";
import { useReviewPolicy } from "./review-policy-context";

/**
 * 페이지 정리 화면의 열림 여부와 썸네일 크기를 뷰어 칼럼(토글, 띠)과 작업 패널(머리 줄, 격자)이 함께
 * 보도록 나눈다. 처음 값은 브라우저 기억에서 읽고(없으면 닫힘, 작은 썸네일), 바꾸면 함께 기억한다.
 * 화면은 불러온 뒤 클라이언트에서 그려지므로 서버 렌더와 어긋나지 않는다. 설정 메뉴에서 "페이지 정리" 를
 * 끄면(기본) 늘 닫힌 것으로 본다.
 */
export function OrganizerProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState(() => readOrganizerView(localStore()));
  const panelId = useId();
  const toggleId = useId();
  const setOpen = useCallback((open: boolean) => {
    setView(previous => ({ ...previous, open }));
    writeOrganizerOpen(localStore(), open);
  }, []);
  const setSize = useCallback((size: PageGridSize) => {
    setView(previous => ({ ...previous, size }));
    writeOrganizerSize(localStore(), size);
  }, []);
  // 설정에서 페이지 정리를 끄면 열림 기억값과 관계없이 닫힌 것으로 본다(기억값은 그대로 둔다).
  const enabled = useReviewPolicy().features.organizer;
  const open = enabled && view.open;
  const value = useMemo(
    () => ({
      open,
      size: view.size,
      setOpen,
      setSize,
      panelId,
      toggleId,
    }),
    [open, view.size, setOpen, setSize, panelId, toggleId],
  );
  return (
    <OrganizerContext.Provider value={value}>
      {children}
    </OrganizerContext.Provider>
  );
}
