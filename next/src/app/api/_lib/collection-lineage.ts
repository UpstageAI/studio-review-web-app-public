import "server-only";

import type {
  CollectionLineage,
  CollectionLineageEdge,
  CollectionLineageNode,
  JobRow,
  ListPage,
  SearchCollectionSummary,
} from "@/lib/review-api/types";
import {
  listSearchCollections,
  listSourceJobFiles,
  listSourceJobs,
} from "@/lib/upstage/collections";
import { UpstreamNetworkError } from "@/lib/upstage/errors";
import {
  getAgentConfig,
  getJobResponse,
  listCollectionBindings,
  searchSourceJobs,
} from "@/lib/upstage/lineage";

import { readTextWithin } from "./bounded-body";
import { createTtlCache } from "./ttl-cache";
import { errorResponse } from "./upstream-relay";

// Collection 사이의 연결을 upstream 여러 곳에서 모아 만든다. upstream 에는 이 관계를 한 번에 주는
// API 가 없다.
//
// - Import 노드: 결과가 있는 Collection 마다 결과를 쓴 Config 를 찾고(`bindings`, 기본 Collection 은
//   Job 행도), 그 Config 에 Import Step 이 있으면 그 원본 Collection 에서 이 Collection 으로 잇는다.
// - 결과 가져오기(`result_import`): 숨은 Agent 의 Config 는 읽을 수 없어 Job 을 따라간다. 이 Collection
//   의 Job 에서 `source_job_id` 를 따라 올라가 만난 원본 Job 을, 그 Agent 가 결과를 쓴 Collection 중에서 찾는다.
//
// Agent 가 많은 계정은 호출이 수백 번이 되므로 결과가 있는 Collection 만 보고, 읽은 결과는 서버
// 메모리에 둔다. 다 못 읽으면 응답으로 알린다. 다시 읽으면 나아질 수 있으면 `partial`(상한, 5xx, 429),
// 그렇지 않으면 `unverified_count`(4xx, 볼 수 없는 Workflow 등)다.

/** 목록을 읽는 최대 페이지 수(페이지당 100 개). */
const MAX_LIST_PAGES = 10;
const PAGE_SIZE = 100;
/** Collection 하나의 `bindings` 를 읽는 최대 페이지 수(페이지당 100 행). */
const MAX_BINDING_PAGES = 5;
/** 연결을 찾아볼 Collection 수 상한(결과가 있는 것만, 목록 순서). */
const MAX_SCANNED_COLLECTIONS = 300;
/** upstream 동시 호출 수. 8 에서는 호출 100 회쯤부터 게이트웨이가 429 를 돌려준다. */
const SCAN_CONCURRENCY = 6;
/**
 * 한 요청이 새 Collection 을 읽기 시작할 수 있는 시간. 목록을 다 읽은 뒤부터 잰다. 목록은 캐시되지 않아
 * 큰 계정에서 이 시간을 먼저 쓰면 다시 읽어도 연결 탐색이 나아가지 못한다. 넘으면 진행 중인 호출만
 * 끝내고 읽은 데까지 돌려주며, 다음 요청이 캐시 위에서 이어 간다.
 */
const SCAN_BUDGET_MS = 30_000;
const RATE_LIMIT_RETRIES = 2;
const MAX_RETRY_WAIT_MS = 3_000;
/** 결과 가져오기가 거듭되어도 따라 올라가는 Job 단계 상한(upstream 도 8 단계까지 본다). */
const MAX_RESULT_IMPORT_DEPTH = 8;
const MAX_JSON_BYTES = 8 * 1024 * 1024;
/** Job 응답은 Parse 그림을 품어 크다(`source-jobs/{jobId}/response` 와 같은 상한). */
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;

const SCANNED_ENTRY_TTL_MS = 10 * 60_000;
const CONFIG_TTL_MS = 60 * 60_000;
const RESULT_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 2_000;

type LineageRow = SearchCollectionSummary & {
  table_key?: string | null;
  source_agent?: { id?: string | null; name?: string | null } | null;
};

interface BindingRow {
  agent_id?: string | null;
  config_id?: string | null;
  boundary_kind?: string | null;
  completed_job_count?: number | null;
}

