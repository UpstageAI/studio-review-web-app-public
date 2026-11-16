"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorCodeOf, useErrorMessage } from "./error-message";

/** 표 자리에 보이는 로딩 skeleton. */
export function ListLoading({
  rows = 5,
  label,
}: {
  rows?: number;
  label: string;
}) {
  return (
    <div
      className="flex flex-col gap-2"
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

/** 결과가 없을 때. */
export function ListEmpty({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-border px-6 py-12 text-center">
      <p className="font-medium text-foreground">{title}</p>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

/** 오류 문구 + 오류 코드 + 재시도 버튼. */
export function ListError({
  error,
  onRetry,
  testId,
  compact = false,
}: {
  error: unknown;
  onRetry?: () => void;
  /** 재시도 버튼의 `data-testid` */
  testId: string;
  /** "더 보기" 실패처럼 표 아래에 짧게 보일 때 */
  compact?: boolean;
}) {
  const t = useTranslations("collections.errors");
  const message = useErrorMessage();

  return (
    <div
      role="alert"
      className={
        compact
          ? "flex flex-wrap items-center gap-3 text-sm"
          : "flex flex-col items-center gap-3 rounded-lg border border-border px-6 py-12 text-center"
      }
    >
      <div className={compact ? "flex flex-col" : "flex flex-col gap-1"}>
        {!compact && (
          <p className="font-medium text-foreground">{t("title")}</p>
        )}
        <p className="text-sm text-destructive">{message(error)}</p>
        <p className="font-mono text-xs text-muted-foreground">
          {t("code", { code: errorCodeOf(error) })}
        </p>
      </div>
      {onRetry && (
        <Button
          type="button"
          variant="outline"
          size="default"
          onClick={onRetry}
          data-testid={testId}
        >
          {t("retry")}
        </Button>
      )}
    </div>
  );
}

/** 안내 상자(검수 미지원 등). */
export function ListNotice({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div
      role="status"
      className="flex flex-col gap-1 rounded-lg border border-border bg-muted/50 px-6 py-8"
    >
      <p className="font-medium text-foreground">{title}</p>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
      {children}
    </div>
  );
}
