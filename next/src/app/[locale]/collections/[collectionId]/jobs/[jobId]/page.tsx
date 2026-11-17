import { use } from "react";
import { setRequestLocale } from "next-intl/server";
import { PAGE_CONTAINER } from "@/components/page-container";
import { JobReviewWithQueue } from "@/components/showcase/review-queue/job-review-with-queue";
import type { Locale } from "@/i18n/config";
import { demoJobParams } from "@/lib/pages-demo";

// Pages 데모(정적 export)에서만 값이 있다. 평소에는 `undefined` 라 요청 때 그린다.
export const generateStaticParams = demoJobParams;

export default function JobReviewPage({
  params,
}: PageProps<"/[locale]/collections/[collectionId]/jobs/[jobId]">) {
  const { locale, collectionId, jobId } = use(params);
  setRequestLocale(locale as Locale);

  return (
    <main className={`${PAGE_CONTAINER} flex flex-1 flex-col py-4`}>
      <JobReviewWithQueue collectionId={collectionId} jobId={jobId} />
    </main>
  );
}
