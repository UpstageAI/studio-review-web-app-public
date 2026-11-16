// 브라우저에서 같은 origin 의 BFF(`/api/...`)를 부르는 fetch 래퍼.
// API 키·upstream 주소는 서버에만 있으므로 여기서는 상대 경로만 쓴다.

import { isAbortError } from "@/lib/abort";
import type {
  ApiErrorEnvelope,
  CollectionLineage,
  FileHighlightsResponse,
  FilePagesResponse,
  JobRow,
  ListPage,
  ReviewCapabilities,
  ReviewProgress,
  ReviewProgressOverview,
  ReviewStatusAction,
  ReviewStatusRecord,
  SearchCollectionDetail,
  SearchCollectionSummary,
  SearchCollectionsListQuery,
  SourceJobFile,
  SourceJobsQuery,
} from "./types";

/** BFF 가 성공이 아닌 응답을 줬거나 요청 자체가 실패했을 때. 분기는 `code` 로 한다. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly param: string | null;
  /** 응답의 `Retry-After` 헤더 원문(없으면 `null`). */
  readonly retryAfter: string | null;

  constructor(
    status: number,
    code: string,
    message: string,
    opts: { param?: string | null; retryAfter?: string | null } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.param = opts.param ?? null;
    this.retryAfter = opts.retryAfter ?? null;
  }
}

// 취소 판별은 층 밖 `lib/abort.ts` 에 있다. 기존 import 경로를 위해 여기서도 내보낸다.
export { isAbortError };

type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  signal?: AbortSignal;
}

/** 쿼리 객체를 `?a=1&b=true` 로 만든다. `undefined`·`null`·빈 문자열은 보내지 않는다. */
export function buildQuery(query: Record<string, QueryValue> = {}): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.append(name, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** path segment 인코딩. 같은 폴더의 다른 클라이언트 모듈도 쓴다. */
export function segment(value: string): string {
  return encodeURIComponent(value);
}

function pickError(body: unknown): ApiErrorEnvelope["error"] | null {
  if (typeof body !== "object" || body === null) return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return null;
  const { code, message, param } = error as Record<string, unknown>;
  if (typeof code !== "string") return null;
  return {
    code,
    message: typeof message === "string" ? message : "",
    param: typeof param === "string" ? param : null,
  };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  return JSON.parse(text) as unknown;
}

/** 성공이 아닌 응답을 `ApiError` 로 바꾼다. 본문이 오류 envelope 가 아니면 `http_error`. */
async function errorFromResponse(response: Response): Promise<ApiError> {
  const retryAfter = response.headers.get("retry-after");
  let body: unknown = null;
  try {
    body = await readJson(response);
  } catch (err) {
    if (isAbortError(err)) throw err;
    body = null;
  }
  const error = pickError(body);
  return error
    ? new ApiError(response.status, error.code, error.message ?? "", {
        param: error.param,
        retryAfter,
      })
    : new ApiError(
        response.status,
        "http_error",
        `Request failed with status ${response.status}`,
        { retryAfter },
      );
}

/**
 * 요청을 보내고 성공 응답을 돌려준다. 연결 실패는 `ApiError(0, "network_error")`, 성공이 아닌 응답은
 * `errorFromResponse` 로 던지고, 취소는 `AbortError` 를 그대로 던진다. 본문 파싱은 호출처가 한다.
 */
async function send(path: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, { cache: "no-store", ...init });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new ApiError(0, "network_error", "Could not reach the server");
  }
  if (!response.ok) throw await errorFromResponse(response);
  return response;
}

