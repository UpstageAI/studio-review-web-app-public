// Upstage 콘솔 게이트웨이 `/v2` 경로 빌더. 호출부는 경로 문자열을 직접 만들지 않고 여기서 받는다.
// 모든 path segment 는 인코딩되므로 `/`·`..` 가 섞인 값도 경로를 벗어나지 못한다.
// 서버·테스트 어디서나 import 할 수 있도록 `server-only` 를 걸지 않은 순수 모듈로 둔다.

const V2 = "/v2";

const seg = (value: string | number) => encodeURIComponent(String(value));

const collection = (collectionId: string) =>
  `${V2}/search-collections/${seg(collectionId)}`;

export const upstageEndpoints = {
  searchCollections: {
    /** Collection 목록 */
    list: () => `${V2}/search-collections`,
    /** Collection 한 건 상세 */
    detail: (collectionId: string) => collection(collectionId),
    /** 검수 JSON 형식·한도·반영 모드 등 Collection 이 지원하는 검수 기능 조회 */
    reviewCapabilities: (collectionId: string) =>
      `${collection(collectionId)}/review-capabilities`,
    /** 지정한 Job 들의 검수 JSON 문서 다운로드 (`job_ids` 반복 쿼리) */
    reviewDocument: (collectionId: string) =>
      `${collection(collectionId)}/review-document`,
    /** 수정한 검수 JSON 업로드(가져오기 생성) */
    reviewImports: (collectionId: string) =>
      `${collection(collectionId)}/review-imports`,
    /** 가져오기 한 건의 상태·결과 조회 */
    reviewImport: (collectionId: string, importId: string) =>
      `${collection(collectionId)}/review-imports/${seg(importId)}`,
    /** Collection 에 결과를 낸 원본 Job 목록 */
    sourceJobs: (collectionId: string) =>
      `${collection(collectionId)}/source-jobs`,
    /** 원본 Job 의 입력 파일 목록 */
    sourceJobFiles: (collectionId: string, jobId: string) =>
      `${collection(collectionId)}/source-jobs/${seg(jobId)}/files`,
    /** 원본 Job 응답(문서 파싱 결과·좌표) */
    sourceJobResponse: (collectionId: string, jobId: string) =>
      `${collection(collectionId)}/source-jobs/${seg(jobId)}/response`,
    /** 원본 Job 의 검수 변경 이력(변경 1 건 = 항목 1 개, `last_id` 커서) */
    sourceJobRevisions: (collectionId: string, jobId: string) =>
      `${collection(collectionId)}/source-jobs/${seg(jobId)}/revisions`,
    /** 검수 변경 이력 한 건(변경 전·후 내용 포함) */
    sourceJobRevision: (
      collectionId: string,
      jobId: string,
      revisionId: string,
    ) =>
      `${collection(collectionId)}/source-jobs/${seg(jobId)}/revisions/${seg(revisionId)}`,
    /** 이 Collection 에 결과를 쓴 Agent·Config 와 결과 경계 */
    bindings: (collectionId: string) => `${collection(collectionId)}/bindings`,
    /** Job 검색(결과 가져오기 Collection 도 된다. `source-jobs` 목록은 409) */
    sourceJobSearch: (collectionId: string) =>
      `${collection(collectionId)}/source-jobs/search`,
    /** 결과 값의 근거 위치(문맥) 검색 */
    resultContextSearch: (collectionId: string) =>
      `${collection(collectionId)}/result-context/search`,
  },
  agents: {
    /** Agent 의 Config 한 버전(Step 구성) */
    config: (agentId: string, configId: string) =>
      `${V2}/agents/${seg(agentId)}/configs/${seg(configId)}`,
  },
  files: {
    /** 업로드한 파일 조회(페이지 이미지 포함) */
    file: (fileId: string) => `${V2}/files/${seg(fileId)}`,
  },
  responses: {
    /** Job(response) 조회 */
    response: (jobId: string) => `${V2}/responses/${seg(jobId)}`,
  },
} as const;
