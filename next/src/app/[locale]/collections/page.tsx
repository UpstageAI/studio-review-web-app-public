import { Suspense, use } from "react";
import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { CollectionsListView } from "@/components/collections/collections-list-view";
import { ListLoading } from "@/components/collections/list-state";
import { PAGE_CONTAINER } from "@/components/page-container";
import { FIT_PAGE_CLASS } from "@/components/studio-table";
import type { Locale } from "@/i18n/config";

export default function CollectionsPage({
  params,
}: PageProps<"/[locale]/collections">) {
  const { locale } = use(params);
  setRequestLocale(locale as Locale);

  const t = useTranslations("collections");

  const heading = (
    <header className="flex min-w-0 flex-col gap-1">
      <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-sm text-muted-dark">{t("description")}</p>
    </header>
  );

  return (
    <main
      className={`${PAGE_CONTAINER} ${FIT_PAGE_CLASS} flex flex-1 flex-col py-8`}
    >
      {/* 목록은 주소 query(useSearchParams)와 브라우저 저장소를 첫 렌더에 읽는다. Suspense 가 있어야
          정적 렌더에서 빠져 클라이언트에서만 그려지고, 없으면 빌드가 실패하거나 hydration 이 어긋난다.
          그동안에도 제목은 같은 자리에 보인다. */}
      <Suspense
        fallback={
          <div className="flex flex-col gap-6">
            {heading}
            <ListLoading label={t("loadingMore")} />
          </div>
        }
      >
        <CollectionsListView heading={heading} />
      </Suspense>
    </main>
  );
}
