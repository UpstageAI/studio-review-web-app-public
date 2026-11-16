import "server-only";

import type { JobRevisionsQuery } from "@/lib/review-api/types";

import { upstageFetch } from "./client";
import { upstageEndpoints } from "./endpoints";
import type { ReviewApplyMode } from "./types";

/** `review-document` 한 번에 요청할 수 있는 Job 수 (`max_document_jobs`). */
export const MAX_DOCUMENT_JOBS = 100;
/** `review-imports` 본문 업로드 한도 (`max_inline_import_bytes`, 8 MiB). 정의는 모델 하나 — 브라우저 저장 판정과 같은 값이다. */
export { MAX_INLINE_IMPORT_BYTES } from "@/lib/review-model";
/** `Idempotency-Key` 헤더 최대 길이. */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 200;
export { RESOURCE_ID_PATTERN } from "@/lib/resource-id";

const { searchCollections } = upstageEndpoints;

/** Collection 의 검수 한도·지원 여부를 조회한다. */
export function getReviewCapabilities(collectionId: string): Promise<Response> {
  return upstageFetch(searchCollections.reviewCapabilities(collectionId));
}

/**
 * 지정한 Job 들의 검수 JSON 문서를 받는다. 본문은 숫자 토큰을 보존해야 하므로 호출자가
 * 파싱하지 않고 그대로 전달한다. `ifNoneMatch` 가 현재 내용과 같으면 upstream 은 `304` 를 준다.
 */
export function getReviewDocument(
  collectionId: string,
  jobIds: readonly string[],
  opts: { ifNoneMatch?: string | null } = {},
): Promise<Response> {
  const headers = new Headers();
  if (opts.ifNoneMatch) headers.set("If-None-Match", opts.ifNoneMatch);
  return upstageFetch(searchCollections.reviewDocument(collectionId), {
    query: { job_ids: jobIds },
    headers,
  });
}

/**
 * 수정한 검수 JSON 파일 바이트를 그대로 올려 가져오기를 만든다(`202` + `Retry-After`).
 * 같은 바이트를 다시 보낼 때는 같은 `idempotencyKey` 를, 파일을 고쳤으면 새 키를 쓴다.
 */
export function createReviewImport(
  collectionId: string,
  body: ArrayBuffer | Uint8Array<ArrayBuffer>,
  opts: { idempotencyKey: string; apply?: ReviewApplyMode },
): Promise<Response> {
  return upstageFetch(searchCollections.reviewImports(collectionId), {
    method: "POST",
    query: { apply: opts.apply ?? "auto" },
    headers: {
      "Idempotency-Key": opts.idempotencyKey,
      "Content-Type": "application/octet-stream",
    },
    body,
  });
}

/** 가져오기 한 건의 상태·preview·반영 결과를 조회한다. */
export function getReviewImport(
  collectionId: string,
  importId: string,
): Promise<Response> {
  return upstageFetch(searchCollections.reviewImport(collectionId, importId));
}

/** 원본 Job 의 검수 변경 이력 한 페이지. `undefined` 인 쿼리는 보내지 않는다. */
export function listSourceJobRevisions(
  collectionId: string,
  jobId: string,
  query: JobRevisionsQuery = {},
): Promise<Response> {
  return upstageFetch(
    searchCollections.sourceJobRevisions(collectionId, jobId),
    {
      query: { ...query },
    },
  );
}

/** 검수 변경 이력 한 건(`content`·`base_content` 포함, `ETag`). */
export function getSourceJobRevision(
  collectionId: string,
  jobId: string,
  revisionId: string,
): Promise<Response> {
  return upstageFetch(
    searchCollections.sourceJobRevision(collectionId, jobId, revisionId),
  );
}
