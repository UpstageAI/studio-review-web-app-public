// 브라우저(host)와 BFF 서버가 함께 쓰는 Collection·Job 목록 타입.
// 쿼리 이름·필드 이름은 upstream 그대로 둔다(BFF 는 이름을 바꾸지 않는다).
// 응답 DTO 는 화면이 쓰는 필드만 선언하고 대부분 optional 로 둬서 서버 필드 추가·누락에 깨지지 않게 한다.

import type { HighlightLike, JsonValue } from "@/lib/review-model";

/** Collection 종류. */
export type SearchCollectionKind = "documents" | "table";

/** 목록 정렬 방향. */
export type ListOrder = "asc" | "desc";

/** 원본 Job 상태. */
export type SourceJobStatus =
  "in_progress" | "completed" | "failed" | "cancelled";

/** `GET /search-collections` 쿼리. */
export interface SearchCollectionsListQuery {
  kind?: SearchCollectionKind;
  include_default?: boolean;
  /** `true` 면 Agent 기본 Collection 만, `false` 면 그 외만. 생략하면 거르지 않는다 */
  is_default?: boolean;
  /**
   * `true` 면 Studio Collection 목록에 보일 것만(Agent 와 함께 자동으로 만든 기본 Collection 제외,
   * 직접 만든 Collection 은 기본이 되어도 포함), `false` 면 자동으로 만든 기본 Collection 만.
   */
  listed?: boolean;
  /** 이름 검색어(2..200 자) */
  q?: string;
  /** 다음 페이지: 직전 응답의 `last_cursor` */
  after?: string;
  /** 이전 페이지: 직전 응답의 `first_cursor` */
  before?: string;
  /** 1..100 */
  limit?: number;
  order?: ListOrder;
}

/** `GET /search-collections/{id}/source-jobs` 쿼리. */
export interface SourceJobsQuery {
  /** 입력 파일명 검색어(2..200 자) */
  q?: string;
  config_id?: string;
  latest?: boolean;
  status?: SourceJobStatus;
  after?: string;
  before?: string;
  /** 1..100 */
  limit?: number;
  order?: ListOrder;
  /** `input_files`: 같은 입력 파일 묶음당 최신 실행 1 행 */
  group_by?: "input_files";
  /** 검수 상태로 거르기. BFF 가 앱 DB 로 거르며 upstream 으로는 보내지 않는다 */
  review_status?: ReviewStatusFilter;
}

/** Job 검수 상태(앱 DB). `pending` = 기록 없음(검수 전). */
export type ReviewStatusValue = "pending" | "in_progress" | "done";

/** `source-jobs` 의 `review_status` 쿼리. `unfinished` = 검수 전 + 검수 중. */
export type ReviewStatusFilter = ReviewStatusValue | "unfinished";

/**
 * 검수 상태 변경. `start` 는 기록이 없을 때만 검수 중으로 만들고(완료 Job 을 열어도 그대로),
 * `complete` 는 검수 완료로, `reopen` 은 무조건 검수 중으로 바꾼다.
 */
export type ReviewStatusAction = "start" | "complete" | "reopen";

/** `PUT …/source-jobs/{jobId}/review-status` 응답. */
export interface ReviewStatusRecord {
  job_id: string;
  review_status: ReviewStatusValue;
  /** 검수 완료 시각(ISO 8601). 완료가 아니면 `null` */
  review_completed_at: string | null;
}

/** `GET …/review-progress` 응답. 상태별 Job 수(검수 전은 세지 않는다). */
export interface ReviewProgress {
  done: number;
  in_progress: number;
}

/** `GET /api/review-progress` 응답. 검수 기록이 없는 Collection 은 `collections` 에 없다. */
export interface ReviewProgressOverview {
  collections: Record<string, ReviewProgress>;
  overview: ReviewProgress & { collections_in_progress: number };
}

/** 커서 페이지 목록 응답. `first_id`·`last_id` 는 커서가 아니므로 페이지 이동에는 `*_cursor` 를 쓴다. */
export interface ListPage<T> {
  object?: "list";
  data: T[];
  has_more?: boolean;
  first_id?: string | null;
  last_id?: string | null;
  first_cursor?: string | null;
  last_cursor?: string | null;
}

