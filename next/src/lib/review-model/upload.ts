import { changedResults, structureChanged } from "./diff";
import {
  stringifyJson,
  utf8Length,
  type JsonObject,
  type JsonValue,
} from "./json";
import {
  isResult,
  type FileGroups,
  type Layout,
  type OutputItem,
  type Result,
  type ReviewDocument,
  type ReviewJob,
  type ValidationIssue,
} from "./types";
import { validateStructure, validateValues } from "./validate";

/**
 * 본문 업로드(`POST …/review-imports`) 한도. 정의는 여기 하나이고 서버 쪽
 * `lib/upstage/review.ts` 가 재수출한다(서버 전용 모듈은 브라우저에서 import 할 수 없어 방향이 이쪽이다).
 */
export const MAX_INLINE_IMPORT_BYTES = 8 * 1024 * 1024;

export type UploadBody = {
  /** wire 모양의 검수 JSON. 바뀐 것이 없으면 `null`. */
  readonly body: JsonObject | null;
  /** `stringifyJson(body)`(compact). `body` 가 없으면 `""`. */
  readonly text: string;
  readonly bytes: number;
  readonly changedResultIds: readonly string[];
  readonly structureChangedJobIds: readonly string[];
  /** 보낼 Job 의 구조 검증(구조를 바꾼 Job 만) + 바뀐 결과의 값 검증 + 크기. */
  readonly issues: readonly ValidationIssue[];
};

function wireFileGroups(fileGroups: FileGroups): JsonObject {
  return {
    base_version: fileGroups.base_version,
    groups: fileGroups.groups.map(group => ({
      group_id: group.group_id,
      // 읽기 전용 `num_pages`·`input_index` 는 보내지 않는다.
      files: group.files.map(file => ({
        file_ref: file.file_ref,
        file_id: file.file_id,
        name: file.name,
      })),
      layout_step_id: group.layout_step_id,
    })),
    excluded_pages: fileGroups.excluded_pages.map(source => ({
      file_ref: source.file_ref,
      page_ranges: source.page_ranges.map(([first, last]) => [first, last]),
    })),
    excluded_documents: [...fileGroups.excluded_documents],
  };
}

function wireLayout(layout: Layout): JsonObject {
  return {
    step_id: layout.step_id,
    base_version: layout.base_version,
    content: {
      documents: layout.content.documents.map(document => ({
        document_id: document.document_id,
        group_id: document.group_id,
        label: document.label,
        source_files: document.source_files.map(source => ({
          file_ref: source.file_ref,
          page_ranges: source.page_ranges.map(([first, last]) => [first, last]),
        })),
      })),
    },
  };
}

/** 결과는 식별자·version·값만(`state`·연결·`source`·`checks` 는 읽기 전용). */
function wireResult(result: Result): JsonObject {
  return {
    id: result.id,
    step_id: result.step_id,
    base_version: result.base_version,
    content: result.content,
  };
}

function wireJob(
  job: ReviewJob,
  changed: ReadonlySet<string>,
  withStructure: boolean,
): JsonObject {
  const output: JsonValue[] = [];
  for (const item of job.output as readonly OutputItem[]) {
    if (isResult(item)) {
      if (changed.has(item.id)) output.push(wireResult(item));
    } else if (withStructure) {
      output.push(wireLayout(item));
    }
  }
  return withStructure && job.file_groups
    ? { id: job.id, file_groups: wireFileGroups(job.file_groups), output }
    : { id: job.id, output };
}

/**
 * 업로드 본문을 최소로 만든다. 구조를 바꾼 Job 은 `file_groups` + 그 Job 의 문서
 * 배치 보기 전부(일부만 보내면 서버가 나머지를 지운 것으로 본다) + 바뀐 결과, 값만
 * 바꾼 Job 은 `file_groups` 없이 바뀐 결과만. 아무것도 바뀌지 않은 Job 은 뺀다.
 * `steps` 는 읽기 전용 `labels`·`schema` 를 뺀다. 숫자는 원문 토큰 그대로 나간다.
 */
export function buildUploadBody(
  base: ReviewDocument,
  current: ReviewDocument,
  options: { maxBytes?: number } = {},
): UploadBody {
  const maxBytes = options.maxBytes ?? MAX_INLINE_IMPORT_BYTES;
  const jobs: JsonObject[] = [];
  const changedResultIds: string[] = [];
  const structureChangedJobIds: string[] = [];
  const issues: ValidationIssue[] = [];
  const includedJobIds: string[] = [];
  for (const job of current.jobs) {
    const original = base.jobs.find(item => item.id === job.id);
    if (!original) continue;
    const changed = changedResults(original, job);
    const structure = structureChanged(original, job);
    if (changed.length === 0 && !structure) continue;
    changedResultIds.push(...changed);
    if (structure) {
      structureChangedJobIds.push(job.id);
      issues.push(...validateStructure(job, current));
    }
    issues.push(...validateValues(current, job, changed));
    includedJobIds.push(job.id);
    jobs.push(wireJob(job, new Set(changed), structure));
  }
  if (jobs.length === 0) {
    return {
      body: null,
      text: "",
      bytes: 0,
      changedResultIds,
      structureChangedJobIds,
      issues,
    };
  }
  const steps: JsonObject = {};
  for (const [stepId, step] of Object.entries(current.steps)) {
    Object.defineProperty(steps, stepId, {
      value: { config_id: step.config_id, name: step.name, type: step.type },
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  const configs: JsonObject = {};
  for (const [configId, config] of Object.entries(current.configs)) {
    Object.defineProperty(configs, configId, {
      value: { agent_id: config.agent_id },
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  const body: JsonObject = {
    format: current.format,
    collection_id: current.collection_id,
    configs,
    steps,
    jobs,
  };
  const text = stringifyJson(body);
  const bytes = utf8Length(text);
  if (bytes > maxBytes) {
    issues.push({
      code: "package_limit_exceeded",
      severity: "error",
      jobId: includedJobIds[0] ?? "",
      where: { kind: "upload", bytes, limit: maxBytes },
    });
  }
  return {
    body,
    text,
    bytes,
    changedResultIds,
    structureChangedJobIds,
    issues,
  };
}
