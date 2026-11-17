// 정적 export 가 미리 만들어 둘 Collection·Job 화면 경로. 서비스 워커가 쓰는 것과 같은 데이터셋에서 뽑는다.
import { generateDataset } from "../mock/lib/dataset.mjs";
import { buildLineageFixture } from "../mock/lib/lineage.mjs";

import { DEMO_DATASET_OPTIONS } from "./config.mjs";

function demoIds() {
  const dataset = generateDataset(DEMO_DATASET_OPTIONS);
  const lineage = buildLineageFixture(dataset.collection);
  const collectionId = dataset.ids.collection;
  const jobIds = [
    dataset.ids.job,
    ...(dataset.extraJobs ?? []).map(job => job.ids.job),
  ];
  return {
    collections: [collectionId, ...lineage.collections.map(row => row.id)],
    jobs: [
      ...jobIds.map(jobId => ({ collectionId, jobId })),
      // 관계 화면용 Collection 의 Job 행(검수 데이터는 없지만 행을 누르면 화면은 열린다).
      ...Object.entries(lineage.jobRows).flatMap(([id, rows]) =>
        rows.map(row => ({ collectionId: id, jobId: row.job_id })),
      ),
    ],
  };
}

/** `/[locale]/collections/[collectionId]` 의 `generateStaticParams`. */
export function collectionParams() {
  return demoIds().collections.map(collectionId => ({ collectionId }));
}

/** `/[locale]/collections/[collectionId]/jobs/[jobId]` 의 `generateStaticParams`. */
export function jobParams() {
  return demoIds().jobs;
}