/** Collection 목록 항목. */
export interface SearchCollectionSummary {
  id: string;
  object?: string;
  name?: string | null;
  description?: string | null;
  kind?: SearchCollectionKind | (string & {});
  is_default?: boolean;
  default_for_agent_id?: string | null;
  listed?: boolean;
  /** `type` 은 Collection 이 만들어진 경로, `label` 은 그 경로의 표시 이름(예: Agent 이름) */
  source?: { type?: string | null; label?: string | null } | null;
  total_job_count?: number | null;
  latest_config_job_count?: number | null;
  /** 진행 중(취소 중 포함) Job 수 */
  pending_job_count?: number | null;
  /** 실패한 Job 수 */
  failed_job_count?: number | null;
  last_result_at?: string | number | null;
  file_count?: number | null;
  project?: { id?: string; name?: string | null } | null;
  created_at?: string | number | null;
  updated_at?: string | number | null;
}

/** Collection 상세. 목록 항목에 최신 설정 정보가 더해진다. */
export interface SearchCollectionDetail extends SearchCollectionSummary {
  latest_config_ids?: string[] | null;
  latest_config_id?: string | null;
  head_binding?: unknown;
}

/**
 * Collection 사이의 연결. `from` 의 결과를 이어 받아 `to` 가 만들어졌다.
 * `import` 는 Workflow 의 Import 노드, `result_import` 는 결과 JSON 을 고쳐 다시 가져온 경우다.
 */
export interface CollectionLineageEdge {
  from: string;
  to: string;
  kind: "import" | "result_import";
  /** Import 노드를 가진 Workflow 이름. 모르면 `null` */
  workflow: string | null;
}

/** 관계 화면의 Collection. 목록에서 찾지 못한 원본(삭제됐거나 권한 밖)은 `missing` 이고 id 만 있다. */
export type CollectionLineageNode = Pick<
  SearchCollectionSummary,
  | "id"
  | "name"
  | "source"
  | "is_default"
  | "total_job_count"
  | "pending_job_count"
  | "failed_job_count"
> & { missing?: boolean };

/** `GET /api/collection-lineage` 응답. */
export interface CollectionLineage {
  /** 연결이 있는 Collection. 최신 먼저다. 목록에 없는 기본 Collection 은 다른 Collection 의 원본일 때만 있다 */
  nodes: CollectionLineageNode[];
  edges: CollectionLineageEdge[];
  /** Collection 목록에 보이는 문서 Collection 중 연결이 없는 수 */
  unrelated_count: number;
  /** 상한에 걸렸거나 일시적으로 읽지 못한 곳이 있어 연결이 빠졌을 수 있다. 다시 읽으면 나아질 수 있다 */
  partial: boolean;
  /** 볼 수 없는 Workflow 처럼 다시 읽어도 소용없는 이유로 연결을 확인하지 못한 Collection 수. 목록에 없는 Collection 은 카드로 나올 때만 센다 */
  unverified_count: number;
}

/** Job 행이 실행한 설정. */
export interface JobRowConfig {
  id: string;
  external_id?: string | null;
  name?: string | null;
  is_latest?: boolean;
}

/** Job 행의 입력 파일. */
export interface JobRowFile {
  id: string;
  filename?: string | null;
  content_type?: string | null;
  bytes?: number | null;
  num_pages?: number | null;
}

/** `source-jobs` 목록 행. */
export interface JobRow {
  object?: "search_collection.job_row";
  job_id: string;
  status?: SourceJobStatus | (string & {});
  config?: JobRowConfig | null;
  files?: JobRowFile[];
  file_count?: number | null;
  error?: { code?: string; message?: string | null } | null;
  created_at?: string | number | null;
  updated_at?: string | number | null;
  /** BFF 가 앱 DB 에서 붙인 검수 상태. DB 를 읽지 못하면 없다 */
  review_status?: ReviewStatusValue;
  review_completed_at?: string | null;
}

/** `source-jobs/{job_id}/files` 항목. */
export interface SourceJobFile {
  id: string;
  filename?: string | null;
  num_pages?: number | null;
}

/** BFF·upstream 공통 오류 응답. 분기는 `code` 로 한다. */
export interface ApiErrorEnvelope {
  error: {
    code: string;
    type?: string;
    message?: string;
    param?: string | null;
    details?: unknown;
  };
}

/** `GET /search-collections/{id}/review-capabilities`. 지원 판단은 `result_source_supported` 로 한다. */
export interface ReviewCapabilities {
  object?: "search_collection.review_capabilities";
  /** `false` 면 이 Collection 은 검수 대상이 아니다(`review-document` 가 409). */
  result_source_supported?: boolean;
  format?: string;
  editable_states?: string[];
  max_document_jobs?: number;
  max_document_bytes?: number;
  max_inline_import_bytes?: number;
  max_changed_results?: number;
  /** `true` 면 Job 검수 변경 이력(`source-jobs/{jobId}/revisions`)을 읽을 수 있다. */
  revisions_supported?: boolean;
}