/** 이 Collection 에 완료 결과를 쓴 Agent 의 Config 하나. */
interface Writer {
  agentId: string;
  configId: string;
  /** 결과 경계가 `export_input` 이다. Collection Export 뿐 아니라 Review, HTTP Export 앞에서도 나온다. */
  exportInput: boolean;
  /** `bindings` 가 아니라 Job 행에서 찾았다. 결과 경계를 모른다. */
  fromJobRow?: boolean;
}

interface RawEdge extends CollectionLineageEdge {
  mirror: boolean;
}

interface ConfigRead {
  /** Import Step 이 가리키는 Collection */
  sources: string[];
  hasCollectionExport: boolean;
  /** `false` 면 upstream 이 거부해 내용을 모른다 */
  readable: boolean;
}

interface ScannedCollection {
  writers: Writer[];
  edges: RawEdge[];
  /** 결과를 쓴 Config 중 내용을 볼 수 없는 것이 있다. */
  unverified: boolean;
}

/** 목록 첫 페이지를 받지 못했다. 응답을 그대로 전달할 수 있게 담는다. */
export class LineageListError extends Error {
  constructor(readonly response: Response) {
    super("collection list could not be read");
  }
}

const scannedCache = createTtlCache<ScannedCollection>({
  ttlMs: SCANNED_ENTRY_TTL_MS,
  maxEntries: MAX_CACHE_ENTRIES,
});
/** Config 는 저장 뒤 바뀌지 않는다. */
const configCache = createTtlCache<ConfigRead>({
  ttlMs: CONFIG_TTL_MS,
  maxEntries: MAX_CACHE_ENTRIES,
});
const pendingConfigReads = new Map<string, Promise<ConfigRead | null>>();
/** 결과 가져오기 Collection → 원본 Collection id(찾지 못했으면 `null`). */
const resultSourceCache = createTtlCache<{ id: string | null }>({
  ttlMs: SCANNED_ENTRY_TTL_MS,
  maxEntries: MAX_CACHE_ENTRIES,
});
const resultCache = createTtlCache<CollectionLineage>({
  ttlMs: RESULT_TTL_MS,
  maxEntries: 1,
});
let inflight: Promise<CollectionLineage> | null = null;

/** 테스트용: 서버 메모리 캐시를 비운다. */
export function clearCollectionLineageCache(): void {
  scannedCache.clear();
  configCache.clear();
  pendingConfigReads.clear();
  resultSourceCache.clear();
  resultCache.clear();
  inflight = null;
}

/** 테스트용: 전체 결과만 비워 다음 요청이 Collection 별 캐시 위에서 다시 모으게 한다. */
export function clearCollectionLineageResultCache(): void {
  resultCache.clear();
}

/**
 * Import Step `data` 에서 원본 Collection id 를 읽는다. 세 형식 `collection_id`(이전 단일),
 * `collection_ids`, `sources[].collection_id`(형태 선택)를 모두 받는다.
 */
export function importSourceIds(data: unknown): string[] {
  if (typeof data !== "object" || data === null) return [];
  const { collection_id, collection_ids, sources } = data as Record<
    string,
    unknown
  >;
  const ids: unknown[] = [
    collection_id,
    ...(Array.isArray(collection_ids) ? collection_ids : []),
    ...(Array.isArray(sources)
      ? sources.map(
          source => (source as { collection_id?: unknown })?.collection_id,
        )
      : []),
  ];
  const valid = ids.filter(
    (id): id is string => typeof id === "string" && id !== "",
  );
  return [...new Set(valid)];
}

function configSteps(config: unknown): unknown[] {
  const steps = (config as { steps?: unknown } | null)?.steps;
  return Array.isArray(steps) ? steps : [];
}

const stepType = (step: unknown) => (step as { type?: unknown })?.type;

/** 결과를 Collection 에 쓰는 Export. `destination` 이 있는 HTTP Export 는 밖으로 보내기만 한다. */
function isCollectionExport(step: unknown): boolean {
  if (stepType(step) !== "export") return false;
  const { data } = step as { data?: unknown };
  return !(typeof data === "object" && data !== null && "destination" in data);
}

