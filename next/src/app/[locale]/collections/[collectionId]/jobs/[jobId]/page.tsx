import { use } from "react";
import { setRequestLocale } from "next-intl/server";
import { PAGE_CONTAINER } from "@/components/page-container";
import { JobReviewWithQueue } from "@/components/showcase/review-queue/job-review-with-queue";
import type { Locale } from "@/i18n/config";

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
