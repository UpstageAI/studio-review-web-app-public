import { readReviewDocument } from "../../normalize";
import type { ReviewDocument, ReviewJob } from "../../types";
import { SINGLE_JOB } from "./fixtures";

/** single-job fixture 의 문서와 `job_A`. */
export function singleJob(): { doc: ReviewDocument; job: ReviewJob } {
  const doc = readReviewDocument(SINGLE_JOB);
  return { doc, job: doc.jobs[0]! };
}

/**
 * 그룹 2 개(`grp_1`: `job_G#0` 2p · `grp_2`: `job_G#1` 1p), 보기 1 개의 작은 문서.
 * 테스트 리터럴만 담으므로 `JSON.stringify` 로 만들어도 정밀도 손실이 없다.
 */
export function twoGroupDoc(): ReviewDocument {
  return readReviewDocument(
    JSON.stringify({
      format: "collection-results/11",
      collection_id: "scol_test",
      configs: { cfg_1: { agent_id: null } },
      steps: {
        st_classify: {
          config_id: "cfg_1",
          name: "분류",
          type: "document-classify",
        },
      },
      jobs: [
        {
          id: "job_G",
          file_groups: {
            base_version: 1,
            groups: [
              {
                group_id: "grp_1",
                layout_step_id: "st_classify",
                files: [
                  {
                    file_ref: "job_G#0",
                    file_id: "f0",
                    name: "a.pdf",
                    num_pages: 2,
                  },
                ],
              },
              {
                group_id: "grp_2",
                layout_step_id: "st_classify",
                files: [
                  {
                    file_ref: "job_G#1",
                    file_id: "f1",
                    name: "b.pdf",
                    num_pages: 1,
                  },
                ],
              },
            ],
            excluded_pages: [{ file_ref: "job_G#0", page_ranges: [[2, 2]] }],
            excluded_documents: ["doc_x"],
          },
          output: [
            {
              step_id: "st_classify",
              base_version: 1,
              content: {
                documents: [
                  {
                    document_id: "doc_a",
                    group_id: "grp_1",
                    label: "a",
                    source_files: [
                      { file_ref: "job_G#0", page_ranges: [[1, 1]] },
                    ],
                  },
                  {
                    document_id: "doc_b",
                    group_id: "grp_2",
                    label: "b",
                    source_files: [
                      { file_ref: "job_G#1", page_ranges: [[1, 1]] },
                    ],
                  },
                  {
                    document_id: "doc_x",
                    group_id: "grp_1",
                    label: null,
                    source_files: [
                      { file_ref: "job_G#0", page_ranges: [[1, 1]] },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    }),
  );
}