/** Config 응답의 Import Step 들이 가리키는 원본 Collection id. */
export function configImportSources(config: unknown): string[] {
  const imports = configSteps(config).filter(
    step => stepType(step) === "import",
  );
  return [
    ...new Set(
      imports.flatMap(step =>
        importSourceIds((step as { data?: unknown }).data),
      ),
    ),
  ];
}

/**
 * 같은 연결을 하나로 합치고 자기 자신을 잇는 연결을 버린다. 기본 Collection 사본과 Collection 목록에
 * 없는 Collection(`hidden`, 자동으로 만든 기본 Collection)으로 가는 연결은 그 Collection 이 다시 원본으로
 * 쓰일 때만 남긴다. 사본까지 그리면 Workflow 마다 같은 결과가 가지 하나로 더 생겨 흐름을 가리고, 목록에
 * 없는 Collection 은 체인을 잇는 데 필요할 때만 보인다. 지운 연결 때문에 다시 끝이 되는 곳이 없을 때까지 반복한다.
 */
export function finalizeEdges(
  raw: readonly RawEdge[],
  hidden: ReadonlySet<string> = new Set(),
): CollectionLineageEdge[] {
  const unique = new Map<string, RawEdge>();
  for (const edge of raw) {
    if (edge.from === edge.to) continue;
    const key = JSON.stringify([edge.from, edge.to, edge.kind, edge.workflow]);
    const known = unique.get(key);
    // 같은 연결이 사본과 Export 양쪽으로 들어오면 사본이 아니다.
    if (!known || known.mirror) unique.set(key, edge);
  }
  let kept = [...unique.values()];
  for (;;) {
    const sources = new Set(
      kept.filter(edge => !edge.mirror).map(edge => edge.from),
    );
    const next = kept.filter(
      edge => !(edge.mirror || hidden.has(edge.to)) || sources.has(edge.to),
    );
    if (next.length === kept.length) break;
    kept = next;
  }
  return kept.map(({ from, to, kind, workflow }) => ({
    from,
    to,
    kind,
    workflow,
  }));
}

/** 원본 Job 을 가졌을 가능성이 높은 Collection 부터 줄 세운다. 스냅샷은 원본의 `table_key` 를 물려받는다. */
export function rankSourceCandidates<
  T extends Pick<LineageRow, "table_key" | "is_default">,
>(candidates: readonly T[], target: Pick<LineageRow, "table_key">): T[] {
  const rank = (row: T) =>
    (row.table_key && row.table_key === target.table_key ? 0 : 2) +
    (row.is_default ? 1 : 0);
  return [...candidates].sort((a, b) => rank(a) - rank(b));
}

interface Scan {
  deadline: number;
  /** 다시 읽으면 나아질 수 있는데 읽지 못한 곳이 있었다. */
  partial: boolean;
  /** 다시 읽어도 소용없는 이유로 연결을 확인하지 못한 Collection. */
  unverified: Set<string>;
}

type Read<T> =
  | { status: "ok"; body: T }
  /** upstream 이 요청을 거부했다(429 를 뺀 4xx). 다시 불러도 같다 */
  | { status: "rejected"; code: string | null; details: unknown }
  | { status: "failed" };

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function retryWaitMs(response: Response): number {
  const seconds = Number(response.headers.get("retry-after"));
  const ms = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000;
  return Math.min(ms, MAX_RETRY_WAIT_MS);
}

/** upstream 을 부른다. 429 는 잠시 뒤 다시 부르고, 그래도 429 면 그 응답을 돌려준다. */
async function callWithRetry(call: () => Promise<Response>): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await call();
    if (response.status !== 429 || attempt >= RATE_LIMIT_RETRIES) {
      return response;
    }
    await response.body?.cancel().catch(() => undefined);
    await wait(retryWaitMs(response));
  }
}

/** 본문을 읽는다. 상한을 넘거나 읽다가 끊기면 `null`. */
async function readBody(
  response: Response,
  maxBytes: number,
): Promise<string | null> {
  try {
    return await readTextWithin(response, maxBytes);
  } catch {
    return null;
  }
}

