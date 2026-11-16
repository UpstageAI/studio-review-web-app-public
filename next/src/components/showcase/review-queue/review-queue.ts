// 검수 큐: Collection 상세 표의 조건·순서·받아 둔 행·다음 커서를 담아 Job 화면에서 이전·다음 Job 으로
// 차례로 돌게 한다. React·저장소·fetch 를 쓰지 않는 순수 함수만 둔다(저장은 review-queue-storage.ts).

import type {
  JobRow,
  ListOrder,
  ReviewStatusFilter,
  SourceJobsQuery,
} from "@/lib/review-api/types";

export const REVIEW_QUEUE_VERSION = 1;
export const REVIEW_QUEUE_PAGE_SIZE = 20;

/** 큐를 만든 표의 조건. 다음 페이지·"새로 추가된 Job 확인" 을 같은 조건으로 받는다. */
export interface ReviewQueueQuery {
  q?: string;
  latest?: boolean;
  group_by?: "input_files";
  order: ListOrder;
  review_status?: ReviewStatusFilter;
}

export interface ReviewQueueEntry {
  job_id: string;
  /** 첫 입력 파일명(없으면 `null`) */
  filename: string | null;
  file_count: number;
}

export interface ReviewQueue {
  version: typeof REVIEW_QUEUE_VERSION;
  collectionId: string;
  query: ReviewQueueQuery;
  jobs: ReviewQueueEntry[];
  /** 현재 Job 의 위치 */
  index: number;
  /** 이어 받을 다음 페이지 커서. 없으면 `null` */
  next_cursor: string | null;
  /** 이번 큐에서 연 Job ID(순서대로, 중복 없음) */
  visited: string[];
}

export interface ReviewQueueNeighbors {
  inQueue: boolean;
  previous: ReviewQueueEntry | null;
  next: ReviewQueueEntry | null;
  /** 현재 위치 뒤에 남은 행 수(받아 둔 것만) */
  remaining: number;
  /** 이어 받을 페이지가 있는지 */
  more: boolean;
}

export function queueStorageKey(collectionId: string): string {
  return `review-queue:${collectionId}`;
}

export function entryOf(row: JobRow): ReviewQueueEntry {
  const files = row.files ?? [];
  const filename = files.find(file => file.filename)?.filename ?? null;
  return {
    job_id: row.job_id,
    filename,
    file_count: row.file_count ?? files.length,
  };
}

function uniqueEntries(
  rows: readonly JobRow[],
  skip: ReadonlySet<string> = new Set(),
): ReviewQueueEntry[] {
  const seen = new Set(skip);
  const entries: ReviewQueueEntry[] = [];
  for (const row of rows) {
    if (seen.has(row.job_id)) continue;
    seen.add(row.job_id);
    entries.push(entryOf(row));
  }
  return entries;
}

/** 표의 행으로 큐를 만들고 `startJobId` 를 현재 위치로 둔다. 그 행이 없으면 `null`. */
export function buildQueue(args: {
  collectionId: string;
  query: ReviewQueueQuery;
  rows: readonly JobRow[];
  startJobId: string;
  nextCursor: string | null;
}): ReviewQueue | null {
  const jobs = uniqueEntries(args.rows);
  const index = jobs.findIndex(job => job.job_id === args.startJobId);
  if (index < 0) return null;
  return {
    version: REVIEW_QUEUE_VERSION,
    collectionId: args.collectionId,
    query: { ...args.query },
    jobs,
    index,
    next_cursor: args.nextCursor,
    visited: [args.startJobId],
  };
}

/** 이어 받은 페이지를 큐 뒤에 붙인다. 이미 있는 Job 은 건너뛴다. */
export function appendPage(
  queue: ReviewQueue,
  rows: readonly JobRow[],
  nextCursor: string | null,
): ReviewQueue {
  const known = new Set(queue.jobs.map(job => job.job_id));
  return {
    ...queue,
    jobs: [...queue.jobs, ...uniqueEntries(rows, known)],
    next_cursor: nextCursor,
  };
}

/** 큐 안에서 Job 의 위치. 큐 밖이면 -1. */
export function positionOf(queue: ReviewQueue, jobId: string): number {
  return queue.jobs.findIndex(job => job.job_id === jobId);
}

export function neighbors(
  queue: ReviewQueue,
  jobId: string,
): ReviewQueueNeighbors {
  const position = positionOf(queue, jobId);
  const more = queue.next_cursor !== null;
  if (position < 0) {
    return { inQueue: false, previous: null, next: null, remaining: 0, more };
  }
  return {
    inQueue: true,
    previous: queue.jobs[position - 1] ?? null,
    next: queue.jobs[position + 1] ?? null,
    remaining: queue.jobs.length - position - 1,
    more,
  };
}

