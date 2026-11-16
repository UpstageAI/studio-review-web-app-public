"use client";

import { useTranslations } from "next-intl";

/** Collection 종류 표시. 모르는 값은 원문 그대로. */
export function KindLabel({ kind }: { kind?: string | null }) {
  const t = useTranslations("collections.kind");
  if (kind === "documents" || kind === "table") return <>{t(kind)}</>;
  return <>{kind || "—"}</>;
}
