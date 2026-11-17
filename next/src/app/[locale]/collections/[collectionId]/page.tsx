import { use } from "react";
import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { CollectionDetailView } from "@/components/collections/collection-detail-view";
import { CollectionsBackLink } from "@/components/collections/collections-back-link";
import { PAGE_CONTAINER } from "@/components/page-container";
import { FIT_PAGE_CLASS } from "@/components/studio-table";
import type { Locale } from "@/i18n/config";
import { demoCollectionParams } from "@/lib/pages-demo";

// Pages 데모(정적 export)에서만 값이 있다. 평소에는 `undefined` 라 요청 때 그린다.
export const generateStaticParams = demoCollectionParams;

export default function CollectionDetailPage({
  params,
}: PageProps<"/[locale]/collections/[collectionId]">) {
  const { locale, collectionId } = use(params);
  setRequestLocale(locale as Locale);

  const t = useTranslations("collections");

  return (
    <main
      className={`${PAGE_CONTAINER} ${FIT_PAGE_CLASS} flex flex-1 flex-col gap-6 py-8`}
    >
      <div className="shrink-0">
        <CollectionsBackLink>
          <span aria-hidden="true">←</span> {t("backToList")}
        </CollectionsBackLink>
      </div>
      <CollectionDetailView collectionId={collectionId} />
    </main>
  );
}
