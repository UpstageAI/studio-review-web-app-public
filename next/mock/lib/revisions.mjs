// Job 검수 변경 이력(`source-jobs/{job}/revisions`) 원장. 순수 함수만 두고 생성기(`dataset.mjs` 의 seed
// 이력)와 mock 서버(저장 때 행 추가 · 목록 · 단건)가 함께 쓴다.
//
// 행 하나 = 변경 1 건(결과 값 또는 문서 구성). 원장은 행 메타(`records`), 저장 묶음(`operations`),
// version 별 내용(`contents`)과 기계 출력(`machine`, version 0 — 행이 아니다)을 메모리에 둔다.
// 목록 순서는 `published_at DESC, version DESC, id DESC`, `order=asc` 면 그 반대이고 `after` 는 직전
// 페이지의 `last_id` 다음부터(keyset).

export const REVISION_DEFAULT_LIMIT = 50;
export const REVISION_MAX_LIMIT = 100;
const REVISION_OBJECT = "search_collection.job_revision";

/** version 내용 키. `target` 은 결과면 occurrence id, 구조면 Job id. */
export const contentKey = (type, target, version) =>
  `${type}:${target}:${version}`;

/** mock 전용 `job_result_id` 규칙(실서버는 UUID). */
export const jobResultIdOf = occurrenceId => `jres_${occurrenceId}`;

const cloneJson = value =>
  value === undefined ? undefined : JSON.parse(JSON.stringify(value));

const isResult = item =>
  typeof item === "object" && item !== null && Object.hasOwn(item, "id");

const isLayout = item =>
  typeof item === "object" &&
  item !== null &&
  !Object.hasOwn(item, "id") &&
  Array.isArray(item.content?.documents);

/**
 * 검수 문서의 Job(`reviewDocument.jobs[0]`) → 서버 구조 content 모양. `file_groups` 에는
 * `base_version` 을 싣지 않고, 문서는 Classify 보기마다 `step_id` 를 붙여 한 줄로 늘어놓는다.
 */
export function structureContent(job) {
  const fileGroups = job.file_groups ?? {};
  return {
    file_groups: {
      groups: (fileGroups.groups ?? []).map(group => ({
        group_id: group.group_id,
        files: (group.files ?? []).map(file => {
          const out = { file_ref: file.file_ref, file_id: file.file_id };
          out.name = file.name;
          if (file.num_pages !== undefined) out.num_pages = file.num_pages;
          if (file.input_index !== undefined)
            out.input_index = file.input_index;
          return out;
        }),
        layout_step_id: group.layout_step_id ?? null,
      })),
      excluded_pages: cloneJson(fileGroups.excluded_pages ?? []),
      excluded_documents: cloneJson(fileGroups.excluded_documents ?? []),
    },
    documents: (job.output ?? []).filter(isLayout).flatMap(layout =>
      layout.content.documents.map(doc => ({
        document_id: doc.document_id,
        step_id: layout.step_id ?? null,
        group_id: doc.group_id,
        label: doc.label,
        source_files: cloneJson(doc.source_files ?? []),
      })),
    ),
  };
}

const compareIds = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** 목록 기본 순서(`published_at DESC, version DESC, id DESC`). 음수면 `a` 가 앞. */
export function compareRecords(a, b) {
  return (
    b.published_at - a.published_at ||
    b.version - a.version ||
    compareIds(b.id, a.id)
  );
}

const apiError = (status, code, message, param = null) => ({
  status,
  body: { error: { code, type: code, message, param } },
});

/** FastAPI 쿼리 검증 실패(422)를 단순화한 본문. */
const validationError = (message, param) => ({
  status: 422,
  body: { error: { code: "validation_error", message, param } },
});

const encoder = new TextEncoder();
const jsonBytes = value => encoder.encode(JSON.stringify(value)).length;

