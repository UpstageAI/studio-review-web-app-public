"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { PagePositionBar } from "@/components/studio-ui-kit/page-position-bar";
import { useJobReview } from "./job-review-context";
import { pageMarksFor } from "./page-marks";
import { markSelectPage } from "./perf-marks";

const NO_ENTRIES: readonly never[] = [];

/**
 * 쪽수가 많은 문서의 페이지 위치 바(값 모드). 현재 페이지·쪽수와 표식(바뀐 값 · 검증 문제 ·
 * 이미지 없음)을 Core 에 넘기고, 이동은 `SELECT_PAGE` 로 한다. 검증 문제 표식은 검증이 계산되는
 * 때(구성 모드·트레이 열림)에만 나온다.
 */
export function PagePositionBand() {
  const t = useTranslations("review.pages.position");
  const {
    state,
    dispatch,
    docPages,
    imageUrls,
    extractHighlights,
    issues,
    selected,
  } = useJobReview();
  const entries = state.session?.entries ?? NO_ENTRIES;
  const documentId = selected?.document.document_id ?? null;
  const marks = useMemo(
    () =>
      pageMarksFor({
        entries,
        highlights: extractHighlights,
        issues,
        docPages,
        documentId,
        imageUrls,
      }),
    [entries, extractHighlights, issues, docPages, documentId, imageUrls],
  );
  const count = docPages.length;
  const index = Math.min(state.selectedPageIndex, Math.max(count - 1, 0));

  return (
    <PagePositionBar
      index={index}
      count={count}
      marks={marks}
      onIndexChange={next => {
        markSelectPage(next, "bar");
        dispatch({ type: "SELECT_PAGE", index: next });
      }}
      labels={{
        label: t("label"),
        previous: t("previous"),
        next: t("next"),
        pageInput: t("input"),
        pageCount: total => t("total", { total }),
        track: t("track"),
        valueText: (page, total) => t("valueText", { page, total }),
        marks: {
          changed: t("marks.changed"),
          issue: t("marks.issue"),
          noImage: t("marks.noImage"),
        },
      }}
      testId="job-review-position-bar"
    />
  );
}