/** `GET /api/files/{fileId}` 의 페이지 하나. */
export interface FilePagesPage {
  /** 페이지 이미지의 서명 URL(`https:` 만). 없거나 허용하지 않는 URL 이면 `null`. */
  image_url: string | null;
}

/**
 * `GET /api/files/{fileId}` — BFF 가 upstream 파일 응답을 뷰어용으로 바꾼 모양(페이지 이미지 URL 만).
 * 원본 파일 링크(`file_url`)·요소 원문(`elements`)·요소 이미지 URL 은 담지 않는다.
 * Parse 하이라이트는 `GET /api/files/{fileId}/highlights?pages=a-b` 가 범위 단위로 준다.
 */
export interface FilePagesResponse {
  id: string;
  /** upstream 파일 상태. `READY` 가 아니면 페이지나 파싱 결과가 비어 있을 수 있다. */
  status: string;
  filename?: string;
  num_pages: number | null;
  pages: FilePagesPage[];
}

/** `GET /api/files/{fileId}/highlights` 의 페이지 하나. */
export interface FileHighlightsPage {
  /** 파일 로컬 페이지(1-based). */
  page: number;
  /** Parse 요소 하이라이트. `page` 는 파일 로컬 1-based, id 는 `p{page}-{elementId}`. */
  highlights: HighlightLike[];
}

/**
 * `GET /api/files/{fileId}/highlights?pages=a-b` — 요청 범위 안에서 파일에 있는 페이지만,
 * 페이지 순서로. 요소가 없는 페이지는 빈 `highlights` 로 들어간다.
 */
export interface FileHighlightsResponse {
  id: string;
  pages: FileHighlightsPage[];
}

// ---------------------------------------------------------------------------
// Job 검수 변경 이력 (`source-jobs/{jobId}/revisions`)
// ---------------------------------------------------------------------------

/** 변경 종류: 결과 값 한 건 또는 문서 구성(구조). */
export type JobRevisionType = "result" | "structure";

/** 내용을 싣지 못한 이유. 모르는 값도 그대로 둔다. */
export type JobRevisionOmitted = "too_large" | "unavailable" | (string & {});

export interface JobRevisionDocumentRef {
  document_id: string;
  label?: string | null;
  field_group?: string | null;
}

/** 값 변경의 대상 결과. 구조 변경이면 행의 `result` 가 `null`. */
export interface JobRevisionResultRef {
  occurrence_id: string;
  job_result_id?: string | null;
  step_id: string;
  step_name?: string | null;
  step_type?: string | null;
  documents?: JobRevisionDocumentRef[];
}

/** 다른 Job 에서 복사해 온 내용이면 원본 위치. */
export interface JobRevisionOrigin {
  type: "copy" | (string & {});
  source_job_id?: string | null;
  source_occurrence_id?: string | null;
}

/** 변경을 만든 작업(가져오기·이관). 같은 저장에서 나온 행은 같은 `id` 를 공유한다. */
export interface JobRevisionOperation {
  id: string;
  kind?: "import" | "migration" | (string & {});
  change_count?: number;
  collection_id?: string | null;
  from_this_collection?: boolean;
  reason?: string | null;
  client_reference?: string | null;
}

/**
 * 변경 1 건. `base_version` 0 은 기계 출력이 직전 내용이라는 뜻이다. `content`·`base_content` 는
 * `include=content` 목록이나 단건 조회에만 있고, 숫자 표기를 지키기 위해 `ExactNumber` 를 보존한다.
 */
export interface JobRevision {
  id: string;
  object?: "search_collection.job_revision";
  type: JobRevisionType;
  version: number;
  base_version: number;
  /** Unix 초 */
  published_at: number;
  created_by?: string | null;
  result: JobRevisionResultRef | null;
  origin?: JobRevisionOrigin | null;
  operation: JobRevisionOperation;
  content?: JsonValue | null;
  content_omitted?: JobRevisionOmitted | null;
  base_content?: JsonValue | null;
  base_content_omitted?: JobRevisionOmitted | null;
}

/** 이력 한 페이지. 다음 페이지 커서는 `last_id` 다. */
export type JobRevisionPage = ListPage<JobRevision>;

/** `GET …/revisions` 쿼리. */
export interface JobRevisionsQuery {
  type?: JobRevisionType;
  occurrence_id?: string;
  job_result_id?: string;
  operation_id?: string;
  include?: "content";
  /** 직전 페이지의 `last_id` */
  after?: string;
  /** 1..100 */
  limit?: number;
  order?: ListOrder;
}
