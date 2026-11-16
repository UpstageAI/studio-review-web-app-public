"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

/** 어느 문서에도 연결되지 않은 결과 묶음. 기본은 접혀 있다. */
export function UnlinkedResults({
  count,
  children,
}: {
  count: number;
  children: ReactNode;
}) {
  const t = useTranslations("review.values");
  return (
    <details
      className="group min-w-0 rounded-md border border-border"
      data-testid="job-review-unlinked-results"
    >
      <summary
        className="cursor-pointer rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        data-testid="job-review-unlinked-toggle"
      >
        {t("unlinked", { count })}
      </summary>
      <div className="flex min-w-0 flex-col gap-3 border-t border-border p-3">
        <p className="text-xs text-muted-foreground">{t("unlinkedHint")}</p>
        {children}
      </div>
    </details>
  );
}