/** GET 요청을 보내고 JSON 본문을 돌려준다. 실패는 `ApiError`, 취소는 `AbortError` 를 그대로 던진다. */
export async function requestJson<T>(
  path: string,
  opts: { query?: Record<string, QueryValue>; signal?: AbortSignal } = {},
): Promise<T> {
  const response = await send(`${path}${buildQuery(opts.query)}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: opts.signal,
  });

  try {
    return (await readJson(response)) as T;
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new ApiError(
      response.status,
      "invalid_response",
      "Response is not valid JSON",
    );
  }
}

/** Collection 목록 한 페이지. */
export function listCollections(
  query: SearchCollectionsListQuery = {},
  opts: RequestOptions = {},
): Promise<ListPage<SearchCollectionSummary>> {
  return requestJson("/api/search-collections", {
    query: { ...query },
    ...opts,
  });
}

/** Collection 상세. */
export function getCollection(
  collectionId: string,
  opts: RequestOptions = {},
): Promise<SearchCollectionDetail> {
  return requestJson(`/api/search-collections/${segment(collectionId)}`, opts);
}

/** Collection 에 결과를 낸 Job 행 한 페이지. */
export function listJobRows(
  collectionId: string,
  query: SourceJobsQuery = {},
  opts: RequestOptions = {},
): Promise<ListPage<JobRow>> {
  return requestJson(
    `/api/search-collections/${segment(collectionId)}/source-jobs`,
    { query: { ...query }, ...opts },
  );
}

/** Job 의 입력 파일 목록. Job 이 이 Collection 에 속하는지 확인할 때도 쓴다. */
export function getJobFiles(
  collectionId: string,
  jobId: string,
  opts: RequestOptions = {},
): Promise<ListPage<SourceJobFile>> {
  return requestJson(
    `/api/search-collections/${segment(collectionId)}/source-jobs/${segment(jobId)}/files`,
    opts,
  );
}

/** Collection 의 검수 한도·지원 여부. */
export function getReviewCapabilities(
  collectionId: string,
  opts: RequestOptions = {},
): Promise<ReviewCapabilities> {
  return requestJson(
    `/api/search-collections/${segment(collectionId)}/review-capabilities`,
    opts,
  );
}

/** 응답 원문과 `ETag`. 본문은 숫자 토큰을 지키기 위해 문자열 그대로 돌려준다. */
export interface TextResponse {
  text: string;
  etag: string | null;
}

/** 검수 JSON 문서 원문과 `ETag`. */
export type ReviewDocumentText = TextResponse;

/**
 * GET 요청을 보내고 본문을 파싱하지 않은 문자열과 `ETag` 로 돌려준다. `response.json()` 은 큰 수·고정밀
 * 소수를 잃으므로 숫자 보존 파서(`parseJson`)에 넘길 본문은 이것으로 받는다. 실패는 `ApiError`, 취소는
 * `AbortError` 를 그대로 던진다.
 */
export async function requestText(
  path: string,
  opts: { query?: Record<string, QueryValue>; signal?: AbortSignal } = {},
): Promise<TextResponse> {
  const response = await send(`${path}${buildQuery(opts.query)}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: opts.signal,
  });
  return { text: await response.text(), etag: response.headers.get("etag") };
}

/**
 * Job 하나의 검수 JSON 을 받는다. 문자열로 받아 편집 모델 파서(`readReviewDocument`)에 넘긴다.
 */
export function getReviewDocumentText(
  collectionId: string,
  jobId: string,
  opts: RequestOptions = {},
): Promise<ReviewDocumentText> {
  return requestText(
    `/api/search-collections/${segment(collectionId)}/review-document`,
    { query: { job_ids: jobId }, signal: opts.signal },
  );
}

/**
 * 파일 한 건의 페이지 이미지 URL. `refresh` 면 서버 캐시를 건너뛴다
 * (서명 URL 이 만료돼 이미지가 보이지 않을 때).
 */
export function getFilePages(
  fileId: string,
  opts: RequestOptions & { refresh?: boolean } = {},
): Promise<FilePagesResponse> {
  return requestJson(`/api/files/${segment(fileId)}`, {
    query: { refresh: opts.refresh ? "1" : undefined },
    signal: opts.signal,
  });
}

/**
 * 파일 한 건의 페이지 범위(`from`..`to`, 파일 로컬 1-based, 양끝 포함) Parse 하이라이트.
 * 서버는 한 번에 50 쪽까지만 받는다.
 */
export function getFileHighlights(
  fileId: string,
  opts: RequestOptions & { from: number; to: number },
): Promise<FileHighlightsResponse> {
  return requestJson(`/api/files/${segment(fileId)}/highlights`, {
    query: { pages: `${opts.from}-${opts.to}` },
    signal: opts.signal,
  });
}

