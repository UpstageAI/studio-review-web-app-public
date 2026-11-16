"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { LocatedDocument } from "@/lib/review-model";
import { useJobReview } from "./job-review-context";

/**
 * 값, Parse, Instruct 탭 작업 패널의 머리 한 줄: 선택 문서 라벨과 그 문서의 파일, 쪽 범위. 패널 제목
 * "선택한 문서" 는 화면 낭독기에만 읽히고(`headingId` 가 패널 `aria-labelledby` 대상), 눈에는 라벨과
 * 범위만 보여 값 필드에 세로 공간을 남긴다.
 */
export function DocumentPanelSummary({
  document,
  headingId,
}: {
  document: LocatedDocument;
  headingId: string;
}) {
  const t = useTranslations("review.panel");
  const td = useTranslations("review.documents");
  const { state } = useJobReview();
  const { label, source_files: sources } = document.document;
  const ranges = sources.flatMap(source => {
    const file = Object.hasOwn(state.files, source.file_ref)
      ? state.files[source.file_ref]
      : undefined;
    const name = file?.name || source.file_ref;
    return source.page_ranges.map(([from, to]) =>
      from === to
        ? t("pageSingle", { file: name, page: from })
        : t("pageRange", { file: name, from, to }),
    );
  });

  return (
    <div
      className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5"
      data-testid="job-review-panel-summary"
    >
      <h2
        id={headingId}
        className={cn(
          "min-w-0 text-base break-words",
          label === null
            ? "text-muted-foreground italic"
            : "font-medium text-foreground",
        )}
      >
        <span className="sr-only">{t("title")}: </span>
        {label ?? td("untitled")}
      </h2>
      {ranges.length > 0 ? (
        <p className="min-w-0 text-xs break-words text-muted-foreground">
          <span className="sr-only">{t("pages")}: </span>
          {ranges.join(", ")}
        </p>
      ) : null}
    </div>
  );
}