function parseJson<T>(text: string | null): T | null {
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** upstream 을 불러 JSON 을 읽는다. 설정 오류처럼 스캔을 이어 갈 수 없는 오류는 그대로 던진다. */
async function readUpstream<T>(
  call: () => Promise<Response>,
  maxBytes = MAX_JSON_BYTES,
): Promise<Read<T>> {
  let response: Response;
  try {
    response = await callWithRetry(call);
  } catch (err) {
    if (err instanceof UpstreamNetworkError) return { status: "failed" };
    throw err;
  }
  if (response.ok) {
    const body = parseJson<T>(await readBody(response, maxBytes));
    return body === null ? { status: "failed" } : { status: "ok", body };
  }
  if (response.status >= 400 && response.status < 500) {
    if (response.status === 429) {
      await response.body?.cancel().catch(() => undefined);
      return { status: "failed" };
    }
    const error = parseJson<{ error?: { code?: string; details?: unknown } }>(
      await readBody(response, MAX_JSON_BYTES),
    )?.error;
    return {
      status: "rejected",
      code: error?.code ?? null,
      details: error?.details,
    };
  }
  await response.body?.cancel().catch(() => undefined);
  return { status: "failed" };
}

/** `SCAN_CONCURRENCY` 개씩 동시에 처리한다. 시간 상한을 넘으면 남은 항목은 건너뛰고 `partial` 을 표시한다. */
async function forEachPooled<T>(
  items: readonly T[],
  scan: Scan,
  visit: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      if (Date.now() >= scan.deadline) {
        scan.partial = true;
        return;
      }
      const item = items[next];
      next += 1;
      await visit(item);
    }
  };
  await Promise.all(Array.from({ length: SCAN_CONCURRENCY }, worker));
}

async function listCollections(scan: Scan): Promise<LineageRow[]> {
  const rows: LineageRow[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const cursor = after;
    let response: Response;
    try {
      response = await callWithRetry(() =>
        listSearchCollections({
          kind: "documents",
          include_default: true,
          limit: PAGE_SIZE,
          after: cursor,
        }),
      );
    } catch (err) {
      if (page === 0 || !(err instanceof UpstreamNetworkError)) throw err;
      scan.partial = true;
      return rows;
    }
    if (!response.ok) {
      if (page === 0) throw new LineageListError(response);
      await response.body?.cancel().catch(() => undefined);
      scan.partial = true;
      return rows;
    }
    const body = parseListPage(await readBody(response, MAX_JSON_BYTES));
    if (!body) {
      if (page === 0) {
        throw new LineageListError(
          errorResponse(
            502,
            "upstream_error",
            "Upstage API returned an invalid collection list",
          ),
        );
      }
      scan.partial = true;
      return rows;
    }
    rows.push(...body.data);
    if (!body.has_more || !body.last_cursor) return rows;
    after = body.last_cursor;
  }
  scan.partial = true;
  return rows;
}

function parseListPage(text: string | null): ListPage<LineageRow> | null {
  const body = parseJson<ListPage<LineageRow>>(text);
  return Array.isArray(body?.data) ? body : null;
}

function addWriter(writers: Map<string, Writer>, binding: BindingRow): void {
  const { agent_id: agentId, config_id: configId } = binding;
  if (!agentId || !configId || !binding.completed_job_count) return;
  const exportInput = binding.boundary_kind === "export_input";
  // 한 Config 가 Export 와 다른 경계로 함께 쓰면 사본으로 치지 않는다.
  if (!writers.has(configId) || !exportInput) {
    writers.set(configId, { agentId, configId, exportInput });
  }
}

/**
 * Workflow 에 연결된 Collection 의 스키마 없는 결과(Import → Instruct, Merge 로 끝나는 경로)는
 * `bindings` 에 없으므로 최근 Job 행의 Config 도 본다. 이미 찾은 Config 는 건너뛴다. 읽지 못하면 `false`.
 */
async function addJobRowWriters(
  row: LineageRow,
  writers: Map<string, Writer>,
): Promise<boolean> {
  const agentId = row.source_agent?.id;
  if (row.source?.type !== "agent_link" || !agentId) return true;
  const read = await readUpstream<ListPage<JobRow>>(() =>
    listSourceJobs(row.id, { status: "completed", limit: PAGE_SIZE }),
  );
  if (read.status === "failed") return false;
  if (read.status === "rejected") return true;
  for (const job of read.body.data ?? []) {
    const configId = job.config?.id;
    if (configId && !writers.has(configId)) {
      writers.set(configId, {
        agentId,
        configId,
        exportInput: false,
        fromJobRow: true,
      });
    }
  }
  return true;
}

