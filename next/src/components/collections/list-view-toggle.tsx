"use client";

import { useTranslations } from "next-intl";
import { LIST_VIEWS, type ListView } from "./list-url-state";

/** Collection 목록의 보기 전환(목록, 관계). */
export function ListViewToggle({
  value,
  onChange,
}: {
  value: ListView;
  onChange: (view: ListView) => void;
}) {
  const t = useTranslations("collections.view");
  return (
    <div
      role="group"
      aria-label={t("label")}
      className="inline-flex h-9 items-center rounded-lg bg-muted p-[3px]"
    >
      {LIST_VIEWS.map(view => (
        <button
          key={view}
          type="button"
          aria-pressed={view === value}
          onClick={() => onChange(view)}
          className="h-full rounded-md px-3 text-sm text-muted-dark transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-background aria-pressed:font-medium aria-pressed:text-foreground aria-pressed:shadow-xs"
          data-testid={`collections-list-button-view-${view}`}
        >
          {t(view)}
        </button>
      ))}
    </div>
  );
}
