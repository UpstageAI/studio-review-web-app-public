"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import type { PageRangeEditorLabels } from "@/components/studio-ui-kit/page-range-editor";
import { parsePageRangeText } from "@/lib/review-model";

/** 페이지 범위 입력(`PageRangeEditor`)의 문구와 범위 표기 검사. 구성 패널과 새 문서 대화 상자가 함께 쓴다. */
export function usePageRangeLabels(): {
  labels: PageRangeEditorLabels;
  validate: (text: string) => string | null;
} {
  const t = useTranslations("review.structure.pageRanges");
  return useMemo(
    () => ({
      labels: {
        file: row => t("file", { row }),
        range: row => t("range", { row }),
        placeholder: t("placeholder"),
        removeRow: row => t("removeRow", { row }),
        addRow: t("addRow"),
      },
      validate: text => (parsePageRangeText(text) ? null : t("invalid")),
    }),
    [t],
  );
}
