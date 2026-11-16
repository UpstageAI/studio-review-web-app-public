// Job 검수 변경 이력(`source-jobs/{jobId}/revisions`) 클라이언트.
// 본문의 `content`·`base_content` 는 검수 결과 값이라 숫자 표기를 지켜야 하므로 `requestText` 로 받아
// `parseJson`(ExactNumber 보존)으로 읽는다. 행 모양은 필수 필드만 검사하고 모르는 필드는 버린다.

import {
  ReviewModelError,
  isJsonObject,
  parseJson,
  retryAfterMs,
  type JsonObject,
  type JsonValue,
} from "@/lib/review-model";

import {
  ApiError,
  isAbortError,
  requestText,
  segment,
  type RequestOptions,
} from "./client";
import type {
  JobRevision,
  JobRevisionDocumentRef,
  JobRevisionOperation,
  JobRevisionOrigin,
  JobRevisionPage,
  JobRevisionResultRef,
  JobRevisionsQuery,
} from "./types";

/** 응답 본문 상한. 단건은 `content`·`base_content` 가 각각 16 MiB 까지 올 수 있다(+ 메타). */
export const REVISION_MAX_BYTES = 40 * 1024 * 1024;

function revisionsPath(collectionId: string, jobId: string): string {
  return `/api/search-collections/${segment(collectionId)}/source-jobs/${segment(jobId)}/revisions`;
}

function invalidResponse(message: string): ApiError {
  return new ApiError(200, "invalid_response", message);
}

function parseBody(text: string): JsonValue {
  try {
    return parseJson(text, { maxBytes: REVISION_MAX_BYTES });
  } catch (err) {
    if (err instanceof ReviewModelError && err.code === "json_too_large") {
      throw new ApiError(
        200,
        "response_too_large",
        `Response exceeds ${REVISION_MAX_BYTES} bytes`,
      );
    }
    throw invalidResponse("Response is not valid JSON");
  }
}

const str = (value: JsonValue | undefined): string | null =>
  typeof value === "string" ? value : null;

const nonEmpty = (value: JsonValue | undefined): string | null =>
  typeof value === "string" && value !== "" ? value : null;

/** JS number 로 읽힌 정수만. `ExactNumber`(큰 수·소수 표기)는 버린다. */
const int = (value: JsonValue | undefined): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : null;

function readDocuments(
  value: JsonValue | undefined,
): JobRevisionDocumentRef[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const docs: JobRevisionDocumentRef[] = [];
  for (const item of value) {
    if (!isJsonObject(item)) continue;
    const documentId = nonEmpty(item.document_id);
    if (documentId === null) continue;
    docs.push({
      document_id: documentId,
      label: str(item.label),
      field_group: str(item.field_group),
    });
  }
  return docs;
}

function readResultRef(
  value: JsonValue | undefined,
): JobRevisionResultRef | null {
  if (!isJsonObject(value)) return null;
  const occurrenceId = nonEmpty(value.occurrence_id);
  const stepId = nonEmpty(value.step_id);
  if (occurrenceId === null || stepId === null) return null;
  const documents = readDocuments(value.documents);
  return {
    occurrence_id: occurrenceId,
    job_result_id: str(value.job_result_id),
    step_id: stepId,
    step_name: str(value.step_name),
    step_type: str(value.step_type),
    ...(documents && { documents }),
  };
}

function readOrigin(value: JsonValue | undefined): JobRevisionOrigin | null {
  if (!isJsonObject(value)) return null;
  const type = nonEmpty(value.type);
  if (type === null) return null;
  return {
    type,
    source_job_id: str(value.source_job_id),
    source_occurrence_id: str(value.source_occurrence_id),
  };
}

function readOperation(
  value: JsonValue | undefined,
): JobRevisionOperation | null {
  if (!isJsonObject(value)) return null;
  const id = nonEmpty(value.id);
  if (id === null) return null;
  const operation: JobRevisionOperation = {
    id,
    collection_id: str(value.collection_id),
    reason: str(value.reason),
    client_reference: str(value.client_reference),
  };
  const kind = nonEmpty(value.kind);
  if (kind !== null) operation.kind = kind;
  const changeCount = int(value.change_count);
  if (changeCount !== null) operation.change_count = changeCount;
  if (typeof value.from_this_collection === "boolean") {
    operation.from_this_collection = value.from_this_collection;
  }
  return operation;
}

function readContent(
  row: JsonObject,
  revision: JobRevision,
  key: "content" | "base_content",
): void {
  if (key in row) revision[key] = row[key];
  const omittedKey = `${key}_omitted` as const;
  if (omittedKey in row) revision[omittedKey] = str(row[omittedKey]);
}

/**
 * 이력 행 하나를 읽는다. 필수 필드(`id`·`type`·`version`·`base_version`·`published_at`·`operation.id`,
 * 값 변경이면 `result.occurrence_id`·`result.step_id`)가 없거나 모양이 다르면 `null`.
 * `content`·`base_content` 는 받은 값 그대로(`ExactNumber` 포함) 둔다.
 */
