#!/usr/bin/env node
// Upstage 콘솔 API 를 흉내 내는 mock upstream 서버. 앱은 `UPSTAGE_CONSOLE_API_URL=http://127.0.0.1:4010`
// 으로 이 서버를 부른다. `pnpm mock:gen` 이 만든 `dataset.json` 을 읽어 메모리에만 두고, 저장
// (`review-imports`)도 메모리에만 반영한다 — 디스크에 쓰지 않고 재시작하거나 `POST /__mock/reset` 을
// 부르면 처음 상태로 돌아간다. 저장 본문의 `base_version` 이 지금 version 과 다르면 실제 서버처럼 아무것도
// 반영하지 않고 `failed`(`base_version_conflict`)로 끝낸다.
// Job 이 여럿(`--jobs N`)이면 Job 마다 문서·응답·버전을 따로 둔다. `source-jobs` 목록은 `limit`·`after`·
// `order`·`latest` 만 해석하고 `group_by`·`q`·`status` 는 무시한다. Collection 목록은 `is_default`·`listed` 만
// 해석하고 `kind`·`order` 등 다른 쿼리는 무시한다. 목록에는 Collection 관계 화면용 Collection 들
// (`lib/lineage.mjs`)이 함께 나오며 검수할 Job 은 없다.
// Job 변경 이력(`source-jobs/{job}/revisions[/{id}]`)은 Job 마다 메모리 원장(`lib/revisions.mjs`)에 두고,
// 데이터셋의 seed 이력에서 시작해 저장이 반영될 때마다 바뀐 결과·구조마다 행을 더한다. 목록은 `type`·
// `occurrence_id`·`job_result_id`·`operation_id`·`include=content`·`after`·`limit`·`order` 를 해석한다.
// `POST /__mock/revisions-fail?status=429|500&count=N&retry_after=2` 는 이후 revisions 요청 N 개를 그
// 상태로 실패시킨다.
//
//   MOCK_PORT=4010 MOCK_HOST=127.0.0.1 MOCK_LATENCY_MS=0 MOCK_DATA=mock/.generated/dataset.json
//   MOCK_REVISION_CONTENT_MAX_BYTES=(무제한)
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { PORT_TOKEN, pageSvg } from "./lib/dataset.mjs";
import { buildLineageFixture } from "./lib/lineage.mjs";
import { createLedger, structureContent } from "./lib/revisions.mjs";

const PORT = Number(process.env.MOCK_PORT ?? 4010);
const HOST = process.env.MOCK_HOST ?? "127.0.0.1";
const LATENCY_MS = Number(process.env.MOCK_LATENCY_MS ?? 0);
const DATA_PATH = process.env.MOCK_DATA
  ? resolve(process.env.MOCK_DATA)
  : fileURLToPath(new URL("./.generated/dataset.json", import.meta.url));
/** `review-imports` 본문 상한(검수 JSON 16 MiB). */
const MAX_BODY_BYTES = 16 * 1024 * 1024;
const REVIEW_FORMAT = "collection-results/11";
/** revisions `content`·`base_content` 하나의 상한(바이트). 넘으면 `*_omitted: "too_large"`. 기본 무제한. */
const REVISION_CONTENT_MAX_BYTES = process.env.MOCK_REVISION_CONTENT_MAX_BYTES
  ? Number(process.env.MOCK_REVISION_CONTENT_MAX_BYTES)
  : Infinity;

if (!existsSync(DATA_PATH)) {
  console.error(
    `mock 데이터가 없습니다: ${DATA_PATH}\n먼저 pnpm mock:gen 을 실행하세요.`,
  );
  process.exit(1);
}

const dataset = JSON.parse(readFileSync(DATA_PATH, "utf8"));
const { collection: COLLECTION_ID } = dataset.ids;
const withPort = text => text.split(PORT_TOKEN).join(String(PORT));
/** Collection 관계 화면용. 검수 대상 Collection 뒤로 이어진 Collection 들. */
const LINEAGE = buildLineageFixture(dataset.collection);
const LINEAGE_ROWS = new Map(LINEAGE.collections.map(row => [row.id, row]));
const ALL_COLLECTIONS = [LINEAGE.base, ...LINEAGE.collections];

