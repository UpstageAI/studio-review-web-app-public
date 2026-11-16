"use client";

import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
import type { ReviewStatusValue } from "@/lib/review-api/types";
import { cn } from "@/lib/utils";

/**
 * 상태마다 장식 없이 채움, 테두리, 글자 농도로만 구분한다. 검수 전은 테두리 없는 흐린 글자,
 * 검수 중은 테두리, 검수 완료는 채움.
 */
const VARIANT = {
  pending: "ghost",
  in_progress: "outline",
  done: "default",
} as const;

/** 검수 상태 배지(검수 전·검수 중·검수 완료). 상태를 모르면 "—". 완료면 `title` 에 완료 시각. */
export function ReviewStatusBadge({
  status,
  completedAt,
  testId,
}: {
  status?: ReviewStatusValue;
  completedAt?: string | null;
  testId: string;
}) {
  const t = useTranslations("jobRow.reviewStatus");
  const locale = useLocale();
  const at =
    status === "done" ? formatDateTime(completedAt ?? null, locale) : null;

  return (
    <Badge
      variant={status ? VARIANT[status] : "ghost"}
      className={cn(
        (status === undefined || status === "pending") &&
          "font-normal text-muted-foreground hover:bg-transparent",
      )}
      title={at ? t("completedAt", { at }) : undefined}
      data-testid={testId}
      data-status={status ?? "unknown"}
    >
      {t(status ?? "unknown")}
    </Badge>
  );
}
