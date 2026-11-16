import type { JsonObject, JsonValue } from "./json";
import {
  isResult,
  type FileGroups,
  type Layout,
  type OutputItem,
  type Result,
  type ReviewDocument,
  type ReviewFile,
  type ReviewJob,
  type ReviewStep,
  type SourceRange,
} from "./types";

/** 키 순서를 지키며 객체를 만든다. `__proto__` 같은 키도 데이터로 둔다. */
function record<T>(
  source: Readonly<Record<string, T>>,
  each: (value: T) => JsonValue,
): JsonObject {
  const out: JsonObject = {};
  for (const key of Object.keys(source)) {
    Object.defineProperty(out, key, {
      value: each(source[key] as T),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

function sourceRange(source: SourceRange): JsonObject {
  return {
    file_ref: source.file_ref,
    page_ranges: source.page_ranges.map(([first, last]) => [first, last]),
  };
}

function file(item: ReviewFile): JsonObject {
  const out: JsonObject = {
    file_ref: item.file_ref,
    file_id: item.file_id,
    name: item.name,
  };
  if (item.num_pages !== undefined) out.num_pages = item.num_pages;
  if (item.input_index !== undefined) out.input_index = item.input_index;
  return out;
}

function fileGroups(groups: FileGroups): JsonObject {
  return {
    base_version: groups.base_version,
    groups: groups.groups.map(group => ({
      group_id: group.group_id,
      files: group.files.map(file),
      layout_step_id: group.layout_step_id,
    })),
    excluded_pages: groups.excluded_pages.map(sourceRange),
    excluded_documents: [...groups.excluded_documents],
  };
}

function layout(item: Layout): JsonObject {
  return {
    step_id: item.step_id,
    base_version: item.base_version,
    content: {
      documents: item.content.documents.map(document => ({
        document_id: document.document_id,
        group_id: document.group_id,
        label: document.label,
        source_files: document.source_files.map(sourceRange),
      })),
    },
  };
}

function result(item: Result): JsonObject {
  const out: JsonObject = {
    id: item.id,
    step_id: item.step_id,
    base_version: item.base_version,
  };
  // 읽기 정규화가 없는 `state` 를 `"present"` 로 채우므로 되돌릴 때는 생략한다.
  if (item.state !== "present") out.state = item.state;
  out.content = item.content;
  if (item.link.kind === "documents") {
    out.document_ids = [...item.link.document_ids];
  } else if (item.link.kind === "field_groups") {
    out.field_groups = record(item.link.field_groups, ids => [...ids]);
  }
  if (item.source) {
    out.source = {
      job_id: item.source.job_id,
      occurrence_id: item.source.occurrence_id,
    };
  }
  if (item.checks) {
    out.checks = item.checks.map(check => {
      const entry: JsonObject = {};
      if (check.name !== undefined) entry.name = check.name;
      if (check.severity !== undefined) entry.severity = check.severity;
      if (check.passed !== undefined) entry.passed = check.passed;
      if (check.reason !== undefined) entry.reason = check.reason;
      return entry;
    });
  }
  return out;
}

function job(item: ReviewJob): JsonObject {
  const out: JsonObject = { id: item.id };
  if (item.file_groups) out.file_groups = fileGroups(item.file_groups);
  out.output = item.output.map((entry: OutputItem) =>
    isResult(entry) ? result(entry) : layout(entry),
  );
  return out;
}

function step(item: ReviewStep): JsonObject {
  const out: JsonObject = {
    config_id: item.config_id,
    name: item.name,
    type: item.type,
  };
  if (item.labels) out.labels = [...item.labels];
  if (item.schema) out.schema = item.schema;
  return out;
}

/**
 * 읽기 정규화를 되돌린 wire 모양(`collection-results/11`). 읽기 전용 조회 정보
 * (`labels`·`schema`·`num_pages`·`input_index`·`state`·연결·`source`·`checks`)도
 * 그대로 싣는다 — 다운로드·전체 JSON 편집용. 업로드 본문은 `buildUploadBody` 를 쓴다.
 * 값은 복제하지 않고 공유한다(`ExactNumber` 유지). `stringifyJson` 으로 직렬화한다.
 */
export function serializeReviewDocument(doc: ReviewDocument): JsonObject {
  return {
    format: doc.format,
    collection_id: doc.collection_id,
    configs: record(doc.configs, config => ({ agent_id: config.agent_id })),
    steps: record(doc.steps, step),
    jobs: doc.jobs.map(job),
  };
}