/** Job 1 과 `extraJobs`(Job 2..N)를 같은 모양으로. */
const jobsOf = data => [
  {
    id: data.ids.job,
    sourceJobRow: data.sourceJobRow,
    sourceJobFiles: data.sourceJobFiles,
    reviewDocument: data.reviewDocument,
    jobResponse: data.jobResponse,
    history: data.history ?? null,
  },
  ...(data.extraJobs ?? []).map(job => ({
    ...job,
    id: job.ids.job,
    history: null,
  })),
];
const JOBS = jobsOf(dataset);

/** job id → { version, reviewDocument, jobResponse, ledger, cache: { reviewDocument, jobResponse, sourceJobFiles } } */
function jobState(jobs) {
  return new Map(
    jobs.map(job => [
      job.id,
      {
        version: 1,
        reviewDocument: job.reviewDocument,
        jobResponse: job.jobResponse,
        ledger: createLedger({
          jobId: job.id,
          collectionId: COLLECTION_ID,
          history: job.history,
        }),
        cache: {
          reviewDocument: JSON.stringify(job.reviewDocument),
          jobResponse: JSON.stringify(job.jobResponse),
          sourceJobFiles: JSON.stringify(job.sourceJobFiles),
        },
      },
    ]),
  );
}

/**
 * 저장으로 바뀌는 상태. Job 마다 `version`(review-document 의 ETag)·문서·응답과, 응답 본문을 시작할 때
 * 한 번 직렬화해 둔 문자열(`cache`)을 둔다 — 요청마다 수 MB 를 다시 만들지 않는다.
 */
const state = {
  jobs: jobState(JOBS),
  /** import id → { resource, polls, versions, changes, jobIds, conflicts } */
  imports: new Map(),
  /** Idempotency-Key → import id */
  importsByKey: new Map(),
  importSeq: 0,
  /** revision 행 번호. reset 해도 이어서 매긴다(앱이 기억한 예전 행 id 와 겹치지 않게). */
  revisionSeq: 0,
  /** `__mock/revisions-fail` 이 건 실패 `{ status, remaining, retryAfter }`. */
  revisionFailure: null,
};

/**
 * 저장으로 바뀐 상태를 시작할 때로 되돌린다. `applyImport` 가 문서·응답 객체를 제자리에서 고치므로
 * `DATA_PATH` 를 다시 읽어 새 객체로 만든다. 가져오기 이력과 멱등 키도 비운다(번호는 이어서 매긴다 —
 * 앱이 기억한 예전 가져오기 id 와 겹치지 않게). 데이터셋 파일이 바뀌었어도 Job 목록·파일 같은 읽기
 * 전용 부분은 시작할 때 것을 그대로 쓴다.
 */
function resetState() {
  const fresh = JSON.parse(readFileSync(DATA_PATH, "utf8"));
  state.jobs = jobState(jobsOf(fresh));
  state.imports.clear();
  state.importsByKey.clear();
  state.revisionFailure = null;
}

/** 목록 한 쪽. `offset` 이 있으면 커서는 `cursor:{offset}`(그 행 다음부터)이고 `has_more` 를 채운다. */
const listPage = (rows, { offset = 0, hasMore = false } = {}) => ({
  object: "list",
  data: rows,
  has_more: hasMore,
  first_id: rows[0]?.job_id ?? rows[0]?.id ?? null,
  last_id: rows[rows.length - 1]?.job_id ?? rows[rows.length - 1]?.id ?? null,
  first_cursor: rows.length > 0 ? `cursor:${offset}` : null,
  last_cursor:
    rows.length > 0 && hasMore ? `cursor:${offset + rows.length}` : null,
});

const cache = {
  collection: JSON.stringify(LINEAGE.base),
  capabilities: JSON.stringify(dataset.capabilities),
  files: new Map(
    dataset.files.map(file => [file.id, withPort(JSON.stringify(file))]),
  ),
};

function reserialize(entry) {
  entry.cache.reviewDocument = JSON.stringify(entry.reviewDocument);
  entry.cache.jobResponse = JSON.stringify(entry.jobResponse);
}

const SOURCE_JOB_ROWS = JOBS.map(job => job.sourceJobRow);
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * `source-jobs` 목록. `order`(기본 desc)는 `updated_at` → `job_id` 순, `after` 는 이 서버가 낸
 * `cursor:{offset}`. `latest` 가 `true`/`false` 면 `config.is_latest` 로 거른다(생략하면 전체).
 * 그 밖의 쿼리(`group_by`·`q`·`status`)는 무시한다.
 */