/**
 * 원본 Job 응답(JSON). 결과 항목은 응답 안에 JSON 문자열로 들어 있어서, 바깥은 일반 파서로 읽고
 * 항목 문자열은 `readJobResponse` 가 숫자 보존 파서로 읽는다.
 */
export function getJobResponse(
  collectionId: string,
  jobId: string,
  opts: RequestOptions = {},
): Promise<unknown> {
  return requestJson(
    `/api/search-collections/${segment(collectionId)}/source-jobs/${segment(jobId)}/response`,
    opts,
  );
}

/** 가져오기 리소스(`review-imports`) 응답 본문과 다음 조회까지 기다릴 `Retry-After` 원문. */
export interface ReviewImportResponse {
  resource: unknown;
  retryAfter: string | null;
}

async function readImportResponse(
  response: Response,
): Promise<ReviewImportResponse> {
  const retryAfter = response.headers.get("retry-after");
  try {
    return { resource: await readJson(response), retryAfter };
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new ApiError(
      response.status,
      "invalid_response",
      "Response is not valid JSON",
    );
  }
}

/**
 * 검수 JSON 원문을 올려 가져오기를 만든다(반영 방식은 BFF 가 `auto` 로 고정). 본문은
 * `stringifyJson` 결과를 바이트 그대로 보낸다. 같은 본문을 다시 보낼 때는 같은 `idempotencyKey` 를 쓴다.
 */
export async function createReviewImport(
  collectionId: string,
  text: string,
  idempotencyKey: string,
  opts: RequestOptions = {},
): Promise<ReviewImportResponse> {
  const response = await send(
    `/api/search-collections/${segment(collectionId)}/review-imports`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/octet-stream",
        "Idempotency-Key": idempotencyKey,
      },
      body: text,
      signal: opts.signal,
    },
  );
  return readImportResponse(response);
}

/** 가져오기 한 건의 현재 상태. */
export async function getReviewImport(
  collectionId: string,
  importId: string,
  opts: RequestOptions = {},
): Promise<ReviewImportResponse> {
  const response = await send(
    `/api/search-collections/${segment(collectionId)}/review-imports/${segment(importId)}`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: opts.signal,
    },
  );
  return readImportResponse(response);
}

/**
 * Job 검수 상태를 바꾸고 바뀐 상태를 돌려준다(앱 DB). `start` 는 기록이 없을 때만 검수 중으로 만든다.
 */
export async function setReviewStatus(
  collectionId: string,
  jobId: string,
  action: ReviewStatusAction,
  opts: RequestOptions = {},
): Promise<ReviewStatusRecord> {
  const response = await send(
    `/api/search-collections/${segment(collectionId)}/source-jobs/${segment(jobId)}/review-status`,
    {
      method: "PUT",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action }),
      signal: opts.signal,
    },
  );
  try {
    return (await readJson(response)) as ReviewStatusRecord;
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new ApiError(
      response.status,
      "invalid_response",
      "Response is not valid JSON",
    );
  }
}

/** Collection 목록 한 페이지의 검수 현황과 앱 전체 요약. */
export function getReviewProgressOverview(
  collectionIds: readonly string[],
  opts: RequestOptions = {},
): Promise<ReviewProgressOverview> {
  const query = new URLSearchParams({
    collection_ids: collectionIds.join(","),
  });
  return requestJson(`/api/review-progress?${query}`, opts);
}

/** Collection 사이의 연결(Import, 결과 가져오기). */
export function getCollectionLineage(
  opts: RequestOptions = {},
): Promise<CollectionLineage> {
  return requestJson("/api/collection-lineage", opts);
}

/** Collection 의 검수 상태별 Job 수(검수 완료·검수 중). */
export function getReviewProgress(
  collectionId: string,
  opts: RequestOptions = {},
): Promise<ReviewProgress> {
  return requestJson(
    `/api/search-collections/${segment(collectionId)}/review-progress`,
    opts,
  );
}
