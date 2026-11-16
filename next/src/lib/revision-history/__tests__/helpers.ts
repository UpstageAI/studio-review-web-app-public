import { layouts, type JsonValue, type ReviewJob } from "@/lib/review-model";
import type { JobRevision } from "@/lib/review-api/types";

import type { StructureContent } from "../draft";

/** 테스트용 이력 행. 값 행이 기본이고 `overrides` 로 바꾼다. */
export function revision(overrides: Partial<JobRevision> = {}): JobRevision {
  return {
    id: "rev_1",
    type: "result",
    version: 1,
    base_version: 0,
    published_at: 1_790_000_000,
    created_by: null,
    result: { occurrence_id: "occ_extract_1", step_id: "st_extract" },
    origin: null,
    operation: { id: "op_1", kind: "import", change_count: 1 },
    ...overrides,
  };
}

/** 지금 Job 의 구조를 이력 내용 모양(`StructureContent`)으로 옮긴다. */
export function structureOf(job: ReviewJob): StructureContent {
  return {
    file_groups: {
      groups: (job.file_groups?.groups ?? []).map(group => ({
        group_id: group.group_id,
        layout_step_id: group.layout_step_id,
        files: group.files.map(file => ({ ...file })),
      })),
      excluded_pages: job.file_groups?.excluded_pages ?? [],
      excluded_documents: job.file_groups?.excluded_documents ?? [],
    },
    documents: layouts(job).flatMap(layout =>
      layout.content.documents.map(document => ({
        document_id: document.document_id,
        step_id: layout.step_id,
        group_id: document.group_id,
        label: document.label,
        source_files: document.source_files,
      })),
    ),
  };
}

/** `StructureContent` 를 `JsonValue` 로(테스트 입력용). */
export function asJson(content: StructureContent): JsonValue {
  return JSON.parse(JSON.stringify(content)) as JsonValue;
}