export function readJobRevision(value: JsonValue): JobRevision | null {
  if (!isJsonObject(value)) return null;
  const id = nonEmpty(value.id);
  const type =
    value.type === "result" || value.type === "structure" ? value.type : null;
  const version = int(value.version);
  const baseVersion = int(value.base_version);
  const publishedAt = int(value.published_at);
  const operation = readOperation(value.operation);
  if (
    id === null ||
    type === null ||
    version === null ||
    baseVersion === null ||
    publishedAt === null ||
    operation === null
  ) {
    return null;
  }
  let result: JobRevisionResultRef | null = null;
  if (type === "result") {
    result = readResultRef(value.result);
    if (result === null) return null;
  }
  const revision: JobRevision = {
    id,
    object: "search_collection.job_revision",
    type,
    version,
    base_version: baseVersion,
    published_at: publishedAt,
    created_by: str(value.created_by),
    result,
    origin: readOrigin(value.origin),
    operation,
  };
  readContent(value, revision, "content");
  readContent(value, revision, "base_content");
  return revision;
}

/**
 * 목록 본문을 읽는다. 읽을 수 없는 행은 버리되 `last_id`·`has_more` 는 서버 값을 그대로 둔다(다음 페이지
 * 커서가 버린 행이어도 이어 받을 수 있게). `data` 가 배열이 아니면 `invalid_response`.
 */
export function readJobRevisionPage(text: string): JobRevisionPage {
  const body = parseBody(text);
  if (!isJsonObject(body) || !Array.isArray(body.data)) {
    throw invalidResponse("Revision list is not a list");
  }
  const data: JobRevision[] = [];
  for (const item of body.data) {
    const revision = readJobRevision(item);
    if (revision) data.push(revision);
  }
  return {
    object: "list",
    data,
    first_id: str(body.first_id),
    last_id: str(body.last_id),
    has_more: body.has_more === true,
  };
}

/** 이력 한 페이지. `include: "content"` 가 아니면 행에 내용이 없다. */
export async function listJobRevisions(
  collectionId: string,
  jobId: string,
  query: JobRevisionsQuery = {},
  opts: RequestOptions = {},
): Promise<JobRevisionPage> {
  const { text } = await requestText(revisionsPath(collectionId, jobId), {
    query: { ...query },
    signal: opts.signal,
  });
  return readJobRevisionPage(text);
}

/** 이력 한 건(변경 후 `content`·변경 전 `base_content`). */
export async function getJobRevision(
  collectionId: string,
  jobId: string,
  revisionId: string,
  opts: RequestOptions = {},
): Promise<JobRevision> {
  const { text } = await requestText(
    `${revisionsPath(collectionId, jobId)}/${segment(revisionId)}`,
    { signal: opts.signal },
  );
  const revision = readJobRevision(parseBody(text));
  if (!revision) throw invalidResponse("Revision has an unexpected shape");
  return revision;
}

/**
 * 이력 요청 오류 분류. 화면 문구·재시도 방식은 이 값으로 고른다.
 * - `unsupported`: 이력 경로가 없다(gateway 의 JSON 아닌 404 → BFF `upstream_error`, 또는 envelope 없는 404)
 * - `not_found`: Job 이 이 Collection 에 없다(`source_job_not_found`)
 * - `result_not_found`·`revision_not_found`·`invalid_cursor`: 같은 이름의 서버 코드
 * - `busy`: 429·`operation_capacity_exceeded`(`Retry-After` 뒤 다시)
 * - `aborted`: 요청 취소(오류로 보이지 않는다)
 * - `retry`: 그 밖(네트워크·5xx·모양 오류 등)
 */
export type JobRevisionErrorKind =
  | "unsupported"
  | "not_found"
  | "result_not_found"
  | "revision_not_found"
  | "invalid_cursor"
  | "busy"
  | "aborted"
  | "retry";

export function revisionErrorKind(err: unknown): JobRevisionErrorKind {
  if (isAbortError(err)) return "aborted";
  if (!(err instanceof ApiError)) return "retry";
  switch (err.code) {
    case "source_job_not_found":
      return "not_found";
    case "result_not_found":
    case "revision_not_found":
    case "invalid_cursor":
      return err.code;
    case "operation_capacity_exceeded":
      return "busy";
  }
  if (err.status === 429) return "busy";
  if (
    err.status === 404 &&
    (err.code === "upstream_error" || err.code === "http_error")
  ) {
    return "unsupported";
  }
  return "retry";
}

/**
 * 다시 요청할 수 있을 때까지 기다릴 ms. `Retry-After` 정수 초를 읽고(없으면 2 초, 최대 10 초),
 * HTTP-date 면 `now` 기준 남은 시간(같은 상한)을 쓴다.
 */
export function revisionRetryDelayMs(err: ApiError, now = Date.now()): number {
  const header = err.retryAfter?.trim() ?? "";
  if (header !== "" && !/^\d+$/.test(header)) {
    const at = Date.parse(header);
    if (Number.isFinite(at)) return Math.min(Math.max(at - now, 0), 10_000);
  }
  return retryAfterMs(err.retryAfter);
}