function sourceJobs(url) {
  const params = url.searchParams;
  const limit = params.has("limit")
    ? Number(params.get("limit"))
    : DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return error(
      400,
      "invalid_value",
      `limit must be 1..${MAX_LIMIT}`,
      "limit",
    );
  }
  const order = params.get("order") ?? "desc";
  if (order !== "asc" && order !== "desc") {
    return error(400, "invalid_value", "order must be asc or desc", "order");
  }
  const latest = params.get("latest");
  if (latest !== null && latest !== "true" && latest !== "false") {
    return error(
      400,
      "invalid_value",
      "latest must be true or false",
      "latest",
    );
  }
  let offset = 0;
  const after = params.get("after");
  if (after !== null) {
    const match = /^cursor:(\d+)$/.exec(after);
    if (!match) return error(400, "invalid_value", "invalid cursor", "after");
    offset = Number(match[1]);
  }
  const sign = order === "asc" ? 1 : -1;
  const filtered =
    latest === null
      ? SOURCE_JOB_ROWS
      : SOURCE_JOB_ROWS.filter(
          row => row.config?.is_latest === (latest === "true"),
        );
  const sorted = [...filtered].sort(
    (a, b) =>
      sign *
      (a.updated_at - b.updated_at ||
        (a.job_id < b.job_id ? -1 : a.job_id > b.job_id ? 1 : 0)),
  );
  const rows = sorted.slice(offset, offset + limit);
  return json(
    200,
    listPage(rows, { offset, hasMore: offset + rows.length < sorted.length }),
  );
}

/** Collection 목록. `is_default`·`listed` 가 `true`/`false` 면 그 값으로 거르고, 그 밖의 쿼리는 무시한다. */
function collectionsList(url) {
  let rows = ALL_COLLECTIONS;
  for (const name of ["is_default", "listed"]) {
    const raw = url.searchParams.get(name);
    if (raw === null) continue;
    if (raw !== "true" && raw !== "false") {
      return error(400, "invalid_value", `${name} must be true or false`, name);
    }
    rows = rows.filter(collection => collection[name] === (raw === "true"));
  }
  return json(200, listPage(rows));
}

const JSON_TYPE = "application/json; charset=utf-8";
const NO_STORE = "private, no-store";