/**
 * Job 하나의 이력 원장. `history` 는 `generateDataset().history`(없으면 `null` — 빈 원장)이고 복제해 쓴다.
 *
 * - `captureMachine(job, result)` — 처음 편집되기 직전(`base_version` 0)의 내용을 기계 출력으로 박제한다.
 *   `result` 가 `null` 이면 구조. 이미 있으면 그대로 둔다.
 * - `append({ operation, changes, publishedAt })` — `changes[]` 는 `{ id, type, target, version,
 *   base_version, content, documents }`. 같은 저장의 행은 같은 `operation` 을 공유한다.
 * - `rowOf(record, doc, { withContent, maxBytes })` — 응답 항목 하나.
 * - `list(doc, params, { maxBytes })` → `{ status, body }`.
 * - `get(doc, id, ifNoneMatch, { maxBytes })` → `{ status, body, headers }`(304 면 `body` 가 `null`).
 */
/**
 * @param {{ jobId: string, collectionId: string, history?: any }} options
 */
export function createLedger({ jobId, collectionId, history = null }) {
  const seed = history ? cloneJson(history) : null;
  const records = seed ? [...seed.records] : [];
  const operations = new Map(
    (seed?.operations ?? []).map(operation => [operation.id, operation]),
  );
  const contents = new Map(Object.entries(seed?.contents ?? {}));
  const machine = {
    results: new Map(Object.entries(seed?.machine?.results ?? {})),
    structure: seed?.machine?.structure ?? null,
  };

  function captureMachine(job, result) {
    if (result === null || result === undefined) {
      if (machine.structure === null) {
        machine.structure = structureContent(job);
      }
      return;
    }
    if (!machine.results.has(result.id)) {
      machine.results.set(result.id, cloneJson(result.content));
    }
  }

  function append({ operation, changes, publishedAt }) {
    operations.set(operation.id, cloneJson(operation));
    const added = changes.map(change => {
      contents.set(
        contentKey(change.type, change.target, change.version),
        cloneJson(change.content),
      );
      const record = {
        id: change.id,
        type: change.type,
        target: change.target,
        version: change.version,
        base_version: change.base_version,
        operation_id: operation.id,
        published_at: publishedAt,
        origin: null,
        documents: cloneJson(change.documents ?? null),
      };
      records.push(record);
      return record;
    });
    return added;
  }

  const resultsOf = doc =>
    (doc?.jobs?.[0]?.output ?? []).filter(item => isResult(item));

  function slot(value, maxBytes) {
    if (value === undefined) return { value: null, omitted: "unavailable" };
    if (Number.isFinite(maxBytes) && jsonBytes(value) > maxBytes) {
      return { value: null, omitted: "too_large" };
    }
    return { value: cloneJson(value), omitted: null };
  }

  function baseContentOf(record) {
    if (record.base_version === 0) {
      return record.type === "result"
        ? machine.results.get(record.target)
        : (machine.structure ?? undefined);
    }
    return contents.get(
      contentKey(record.type, record.target, record.base_version),
    );
  }

  /** @param {{ withContent?: boolean, maxBytes?: number }} [options] */
  function rowOf(record, doc, { withContent = false, maxBytes } = {}) {
    let result = null;
    if (record.type === "result") {
      const current = resultsOf(doc).find(item => item.id === record.target);
      const stepId = current?.step_id ?? null;
      const step = stepId ? doc?.steps?.[stepId] : undefined;
      result = {
        occurrence_id: record.target,
        job_result_id: jobResultIdOf(record.target),
        step_id: stepId,
        step_name: step?.name ?? null,
        step_type: step?.type ?? null,
        documents: cloneJson(record.documents ?? []),
      };
    }
    const row = {
      id: record.id,
      object: REVISION_OBJECT,
      type: record.type,
      version: record.version,
      base_version: record.base_version,
      published_at: record.published_at,
      created_by: null,
      result,
      origin: record.origin ?? null,
      operation: cloneJson(operations.get(record.operation_id) ?? null),
    };
    if (withContent) {
      const content = slot(
        contents.get(contentKey(record.type, record.target, record.version)),
        maxBytes,
      );
      const base = slot(baseContentOf(record), maxBytes);
      row.content = content.value;
      row.content_omitted = content.omitted;
      row.base_content = base.value;
      row.base_content_omitted = base.omitted;
    }
    return row;
  }

  /**
   * @param {any} doc
   * @param {URLSearchParams} params
   * @param {{ maxBytes?: number }} [options]
   */
  function list(doc, params, { maxBytes } = {}) {
    const type = params.get("type");
    if (type !== null && type !== "result" && type !== "structure") {
      return validationError("type must be result or structure", "type");
    }
    const include = params.get("include");
    if (include !== null && include !== "content") {
      return validationError("include must be content", "include");
    }
    let limit = REVISION_DEFAULT_LIMIT;
    if (params.has("limit")) {
      const raw = params.get("limit");
      limit = /^\d+$/.test(raw) ? Number(raw) : NaN;
      if (!Number.isInteger(limit) || limit < 1 || limit > REVISION_MAX_LIMIT) {
        return validationError(
          `limit must be an integer 1..${REVISION_MAX_LIMIT}`,
          "limit",
        );
      }
    }
    const order = params.get("order") ?? "desc";
    if (order !== "asc" && order !== "desc") {
      return validationError("order must be asc or desc", "order");
    }
    const occurrenceId = params.get("occurrence_id");
    const jobResultId = params.get("job_result_id");
    if (
      type === "structure" &&
      (occurrenceId !== null || jobResultId !== null)
    ) {
      return apiError(
        400,
        "invalid_value",
        "occurrence_id and job_result_id cannot be used with type=structure",
        occurrenceId !== null ? "occurrence_id" : "job_result_id",
      );
    }
    const results = resultsOf(doc);
    if (
      occurrenceId !== null &&
      !results.some(item => item.id === occurrenceId)
    ) {
      return apiError(
        404,
        "result_not_found",
        "Result not found in this job",
        "occurrence_id",
      );
    }
    let jobResultTarget = null;
    if (jobResultId !== null) {
      const match = results.find(
        item => jobResultIdOf(item.id) === jobResultId,
      );
      if (!match) {
        return apiError(
          404,
          "result_not_found",
          "Result not found in this job",
          "job_result_id",
        );
      }
      jobResultTarget = match.id;
    }
    const after = params.get("after");
    const cursor =
      after === null ? null : records.find(record => record.id === after);
    if (after !== null && !cursor) {
      return apiError(400, "invalid_cursor", "Unknown cursor", "after");
    }
    const operationId = params.get("operation_id");

    const sign = order === "asc" ? -1 : 1;
    const filtered = records
      .filter(
        record =>
          (type === null || record.type === type) &&
          (occurrenceId === null ||
            (record.type === "result" && record.target === occurrenceId)) &&
          (jobResultTarget === null ||
            (record.type === "result" && record.target === jobResultTarget)) &&
          (operationId === null || record.operation_id === operationId),
      )
      .sort((a, b) => sign * compareRecords(a, b))
      .filter(record => !cursor || sign * compareRecords(record, cursor) > 0);
    const page = filtered.slice(0, limit);
    const data = page.map(record =>
      rowOf(record, doc, { withContent: include === "content", maxBytes }),
    );
    return {
      status: 200,
      body: {
        object: "list",
        data,
        first_id: data[0]?.id ?? null,
        last_id: data[data.length - 1]?.id ?? null,
        has_more: filtered.length > page.length,
      },
    };
  }

  /**
   * @param {any} doc
   * @param {string} id
   * @param {string | undefined} ifNoneMatch
   * @param {{ maxBytes?: number }} [options]
   */
  function get(doc, id, ifNoneMatch, { maxBytes } = {}) {
    const record = records.find(item => item.id === id);
    if (!record) {
      return {
        ...apiError(404, "revision_not_found", "Revision not found"),
        headers: {},
      };
    }
    const etag = `"rev-${record.id}"`;
    if (ifNoneMatch === etag) {
      return { status: 304, body: null, headers: { ETag: etag } };
    }
    return {
      status: 200,
      body: rowOf(record, doc, { withContent: true, maxBytes }),
      headers: { ETag: etag },
    };
  }

  return {
    jobId,
    collectionId,
    records,
    operations,
    contents,
    machine,
    captureMachine,
    append,
    rowOf,
    list,
    get,
  };
}
