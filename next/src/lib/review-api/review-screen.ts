// 검수 화면(`components/job-review`)이 부르는 BFF 연산 모음. 자기 BFF 로 바꿀 때 고칠 곳이 여기서
// 보이도록 `client.ts` 의 함수를 이름 그대로 다시 내보낸다(래핑·기본값 없음). 경로는 모두 같은
// origin 의 `/api/...` 이다.
//
// - getCollection          GET  /api/search-collections/{collectionId}
// - getReviewCapabilities  GET  /api/search-collections/{collectionId}/review-capabilities
// - getReviewDocumentText  GET  /api/search-collections/{collectionId}/review-document?job_ids={jobId}
// - getJobResponse         GET  /api/search-collections/{collectionId}/source-jobs/{jobId}/response
// - createReviewImport     POST /api/search-collections/{collectionId}/review-imports (Idempotency-Key)
// - getReviewImport        GET  /api/search-collections/{collectionId}/review-imports/{importId}
// - getFilePages           GET  /api/files/{fileId}[?refresh=1]
// - getFileHighlights      GET  /api/files/{fileId}/highlights?pages={from}-{to}
//
// 앱 연산은 여기 없다 — `setReviewStatus`(검수 상태, `client.ts`), 변경 이력(`revisions.ts`),
// 목록·큐·현황(`client.ts`).

export {
  ApiError,
  createReviewImport,
  getCollection,
  getFileHighlights,
  getFilePages,
  getJobResponse,
  getReviewCapabilities,
  getReviewDocumentText,
  getReviewImport,
  isAbortError,
  type RequestOptions,
  type ReviewDocumentText,
  type ReviewImportResponse,
} from "./client";

export { apiErrorInfo, type ApiErrorInfo } from "./error-info";

export type {
  FileHighlightsResponse,
  FilePagesResponse,
  ReviewCapabilities,
  SearchCollectionDetail,
} from "./types";