function json(status, body, headers = {}) {
  return {
    status,
    headers: {
      "Content-Type": JSON_TYPE,
      "Cache-Control": NO_STORE,
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

function error(status, code, message, param = null, headers = {}) {
  return json(status, { error: { code, type: code, message, param } }, headers);
}

const notFound = (code, message) => error(404, code, message);
const methodNotAllowed = () =>
  error(405, "method_not_allowed", "Method not allowed");

/** 관계 화면이 읽는 `bindings`. 없는 하위 경로면 `null`. */
function lineageRead(collectionId, resource) {
  if (resource === "bindings") {
    return json(200, listPage(LINEAGE.bindings[collectionId] ?? []));
  }
  return null;
}

/** 결과 가져오기 Collection 의 Job 검색. 유형이 여럿이면 `result_type_key` 가 있어야 한다. */
async function lineageJobSearch(req, collectionId) {
  const search = LINEAGE.jobSearch[collectionId];
  if (!search) return json(200, listPage([]));
  const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
  if (!body.result_type_key) {
    return json(400, {
      error: {
        code: "result_type_required",
        type: "invalid_request_error",
        message: "choose one with result_type_key",
        param: "result_type_key",
        details: { result_type_keys: search.resultTypeKeys },
      },
    });
  }
  return json(200, listPage(search.rows));
}

/** 관계 화면의 카드를 눌러 여는 Collection. 목록·상세만 있고 Job 은 없다. */
function lineageCollection(req, collectionId, rest, method) {
  if (rest[2] === "source-jobs" && rest[3] === "search" && rest.length === 4) {
    return method === "POST"
      ? lineageJobSearch(req, collectionId)
      : methodNotAllowed();
  }
  if (!isRead(method)) return methodNotAllowed();
  if (rest.length === 2) return json(200, LINEAGE_ROWS.get(collectionId));
  const read = rest.length === 3 ? lineageRead(collectionId, rest[2]) : null;
  if (read) return read;
  if (rest[2] === "review-capabilities" && rest.length === 3) {
    return json(200, cache.capabilities);
  }
  if (rest[2] === "source-jobs" && rest.length === 3) {
    return LINEAGE_ROWS.get(collectionId)?.source?.type === "result_import"
      ? error(
          409,
          "collection_source_type_unsupported",
          "This Collection source type does not support file-centric rows",
          "collection_id",
        )
      : json(200, listPage(LINEAGE.jobRows[collectionId] ?? []));
  }
  if (rest[2] === "source-jobs" && rest.length === 5 && rest[4] === "files") {
    return LINEAGE.jobCollections.get(rest[3])?.has(collectionId)
      ? json(200, listPage([]))
      : notFound("source_job_not_found", "Source job not found");
  }
  return notFound("not_found", "Not found");
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", chunk => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("body too large"), { tooLarge: true }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

const isResult = item =>
  typeof item === "object" && item !== null && Object.hasOwn(item, "id");

/**
 * 본문이 실은 `base_version` 을 지금 값과 비교한다(실제 서버의 `apply=auto` 처럼 바뀐 값이 같아도
 * version 이 다르면 충돌). 구조는 `file_groups.base_version` 을 그 Job 의 것과, 값은 결과마다 그
 * 결과의 것과 본다. 이 mock 이 모르는 Job·결과는 반영할 때처럼 건너뛴다.
 */
function findConflicts(body) {
  const conflicts = [];
  for (const incoming of Array.isArray(body.jobs) ? body.jobs : []) {
    const entry = state.jobs.get(incoming?.id);
    if (!entry) continue;
    const job = entry.reviewDocument.jobs[0];
    if (incoming.file_groups && typeof incoming.file_groups === "object") {
      const base = incoming.file_groups.base_version ?? null;
      const current = job.file_groups.base_version;
      if (base !== current) {
        conflicts.push({
          target: { kind: "structure", job_id: job.id },
          base,
          current,
        });
      }
    }
    for (const item of Array.isArray(incoming.output) ? incoming.output : []) {
      if (!isResult(item) || typeof item.id !== "string") continue;
      const existing = job.output.find(
        candidate => isResult(candidate) && candidate.id === item.id,
      );
      if (!existing) continue;
      const base = item.base_version ?? null;
      if (base !== existing.base_version) {
        conflicts.push({
          target: { kind: "value", job_id: job.id, occurrence_id: item.id },
          base,
          current: existing.base_version,
        });
      }
    }
  }
  return conflicts;
}

/**
 * 업로드 본문을 메모리 문서에 반영한다. 결과는 `content` 교체 + `base_version + 1`, `file_groups` 를
 * 보냈으면 구조·문서 배치 보기를 교체 + `base_version + 1`(읽기 전용 `num_pages`·`input_index` 는
 * 원래 파일에서 되살린다). Job 응답의 같은 결과 메시지 본문도 바꿔 "검수값이 반영된 응답" 을 유지한다.
 * 먼저 `findConflicts` 로 모든 Job 을 본 뒤, 충돌이 하나라도 있으면 아무것도 바꾸지 않고 그 목록을
 * 돌려준다(전부 반영하거나 아무것도 반영하지 않음). 반영했으면 Job 마다 바뀐 결과·구조를 이력 원장에
 * 행으로 남긴다(같은 가져오기 = 같은 `operation`, `published_at` 은 `publishedAt`). 처음 편집되는
 * 대상(`base_version` 0)은 덮어쓰기 전 내용을 기계 출력으로 박제한다.
 */
function applyImport(body, { operationId, publishedAt }) {
  const conflicts = findConflicts(body);
  if (conflicts.length > 0) {
    const jobIds = (Array.isArray(body.jobs) ? body.jobs : [])
      .map(incoming => incoming?.id)
      .filter(id => state.jobs.has(id));
    return { versions: {}, changes: 0, jobIds, conflicts };
  }
  const versions = {};
  let changes = 0;
  const changed = new Set();
  const jobIds = [];
  /** entry → revision 변경 목록 */
  const revisionChanges = new Map();
  for (const incoming of Array.isArray(body.jobs) ? body.jobs : []) {
    const entry = state.jobs.get(incoming?.id);
    if (!entry) continue;
    const job = entry.reviewDocument.jobs[0];
    jobIds.push(job.id);
    const changesBefore = changes;
    const output = Array.isArray(incoming.output) ? incoming.output : [];
    const jobRevisions = [];

    if (incoming.file_groups && typeof incoming.file_groups === "object") {
      if (job.file_groups.base_version === 0) {
        entry.ledger.captureMachine(job, null);
      }
      const nextVersion = job.file_groups.base_version + 1;
      const original = new Map(
        job.file_groups.groups
          .flatMap(group => group.files)
          .map(file => [file.file_ref, file]),
      );
      const groups = (incoming.file_groups.groups ?? []).map(group => ({
        group_id: group.group_id,
        files: (group.files ?? []).map(file => {
          const known = original.get(file.file_ref);
          return known
            ? {
                ...file,
                num_pages: known.num_pages,
                input_index: known.input_index,
              }
            : { ...file };
        }),
        layout_step_id: group.layout_step_id ?? null,
      }));
      job.file_groups = {
        base_version: nextVersion,
        groups,
        excluded_pages: incoming.file_groups.excluded_pages ?? [],
        excluded_documents: incoming.file_groups.excluded_documents ?? [],
      };
      const layouts = output
        .filter(
          item => typeof item === "object" && item !== null && !isResult(item),
        )
        .map(item => ({ ...item, base_version: nextVersion }));
      job.output =
        layouts.length > 0
          ? [...layouts, ...job.output.filter(isResult)]
          : job.output.map(item =>
              isResult(item) ? item : { ...item, base_version: nextVersion },
            );
      versions[`s:${job.id}`] = nextVersion;
      changes += 1;
      jobRevisions.push({
        type: "structure",
        target: job.id,
        version: nextVersion,
        base_version: nextVersion - 1,
        content: structureContent(job),
        documents: null,
      });
    }

    for (const item of output) {
      if (!isResult(item) || typeof item.id !== "string") continue;
      const index = job.output.findIndex(
        existing => isResult(existing) && existing.id === item.id,
      );
      if (index < 0) continue;
      const current = job.output[index];
      if (current.base_version === 0) entry.ledger.captureMachine(job, current);
      const next = {
        ...current,
        content: item.content,
        base_version: current.base_version + 1,
      };
      // 사람이 판정을 고치면 기계 판정 근거는 사라진다.
      delete next.checks;
      job.output[index] = next;
      versions[`v:${item.id}`] = next.base_version;
      changes += 1;
      jobRevisions.push({
        type: "result",
        target: item.id,
        version: next.base_version,
        base_version: current.base_version,
        content: item.content,
        documents: linkedDocs(job, next),
      });
      const message = entry.jobResponse.output.find(
        candidate => candidate.id === item.id,
      );
      if (message?.content?.[0])
        message.content[0].text = JSON.stringify(item.content);
    }
    if (changes > changesBefore) changed.add(entry);
    if (jobRevisions.length > 0) revisionChanges.set(entry, jobRevisions);
  }
  for (const entry of changed) {
    entry.version += 1;
    reserialize(entry);
  }
  const operation = {
    id: operationId,
    kind: "import",
    change_count: changes,
    collection_id: COLLECTION_ID,
    from_this_collection: true,
    reason: null,
    client_reference: null,
  };
  for (const [entry, jobRevisions] of revisionChanges) {
    entry.ledger.append({
      operation,
      changes: jobRevisions.map(change => ({
        ...change,
        id: `rvn_mock_${String(++state.revisionSeq).padStart(6, "0")}`,
      })),
      publishedAt,
    });
  }
  return { versions, changes, jobIds, conflicts };
}

/** 결과가 가리키는 문서 중 지금 Classify 보기에 있는 것(`field_group` 은 실서버처럼 빈 문자열). */
function linkedDocs(job, result) {
  const labels = new Map(
    job.output
      .filter(
        item => !isResult(item) && Array.isArray(item?.content?.documents),
      )
      .flatMap(layout => layout.content.documents)
      .map(doc => [doc.document_id, doc.label]),
  );
  return (Array.isArray(result.document_ids) ? result.document_ids : [])
    .filter(id => labels.has(id))
    .map(id => ({ document_id: id, label: labels.get(id), field_group: "" }));
}

function importResource(entry) {
  const { resource, polls, versions, changes, jobIds, conflicts } = entry;
  const done = polls >= 2;
  const conflicted = conflicts.length > 0;
  const finalStatus = conflicted
    ? "failed"
    : changes === 0
      ? "no_change"
      : "applied";
  const failed = done && conflicted;
  return {
    ...resource,
    status: polls === 0 ? "pending" : done ? finalStatus : "applying",
    progress: { units_done: done && !conflicted ? 1 : 0, units_total: 1 },
    units: [
      {
        unit_no: 0,
        job_ids: jobIds,
        status: done ? (conflicted ? "conflict" : "applied") : "pending",
        applied_versions: done && !conflicted ? versions : null,
        copy_id_map: null,
        error: null,
      },
    ],
    error: failed
      ? {
          code: "base_version_conflict",
          message: "Another review was published first",
          details: { conflicts },
        }
      : null,
    updated_at: nowSeconds(),
    published_at: done && !conflicted ? entry.publishedAt : null,
  };
}

async function createImport(req, url) {
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string" || key === "") {
    return error(
      400,
      "invalid_value",
      "Idempotency-Key header is required",
      "Idempotency-Key",
    );
  }
  const existingId = state.importsByKey.get(key);
  if (existingId) {
    const entry = state.imports.get(existingId);
    return json(202, importResource(entry), { "Retry-After": "1" });
  }
  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    return err?.tooLarge
      ? error(
          413,
          "package_limit_exceeded",
          `Body must be ${MAX_BODY_BYTES} bytes or smaller`,
        )
      : error(400, "invalid_value", "Could not read request body");
  }
  if (body.length === 0)
    return error(400, "invalid_value", "Request body is empty");
  let parsed;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    return error(400, "invalid_value", "Request body is not valid JSON");
  }
  if (parsed?.format !== REVIEW_FORMAT) {
    return error(
      422,
      "unsupported_review_format",
      `format must be ${REVIEW_FORMAT}`,
      "/format",
    );
  }
  if (parsed.collection_id !== COLLECTION_ID) {
    return error(
      422,
      "review_target_mismatch",
      "collection_id does not match",
      "/collection_id",
    );
  }
  state.importSeq += 1;
  const id = `rvop_mock_${state.importSeq}`;
  const publishedAt = nowSeconds();
  const { versions, changes, jobIds, conflicts } = applyImport(parsed, {
    operationId: id,
    publishedAt,
  });
  const created = publishedAt;
  const entry = {
    resource: {
      id,
      object: "search_collection.review_import",
      collection_id: COLLECTION_ID,
      bytes: body.length,
      apply: url.searchParams.get("apply") ?? "manual",
      reason: null,
      client_reference: null,
      preview: null,
      error: null,
      created_at: created,
      expires_at: created + 7 * 24 * 3600,
    },
    polls: 0,
    publishedAt,
    versions,
    changes,
    jobIds,
    conflicts,
  };
  state.imports.set(id, entry);
  state.importsByKey.set(key, id);
  return json(202, importResource(entry), {
    Location: `/v2/search-collections/${COLLECTION_ID}/review-imports/${id}`,
    "Retry-After": "1",
  });
}

function getImport(importId) {
  const entry = state.imports.get(importId);
  if (!entry)
    return notFound("review_import_not_found", "Review import not found");
  entry.polls += 1;
  const resource = importResource(entry);
  const headers = { ETag: `"${importId}-${entry.polls}"` };
  if (entry.polls < 2) headers["Retry-After"] = "1";
  return json(200, resource, headers);
}

function reviewDocument(req, url) {
  const jobIds = url.searchParams.getAll("job_ids");
  if (jobIds.length === 0)
    return error(400, "invalid_value", "job_ids is required", "job_ids");
  // 이 mock 은 Job 하나씩만 준다(앱도 Job 화면마다 하나만 요청한다).
  const entry = jobIds.length === 1 ? state.jobs.get(jobIds[0]) : undefined;
  if (!entry) {
    return notFound(
      "review_target_not_found",
      "Job is not a completed job of this collection",
    );
  }
  const etag = `"mock-${jobIds[0]}-${entry.version}"`;
  const headers = { ETag: etag, "Cache-Control": "private, no-cache" };
  if (req.headers["if-none-match"] === etag) {
    return { status: 304, headers, body: null };
  }
  return json(200, entry.cache.reviewDocument, headers);
}

/** Job 변경 이력 목록. 검증·정렬·keyset 은 원장(`lib/revisions.mjs`)이 한다. */
function revisionsList(entry, url) {
  const { status, body } = entry.ledger.list(
    entry.reviewDocument,
    url.searchParams,
    { maxBytes: REVISION_CONTENT_MAX_BYTES },
  );
  return json(status, body);
}

/** Job 변경 이력 한 건(내용 포함). `ETag: "rev-{id}"`, `If-None-Match` 가 같으면 304. */
function revisionGet(req, entry, revisionId) {
  const { status, body, headers } = entry.ledger.get(
    entry.reviewDocument,
    revisionId,
    req.headers["if-none-match"],
    { maxBytes: REVISION_CONTENT_MAX_BYTES },
  );
  if (status === 304) {
    return {
      status,
      headers: { ...headers, "Cache-Control": NO_STORE },
      body: null,
    };
  }
  return json(status, body, headers);
}

/** `__mock/revisions-fail` 쿼리 → `{ value }` 또는 `{ error }`. */
function revisionFailureOf(url) {
  const params = url.searchParams;
  const status = Number(params.get("status") ?? "429");
  if (status !== 429 && status !== 500) {
    return {
      error: error(400, "invalid_value", "status must be 429 or 500", "status"),
    };
  }
  const count = Number(params.get("count") ?? "1");
  if (!Number.isInteger(count) || count < 1) {
    return {
      error: error(
        400,
        "invalid_value",
        "count must be a positive integer",
        "count",
      ),
    };
  }
  const retryAfter = Number(params.get("retry_after") ?? "2");
  if (!Number.isInteger(retryAfter) || retryAfter < 0) {
    return {
      error: error(
        400,
        "invalid_value",
        "retry_after must be a non-negative integer",
        "retry_after",
      ),
    };
  }
  return { value: { status, remaining: count, retryAfter } };
}

/** 걸린 실패가 남아 있으면 하나를 쓰고 그 오류 응답을, 없으면 `null`. */
function takeRevisionFailure() {
  const failure = state.revisionFailure;
  if (!failure) return null;
  failure.remaining -= 1;
  if (failure.remaining <= 0) state.revisionFailure = null;
  const busy = failure.status === 429;
  return error(
    failure.status,
    busy ? "operation_capacity_exceeded" : "internal_error",
    busy ? "Too many concurrent operations" : "Injected mock failure",
    null,
    { "Retry-After": String(failure.retryAfter) },
  );
}

function isAuthorized(req) {
  return /^Bearer\s+\S+/.test(req.headers.authorization ?? "");
}

const isRead = method => method === "GET" || method === "HEAD";

async function route(req, url) {
  const method = req.method ?? "GET";
  const segments = url.pathname
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);

  // 페이지 이미지: 브라우저 <img> 가 직접 받으므로 인증 없음.
  if (segments[0] === "pages") {
    if (segments.length !== 3 || !segments[2].endsWith(".svg")) {
      return notFound("not_found", "Not found");
    }
    if (!isRead(method)) return methodNotAllowed();
    const page = Number(segments[2].slice(0, -".svg".length));
    const svg = pageSvg(dataset, segments[1], page);
    if (svg === null) return notFound("not_found", "Page image not found");
    return {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "no-store",
      },
      body: svg,
    };
  }

  // mock 전용: 저장으로 바뀐 상태를 처음으로(스모크·데모 뒤 되돌리기). 인증은 `/v2` 와 같다.
  // `revisions-fail` 은 이후 revisions 요청 N 개를 실패시킨다(재시도 안내 확인용).
  if (segments[0] === "__mock") {
    const action = segments.length === 2 ? segments[1] : null;
    if (action !== "reset" && action !== "revisions-fail")
      return notFound("not_found", "Not found");
    if (!isAuthorized(req)) {
      return error(401, "unauthorized", "Missing or invalid API key");
    }
    if (method !== "POST") return methodNotAllowed();
    if (action === "reset") resetState();
    else {
      const failure = revisionFailureOf(url);
      if (failure.error) return failure.error;
      state.revisionFailure = failure.value;
    }
    return { status: 204, headers: { "Cache-Control": NO_STORE }, body: null };
  }

  if (segments[0] !== "v2") return notFound("not_found", "Not found");
  if (!isAuthorized(req)) {
    return error(401, "unauthorized", "Missing or invalid API key");
  }
  const rest = segments.slice(1);

  if (rest[0] === "files") {
    if (rest.length !== 2) return notFound("not_found", "Not found");
    if (!isRead(method)) return methodNotAllowed();
    const file = cache.files.get(rest[1]);
    return file
      ? json(200, file)
      : notFound("file_not_found", "File not found");
  }

  if (rest[0] === "agents") {
    if (rest.length !== 4 || rest[2] !== "configs")
      return notFound("not_found", "Not found");
    if (!isRead(method)) return methodNotAllowed();
    if (rest[1] === LINEAGE.hiddenAgent) {
      return error(403, "forbidden", "This agent is not accessible");
    }
    const config = LINEAGE.configs.get(rest[3]);
    return config?.agent_id === rest[1]
      ? json(200, config)
      : notFound("config_not_found", "Config not found");
  }

  if (rest[0] === "responses") {
    if (rest.length !== 2) return notFound("not_found", "Not found");
    if (!isRead(method)) return methodNotAllowed();
    const job = LINEAGE.jobs.get(rest[1]);
    const visible =
      job &&
      (!job.is_deleted || url.searchParams.get("include_deleted") === "true");
    return visible
      ? json(200, { object: "response", status: "completed", ...job })
      : notFound("response_not_found", "Response not found");
  }

  if (rest[0] !== "search-collections")
    return notFound("not_found", "Not found");
  if (rest.length === 1)
    return isRead(method) ? collectionsList(url) : methodNotAllowed();
  if (LINEAGE_ROWS.has(rest[1])) {
    return lineageCollection(req, rest[1], rest, method);
  }
  if (rest[1] !== COLLECTION_ID) {
    return notFound("collection_not_found", "Collection not found");
  }
  if (rest.length === 2)
    return isRead(method) ? json(200, cache.collection) : methodNotAllowed();

  switch (rest[2]) {
    case "bindings":
      if (rest.length !== 3) break;
      return isRead(method)
        ? lineageRead(COLLECTION_ID, rest[2])
        : methodNotAllowed();
    case "review-capabilities":
      if (rest.length !== 3) break;
      return isRead(method)
        ? json(200, cache.capabilities)
        : methodNotAllowed();
    case "review-document":
      if (rest.length !== 3) break;
      return isRead(method) ? reviewDocument(req, url) : methodNotAllowed();
    case "review-imports":
      if (rest.length === 3) {
        return method === "POST" ? createImport(req, url) : methodNotAllowed();
      }
      if (rest.length === 4)
        return isRead(method) ? getImport(rest[3]) : methodNotAllowed();
      break;
    case "source-jobs":
      if (!isRead(method)) return methodNotAllowed();
      if (rest.length === 3) return sourceJobs(url);
      if (rest[4] === "revisions" && (rest.length === 5 || rest.length === 6)) {
        const failure = takeRevisionFailure();
        if (failure) return failure;
        const entry = state.jobs.get(rest[3]);
        if (!entry)
          return notFound("source_job_not_found", "Source job not found");
        return rest.length === 5
          ? revisionsList(entry, url)
          : revisionGet(req, entry, rest[5]);
      }
      if (rest.length !== 5) break;
      {
        const entry = state.jobs.get(rest[3]);
        if (!entry)
          return notFound("source_job_not_found", "Source job not found");
        if (rest[4] === "files") return json(200, entry.cache.sourceJobFiles);
        if (rest[4] === "response") return json(200, entry.cache.jobResponse);
      }
      break;
    default:
      break;
  }
  return notFound("not_found", "Not found");
}