/**
 * 이 Collection 에 완료 결과를 쓴 Config. Config 버전마다 행이 있어 페이지를 이어 읽는다. 중간에
 * 실패하거나 페이지 상한을 넘으면 읽은 데까지 돌려주고 `complete` 를 끈다.
 */
async function readWriters(
  row: LineageRow,
): Promise<{ writers: Writer[]; complete: boolean }> {
  const writers = new Map<string, Writer>();
  let complete = false;
  let after: string | undefined;
  for (let page = 0; page < MAX_BINDING_PAGES; page += 1) {
    const cursor = after;
    const read = await readUpstream<ListPage<BindingRow>>(() =>
      listCollectionBindings(row.id, { limit: PAGE_SIZE, after: cursor }),
    );
    if (read.status === "failed") break;
    if (read.status === "rejected") {
      complete = true;
      break;
    }
    for (const binding of read.body.data ?? []) addWriter(writers, binding);
    if (!read.body.has_more || !read.body.last_cursor) {
      complete = true;
      break;
    }
    after = read.body.last_cursor;
  }
  const jobRowsRead = await addJobRowWriters(row, writers);
  return { writers: [...writers.values()], complete: complete && jobRowsRead };
}

/** Config 내용을 읽는다. 여러 Collection 이 같은 Config 를 쓰므로 진행 중인 읽기도 함께 쓴다. `null` = 읽지 못했다. */
function readConfig(
  agentId: string,
  configId: string,
): Promise<ConfigRead | null> {
  const cached = configCache.get(configId);
  if (cached) return Promise.resolve(cached);
  const pending = pendingConfigReads.get(configId);
  if (pending) return pending;
  const reading = readUpstream<unknown>(() => getAgentConfig(agentId, configId))
    .then(read => {
      if (read.status === "failed") return null;
      const config: ConfigRead =
        read.status === "ok"
          ? {
              sources: configImportSources(read.body),
              hasCollectionExport: configSteps(read.body).some(
                isCollectionExport,
              ),
              readable: true,
            }
          : { sources: [], hasCollectionExport: false, readable: false };
      configCache.set(configId, config);
      return config;
    })
    .finally(() => pendingConfigReads.delete(configId));
  pendingConfigReads.set(configId, reading);
  return reading;
}

const stampOf = (row: LineageRow) =>
  `${row.id}:${row.updated_at}:${row.total_job_count}`;

async function scanCollection(
  row: LineageRow,
  agentNames: ReadonlyMap<string, string>,
  scan: Scan,
): Promise<ScannedCollection> {
  const key = stampOf(row);
  const cached = scannedCache.get(key);
  if (cached) return cached;

  const { writers, complete: writersComplete } = await readWriters(row);
  let complete = writersComplete;
  let unverified = false;
  const edges: RawEdge[] = [];
  for (const writer of writers) {
    const config = await readConfig(writer.agentId, writer.configId);
    if (config === null) {
      complete = false;
      continue;
    }
    // 결과 가져오기의 숨은 Agent 는 원래 읽을 수 없고, 그 원본은 Job 계보로 찾는다.
    if (!config.readable && row.source?.type !== "result_import") {
      unverified = true;
    }
    // 같은 결과가 Export 가 지정한 Collection 에도 있을 때만 사본이다.
    const mirror =
      config.hasCollectionExport && (writer.exportInput || !!writer.fromJobRow);
    for (const from of config.sources) {
      edges.push({
        from,
        to: row.id,
        kind: "import",
        workflow: agentNames.get(writer.agentId) ?? null,
        mirror,
      });
    }
  }
  const scanned = { writers, edges, unverified };
  if (complete) scannedCache.set(key, scanned);
  else scan.partial = true;
  return scanned;
}

function firstResultTypeKey(details: unknown): string | undefined {
  const keys = (details as { result_type_keys?: unknown } | null)
    ?.result_type_keys;
  const key = Array.isArray(keys) ? keys[0] : undefined;
  return typeof key === "string" ? key : undefined;
}

