"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ListError } from "./list-state";

/** 표 아래의 "더 보기" 버튼과 그 실패 표시. */
export function LoadMore({
  hasMore,
  state,
  error,
  onLoadMore,
  onRetry,
  testIdPrefix,
}: {
  hasMore: boolean;
  state: "idle" | "loading" | "error";
  error: unknown;
  onLoadMore: () => void;
  onRetry: () => void;
  testIdPrefix: string;
}) {
  const t = useTranslations("collections");
  if (state === "error") {
    return (
      <ListError
        error={error}
        onRetry={onRetry}
        testId={`${testIdPrefix}-button-retry-more`}
        compact
      />
    );
  }
  if (!hasMore) return null;
  return (
    <div className="flex justify-center">
      <Button
        type="button"
        variant="outline"
        onClick={onLoadMore}
        disabled={state === "loading"}
        data-testid={`${testIdPrefix}-button-load-more`}
      >
        {state === "loading" ? t("loadingMore") : t("loadMore")}
      </Button>
    </div>
  );
}