function send(req, res, result) {
  const body = result.body === null ? null : Buffer.from(result.body, "utf8");
  const headers = { ...result.headers };
  if (body !== null) headers["Content-Length"] = String(body.length);
  res.writeHead(result.status, headers);
  if (body === null || req.method === "HEAD") res.end();
  else res.end(body);
}

const server = createServer(async (req, res) => {
  const started = performance.now();
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
  let result;
  try {
    result = await route(req, url);
  } catch (err) {
    result = error(
      500,
      "internal_error",
      err instanceof Error ? err.message : String(err),
    );
  }
  if (LATENCY_MS > 0) await sleep(LATENCY_MS);
  send(req, res, result);
  const bytes = result.body === null ? 0 : Buffer.byteLength(result.body);
  console.log(
    `${req.method} ${url.pathname}${url.search} ${result.status} ${bytes}B ${Math.round(performance.now() - started)}ms`,
  );
});

server.listen(PORT, HOST, () => {
  const documents = dataset.documents.length;
  console.log(
    `mock upstream listening on http://${HOST}:${PORT} — ${DATA_PATH} (${dataset.totalPages} pages, ${documents} documents, ${dataset.files.length} file(s), ${JOBS.length} job(s))`,
  );
  if (LATENCY_MS > 0) console.log(`  latency ${LATENCY_MS} ms per response`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}
