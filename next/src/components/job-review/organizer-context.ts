"use client";

import { createContext, useContext } from "react";
import type { PageGridSize } from "@/components/studio-ui-kit/structure-editor";

export interface OrganizerValue {
  /** 구성 탭의 페이지 정리 화면(문서별 썸네일 격자)을 열어 두었는지. */
  open: boolean;
  /** 격자 썸네일 크기. */
  size: PageGridSize;
  setOpen: (open: boolean) => void;
  setSize: (size: PageGridSize) => void;
  /** 정리 화면 패널의 DOM id. 뷰어 툴바 토글의 `aria-controls` 가 가리킨다. */
  panelId: string;
  /** 뷰어 툴바 토글의 DOM id. 정리 화면의 "완료" 로 닫으면 포커스를 이 토글로 돌려준다. */
  toggleId: string;
}

export const OrganizerContext = createContext<OrganizerValue | null>(null);

/** 페이지 정리 화면의 열림·크기와 바꾸는 함수(`OrganizerProvider` 안에서). */
export function useOrganizer(): OrganizerValue {
  const value = useContext(OrganizerContext);
  if (!value) {
    throw new Error("useOrganizer 는 OrganizerProvider 안에서 쓴다");
  }
  return value;
}
