"use client";

import { hasSplitDocuments } from "@/lib/review-model";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { FilmstripOpenContext } from "./filmstrip-open-context";
import { readFilmstripOpen, writeFilmstripOpen } from "./filmstrip-open";
import { useJobReview } from "./job-review-context";
import { localStore } from "@/lib/browser-storage";
import { useReviewPolicy } from "./review-policy-context";

/**
 * 필름스트립 펼침 여부를 뷰어 칼럼의 토글과 띠가 함께 보도록 나눈다. 설정 메뉴에서 "페이지 썸네일" 을
 * 끄면 늘 접힌 것으로 본다. 사용자가 한 번이라도 펼치거나 접으면 브라우저 기억값이 우선하고, 기억값이
 * 없으면 불러온 원본 Job 의 문서 배치로 정한다 — 문서가 나뉜 Job 은 펼친 채, 아니면 접힌 채.
 * 판정은 편집 중인 Job 이 아니라 불러온 원본 기준이라 접힌 채 문서를 나눠도 저절로 펼쳐지지 않고,
 * 저장 뒤 다시 불러오면 그때 다시 판정한다. 화면은 불러온 뒤 클라이언트에서 그려지므로 서버 렌더와
 * 어긋나지 않는다.
 */
export function FilmstripOpenProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<boolean | null>(() =>
    readFilmstripOpen(localStore()),
  );
  const { state } = useJobReview();
  const baseJob = state.session?.base.jobs[0] ?? null;
  const defaultOpen = useMemo(
    () => (baseJob ? hasSplitDocuments(baseJob) : false),
    [baseJob],
  );
  const update = useCallback((next: boolean) => {
    setStored(next);
    writeFilmstripOpen(localStore(), next);
  }, []);
  // 설정에서 페이지 썸네일을 끄면 펼침 기억값과 관계없이 접힌 것으로 본다(기억값은 그대로 둔다).
  const enabled = useReviewPolicy().features.filmstrip;
  const shown = enabled && (stored ?? defaultOpen);
  const value = useMemo(() => [shown, update] as const, [shown, update]);
  return (
    <FilmstripOpenContext.Provider value={value}>
      {children}
    </FilmstripOpenContext.Provider>
  );
}