/**
 * 이 Collection 의 Job 하나. 결과 유형이 여럿이면 upstream 이 고르라고 답하므로 첫 유형에서 찾는다.
 * `undefined` = 읽지 못했다, `null` = 찾을 수 없다.
 */
async function firstJobId(
  collectionId: string,
): Promise<string | null | undefined> {
  const search = (resultTypeKey?: string) =>
    readUpstream<{ data?: { source_job_id?: string | null }[] }>(() =>
      searchSourceJobs(collectionId, {
        limit: 1,
        ...(resultTypeKey && { result_type_key: resultTypeKey }),
      }),
    );
  let read = await search();
  if (read.status === "rejected" && read.code === "result_type_required") {
    const key = firstResultTypeKey(read.details);
    if (key) read = await search(key);
  }
  if (read.status === "failed") return undefined;
  if (read.status === "rejected") return null;
  return read.body.data?.[0]?.source_job_id ?? null;
}

/**
 * Job 의 `source_job_id` 를 따라 이 Collection 밖의 Job 까지 올라간다. 고친 결과로 내용을 교체하면
 * 새 Job 이 같은 숨은 Agent 의 이전 세대 Job 을 가리키므로 다른 Agent 가 나올 때까지 간다.
 */
async function traceSourceJob(
  startJobId: string,
  ownAgentId: string | null | undefined,
): Promise<{ jobId: string; agentId: string } | null | undefined> {
  let jobId = startJobId;
  for (let depth = 0; depth <= MAX_RESULT_IMPORT_DEPTH; depth += 1) {
    const current = jobId;
    const job = await readUpstream<{
      source_job_id?: string | null;
      model?: string | null;
    }>(() => getJobResponse(current), MAX_RESPONSE_BYTES);
    if (job.status === "failed") return undefined;
    if (job.status === "rejected") return null;
    const { model, source_job_id: next } = job.body;
    if (depth > 0 && model !== ownAgentId) {
      return model ? { jobId: current, agentId: model } : null;
    }
    if (!next) return null;
    jobId = next;
  }
  return null;
}

/** 결과 가져오기 Collection 의 원본을 Job 계보로 찾는다. `undefined` = 읽지 못했다. */
async function findResultSource(
  row: LineageRow,
  rows: readonly LineageRow[],
  writersByAgent: ReadonlyMap<string, ReadonlySet<string>>,
): Promise<string | null | undefined> {
  const jobId = await firstJobId(row.id);
  if (!jobId) return jobId;
  const source = await traceSourceJob(jobId, row.source_agent?.id);
  if (!source) return source;
  const written = writersByAgent.get(source.agentId);
  if (!written) return null;

  const candidates = rows.filter(
    candidate => candidate.id !== row.id && written.has(candidate.id),
  );
  for (const candidate of rankSourceCandidates(candidates, row)) {
    const member = await readUpstream<unknown>(() =>
      listSourceJobFiles(candidate.id, source.jobId),
    );
    if (member.status === "failed") return undefined;
    if (member.status === "ok") return candidate.id;
  }
  return null;
}

async function scanResultImports(
  rows: readonly LineageRow[],
  scanned: readonly LineageRow[],
  writers: ReadonlyMap<string, readonly Writer[]>,
  scan: Scan,
): Promise<RawEdge[]> {
  const writersByAgent = new Map<string, Set<string>>();
  for (const [collectionId, list] of writers) {
    for (const { agentId } of list) {
      const collections = writersByAgent.get(agentId) ?? new Set<string>();
      collections.add(collectionId);
      writersByAgent.set(agentId, collections);
    }
  }
  const edges: RawEdge[] = [];
  const imports = scanned.filter(row => row.source?.type === "result_import");
  await forEachPooled(imports, scan, async row => {
    const key = stampOf(row);
    let sourceId = resultSourceCache.get(key)?.id;
    if (sourceId === undefined) {
      const found = await findResultSource(row, rows, writersByAgent);
      if (found === undefined) {
        scan.partial = true;
        return;
      }
      // 앞에서 읽지 못한 Collection 이 원본일 수 있어, 그때의 "못 찾음" 은 남기지 않는다.
      if (found !== null || !scan.partial) {
        resultSourceCache.set(key, { id: found });
      }
      sourceId = found;
    }
    if (sourceId === null) {
      scan.unverified.add(row.id);
      return;
    }
    edges.push({
      from: sourceId,
      to: row.id,
      kind: "result_import",
      workflow: null,
      mirror: false,
    });
  });
  return edges;
}

