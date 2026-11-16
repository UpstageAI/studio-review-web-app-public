import "server-only";

import type {
  SearchCollectionsListQuery,
  SourceJobsQuery,
} from "@/lib/review-api/types";

import { upstageFetch } from "./client";
import { upstageEndpoints } from "./endpoints";

const { searchCollections } = upstageEndpoints;

/** Collection 목록을 조회한다. `undefined` 인 쿼리는 보내지 않는다. */
export function listSearchCollections(
  query: SearchCollectionsListQuery = {},
): Promise<Response> {
  return upstageFetch(searchCollections.list(), { query: { ...query } });
}

/** Collection 한 건의 상세(총 Job 수·최신 설정)를 조회한다. */
export function getSearchCollection(collectionId: string): Promise<Response> {
  return upstageFetch(searchCollections.detail(collectionId));
}

/** Collection 에 결과를 낸 원본 Job 행 목록을 조회한다. */
export function listSourceJobs(
  collectionId: string,
  query: SourceJobsQuery = {},
): Promise<Response> {
  return upstageFetch(searchCollections.sourceJobs(collectionId), {
    query: { ...query },
  });
}

/** 원본 Job 의 입력 파일 목록(`id`·`filename`·`num_pages`)을 조회한다. */
export function listSourceJobFiles(
  collectionId: string,
  jobId: string,
): Promise<Response> {
  return upstageFetch(searchCollections.sourceJobFiles(collectionId, jobId));
}

/** 원본 Job 응답(Step 별 결과·Parse 요소·추출값 좌표). 검수값이 반영된 본이다. */
export function getSourceJobResponse(
  collectionId: string,
  jobId: string,
): Promise<Response> {
  return upstageFetch(searchCollections.sourceJobResponse(collectionId, jobId));
}