/** 현재 위치를 `jobId` 로 옮기고 방문 기록에 더한다. 큐 밖이면 그대로. */
export function moveTo(queue: ReviewQueue, jobId: string): ReviewQueue {
  const index = positionOf(queue, jobId);
  if (index < 0) return queue;
  return {
    ...queue,
    index,
    visited: queue.visited.includes(jobId)
      ? queue.visited
      : [...queue.visited, jobId],
  };
}

/**
 * "새로 추가된 Job 확인": 같은 조건으로 처음부터 다시 받은 행 중 이번 큐에서 안 본 Job 만으로
 * 새 큐를 만든다(방문 기록은 이어받는다). 볼 Job 이 없으면 `null`.
 */
export function restartWith(
  queue: ReviewQueue,
  rows: readonly JobRow[],
  nextCursor: string | null,
): ReviewQueue | null {
  const jobs = uniqueEntries(rows, new Set(queue.visited));
  if (jobs.length === 0) return null;
  return { ...queue, jobs, index: 0, next_cursor: nextCursor };
}

/**
 * 이번 큐에서 이미 열었지만 검수가 끝나지 않은 Job 수. 받은 행 기준이고(같은 Job 은 한 번만)
 * 지금 보는 Job 은 뺀다. 검수 상태가 없는 행은 끝나지 않은 것으로 본다.
 */
export function unfinishedVisitedCount(
  queue: ReviewQueue,
  rows: readonly JobRow[],
  currentJobId: string,
): number {
  const visited = new Set(queue.visited);
  const counted = new Set<string>();
  for (const row of rows) {
    if (row.job_id === currentJobId || !visited.has(row.job_id)) continue;
    if (row.review_status === "done") continue;
    counted.add(row.job_id);
  }
  return counted.size;
}

/** 큐 조건으로 `source-jobs` 쿼리를 만든다. `after` 가 있으면 그 페이지부터. */
export function sourceJobsQueryOf(
  queue: Pick<ReviewQueue, "query">,
  after?: string,
): SourceJobsQuery {
  return {
    status: "completed",
    limit: REVIEW_QUEUE_PAGE_SIZE,
    ...queue.query,
    after,
  };
}

export function serializeQueue(queue: ReviewQueue): string {
  return JSON.stringify(queue);
}

const ORDERS: readonly string[] = ["asc", "desc"];
const FILTERS: readonly string[] = [
  "pending",
  "in_progress",
  "done",
  "unfinished",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseQuery(value: unknown): ReviewQueueQuery | null {
  if (!isRecord(value)) return null;
  const { q, latest, group_by, order, review_status } = value;
  if (typeof order !== "string" || !ORDERS.includes(order)) return null;
  if (q !== undefined && typeof q !== "string") return null;
  if (latest !== undefined && typeof latest !== "boolean") return null;
  if (group_by !== undefined && group_by !== "input_files") return null;
  if (
    review_status !== undefined &&
    (typeof review_status !== "string" || !FILTERS.includes(review_status))
  ) {
    return null;
  }
  const query: ReviewQueueQuery = { order: order as ListOrder };
  if (q !== undefined) query.q = q;
  if (latest !== undefined) query.latest = latest;
  if (group_by !== undefined) query.group_by = group_by;
  if (review_status !== undefined) {
    query.review_status = review_status as ReviewStatusFilter;
  }
  return query;
}

function parseEntry(value: unknown): ReviewQueueEntry | null {
  if (!isRecord(value)) return null;
  const { job_id, filename, file_count } = value;
  if (typeof job_id !== "string" || job_id === "") return null;
  if (filename !== null && typeof filename !== "string") return null;
  if (
    typeof file_count !== "number" ||
    !Number.isInteger(file_count) ||
    file_count < 0
  ) {
    return null;
  }
  return { job_id, filename, file_count };
}

/** 저장해 둔 큐를 읽는다. 모양이 다르거나 버전이 다르면 `null`. */
export function parseQueue(text: string | null): ReviewQueue | null {
  if (!text) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value) || value.version !== REVIEW_QUEUE_VERSION) return null;
  const { collectionId, index, next_cursor, visited } = value;
  if (typeof collectionId !== "string" || collectionId === "") return null;
  const query = parseQuery(value.query);
  if (!query || !Array.isArray(value.jobs)) return null;
  const jobs: ReviewQueueEntry[] = [];
  for (const item of value.jobs) {
    const entry = parseEntry(item);
    if (!entry) return null;
    jobs.push(entry);
  }
  if (
    typeof index !== "number" ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= jobs.length
  ) {
    return null;
  }
  if (next_cursor !== null && typeof next_cursor !== "string") return null;
  if (
    !Array.isArray(visited) ||
    !visited.every((id): id is string => typeof id === "string")
  ) {
    return null;
  }
  return {
    version: REVIEW_QUEUE_VERSION,
    collectionId,
    query,
    jobs,
    index,
    next_cursor,
    visited,
  };
}
