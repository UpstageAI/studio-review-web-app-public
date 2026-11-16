import "server-only";

import { upstageFetch } from "./client";
import { upstageEndpoints } from "./endpoints";

const { searchCollections, agents, responses } = upstageEndpoints;

/** Collection 에 결과를 쓴 Agent·Config 목록을 조회한다. */
export function listCollectionBindings(
  collectionId: string,
  query: { limit?: number; after?: string } = {},
): Promise<Response> {
  return upstageFetch(searchCollections.bindings(collectionId), {
    query: { ...query },
  });
}

/** Collection 의 Job 을 찾는다. 읽기 전용 검색이다. */
export function searchSourceJobs(
  collectionId: string,
  body: { limit: number; result_type_key?: string },
): Promise<Response> {
  return upstageFetch(searchCollections.sourceJobSearch(collectionId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Agent 의 Config 한 버전을 조회한다. Config 는 저장 뒤 바뀌지 않는다. */
export function getAgentConfig(
  agentId: string,
  configId: string,
): Promise<Response> {
  return upstageFetch(agents.config(agentId, configId));
}

/**
 * Job 응답을 조회한다(`source_job_id`, 실행한 Agent 를 뜻하는 `model` 포함). 결과 가져오기는 세대가
 * 교체되면 이전 Job 이 지워진 채로 계보에 남으므로 지워진 Job 도 함께 읽는다. 두 필드만 쓰지만 upstream 의
 * `include` 는 결과를 고르는 값뿐이라 결과 없이 Job 정보만 받는 조회가 없다.
 */
export function getJobResponse(jobId: string): Promise<Response> {
  return upstageFetch(responses.response(jobId), {
    query: { include_deleted: true },
  });
}