function toNode(row: LineageRow): CollectionLineageNode {
  return {
    id: row.id,
    name: row.name,
    source: row.source
      ? { type: row.source.type, label: row.source.label }
      : null,
    is_default: row.is_default,
    total_job_count: row.total_job_count,
    pending_job_count: row.pending_job_count,
    failed_job_count: row.failed_job_count,
  };
}

/** 모은 연결을 화면 응답으로 만든다. upstream 응답에서는 화면이 쓰는 필드만 옮긴다. */
export function toLineage(
  rows: readonly LineageRow[],
  edges: readonly CollectionLineageEdge[],
  { partial, unverified }: Pick<Scan, "partial" | "unverified">,
): CollectionLineage {
  const linked = new Set(edges.flatMap(edge => [edge.from, edge.to]));
  const nodes = rows.filter(row => linked.has(row.id)).map(toNode);
  const known = new Set(nodes.map(node => node.id));
  for (const id of linked) {
    if (!known.has(id)) nodes.push({ id, missing: true });
  }
  // 연결은 동시에 읽은 순서로 모이므로 목록 순서로 맞춰 그림이 요청마다 달라지지 않게 한다.
  const position = new Map(nodes.map((node, index) => [node.id, index]));
  const at = (id: string) => position.get(id) ?? nodes.length;
  const inList = (row: LineageRow) => row.listed !== false;
  return {
    nodes,
    edges: [...edges].sort(
      (a, b) =>
        at(a.to) - at(b.to) ||
        at(a.from) - at(b.from) ||
        a.kind.localeCompare(b.kind) ||
        (a.workflow ?? "").localeCompare(b.workflow ?? ""),
    ),
    unrelated_count: rows.filter(row => inList(row) && !linked.has(row.id))
      .length,
    partial,
    unverified_count: rows.filter(
      row => unverified.has(row.id) && (inList(row) || linked.has(row.id)),
    ).length,
  };
}

async function scanLineage(): Promise<CollectionLineage> {
  const scan: Scan = {
    deadline: Number.POSITIVE_INFINITY,
    partial: false,
    unverified: new Set(),
  };
  const rows = await listCollections(scan);
  scan.deadline = Date.now() + SCAN_BUDGET_MS;

  const agentNames = new Map<string, string>();
  for (const { source_agent: agent } of rows) {
    if (agent?.id && agent.name) agentNames.set(agent.id, agent.name);
  }
  const withResults = rows.filter(row => (row.total_job_count ?? 0) > 0);
  if (withResults.length > MAX_SCANNED_COLLECTIONS) scan.partial = true;
  const scanned = withResults.slice(0, MAX_SCANNED_COLLECTIONS);

  const writers = new Map<string, readonly Writer[]>();
  const raw: RawEdge[] = [];
  await forEachPooled(scanned, scan, async row => {
    const result = await scanCollection(row, agentNames, scan);
    writers.set(row.id, result.writers);
    raw.push(...result.edges);
    if (result.unverified) scan.unverified.add(row.id);
  });
  raw.push(...(await scanResultImports(rows, scanned, writers, scan)));

  const hidden = new Set(
    rows.filter(row => row.listed === false).map(row => row.id),
  );
  return toLineage(rows, finalizeEdges(raw, hidden), scan);
}

/**
 * Collection 연결을 돌려준다. 잠깐 사이의 다시 보기와 동시 요청은 한 번의 탐색을 함께 쓴다. 일부만
 * 읽은 결과는 캐시하지 않아 다음 요청이 이어서 읽는다.
 */
export function readCollectionLineage(): Promise<CollectionLineage> {
  const cached = resultCache.get("all");
  if (cached) return Promise.resolve(cached);
  inflight ??= scanLineage()
    .then(result => {
      if (!result.partial) resultCache.set("all", result);
      return result;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
