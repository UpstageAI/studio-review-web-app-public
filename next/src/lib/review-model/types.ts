import type { JsonObject, JsonValue } from "./json";

/**
 * `collection-results/11` 검수 JSON 을 읽기 정규화한 모양.
 *
 * - 결과 `state` 가 없으면 `"present"`.
 * - 결과의 `document_ids`/`field_groups` 는 `link` 판별 합집합으로.
 * - `file_groups.excluded_pages`·`excluded_documents` 가 없으면 `[]`.
 * - 읽기 전용 조회 정보(`labels`·`schema`·`num_pages`·`input_index`·`checks`)는
 *   서버 설정에 따라 빠질 수 있어 전부 optional.
 *
 * 모든 값은 평범한 JSON 이라 `cloneJson`·`stringifyJson` 으로 다룰 수 있다.
 */

export const REVIEW_FORMAT = "collection-results/11";

export type ReviewConfig = { readonly agent_id: string | null };

export type ReviewStep = {
  readonly config_id: string;
  readonly name: string;
  /** `document-classify` / `information-extract` / `validate` / `match` / `merge` … */
  readonly type: string;
  /** 읽기 전용: Classify Config 가 허용하는 라벨(Config 순서). */
  readonly labels?: readonly string[];
  /** 읽기 전용: 결과 `content` 의 JSON Schema. */
  readonly schema?: JsonObject;
};

export type ReviewDocument = {
  readonly format: typeof REVIEW_FORMAT;
  readonly collection_id: string;
  readonly configs: Readonly<Record<string, ReviewConfig>>;
  readonly steps: Readonly<Record<string, ReviewStep>>;
  readonly jobs: readonly ReviewJob[];
};

export type ReviewJob = {
  readonly id: string;
  /** 없으면 값만 있는 Job(구조 편집 불가). */
  readonly file_groups?: FileGroups;
  readonly output: readonly OutputItem[];
};

export type FileGroups = {
  readonly base_version: number;
  readonly groups: readonly FileGroup[];
  readonly excluded_pages: readonly SourceRange[];
  readonly excluded_documents: readonly string[];
};

export type FileGroup = {
  readonly group_id: string;
  readonly files: readonly ReviewFile[];
  /** 이 그룹의 문서 배치를 정하는 Classify Step. Classify 없으면 `null`. */
  readonly layout_step_id: string | null;
};

export type ReviewFile = {
  /** `"<원본 Job ID>#<input_index>"`. */
  readonly file_ref: string;
  readonly file_id: string;
  readonly name: string;
  /** 읽기 전용: 페이지 수. */
  readonly num_pages?: number;
  /** 읽기 전용: 원본 Job 입력에서의 위치(원본 결과 좌표의 페이지 공간). */
  readonly input_index?: number;
};

/** 원본 파일 기준 1-based 양끝 포함 범위. */
export type PageRange = readonly [number, number];

export type SourceRange = {
  readonly file_ref: string;
  readonly page_ranges: readonly PageRange[];
};

/** 문서 배치 보기 — Classify Step 보기 또는 분류 없음(`step_id: null`) 보기. */
export type Layout = {
  readonly step_id: string | null;
  readonly base_version: number;
  readonly content: { readonly documents: readonly ReviewDocumentEntry[] };
};

export type ReviewDocumentEntry = {
  readonly document_id: string;
  readonly group_id: string;
  readonly label: string | null;
  readonly source_files: readonly SourceRange[];
};

export type KnownResultState =
  "present" | "stale" | "input_changed" | "unlinked" | "missing";
/** 서버가 새 상태를 더해도 읽을 수 있게 미지 문자열을 허용한다(편집은 불가). */
export type ResultState = KnownResultState | (string & {});

export type ResultLink =
  | { readonly kind: "documents"; readonly document_ids: readonly string[] }
  | {
      readonly kind: "field_groups";
      readonly field_groups: Readonly<Record<string, readonly string[]>>;
    }
  | { readonly kind: "none" };

export type ResultSource = {
  readonly job_id: string;
  readonly occurrence_id: string | null;
};

export type ResultCheck = {
  readonly name?: string;
  readonly severity?: string;
  readonly passed?: boolean;
  readonly reason?: string;
};

export type Result = {
  /** occurrence 식별자. */
  readonly id: string;
  readonly step_id: string;
  readonly base_version: number;
  readonly content: JsonValue;
  readonly state: ResultState;
  readonly link: ResultLink;
  /** 읽기 전용: 파일 이동으로 복사된 결과의 출처. */
  readonly source?: ResultSource;
  /** 읽기 전용: Validate 원본 판정 근거. */
  readonly checks?: readonly ResultCheck[];
};

export type OutputItem = Layout | Result;

/** `output[]` 중 `id` 가 있으면 Result, 없으면 Layout. */
export function isResult(item: OutputItem): item is Result {
  return Object.hasOwn(item, "id");
}

/** 파일 로컬 페이지(1-based). */
export type PageRef = { readonly file_ref: string; readonly page: number };

/** 문서 주소. 멀티 layout Job 에서는 `documentId` 가 layout 사이에 겹칠 수 있다. */
export type DocAddress = {
  readonly jobId: string;
  readonly stepId: string | null;
  readonly documentId: string;
};

export type IssueCode =
  | "page_missing"
  | "page_overlap"
  /** 한 문서가 같은 페이지를 두 번, 또는 제외 안 된 두 문서가 같은 페이지를 가짐. */
  | "duplicate_review_page"
  | "page_out_of_range"
  | "schema_violation"
  | "label_not_in_config"
  | "package_limit_exceeded"
  | "review_limit_exceeded"
  | "review_group_unavailable"
  | "review_file_unavailable"
  | "duplicate_review_file"
  /** `excluded_documents` 의 id 가 문서 배치 보기에 없음. */
  | "review_document_unavailable"
  /** 그룹의 `layout_step_id` 가 없는 Step 이거나 Classify 가 아님. */
  | "review_step_unavailable"
  | "result_not_editable";

export type IssueWhere =
  | {
      readonly kind: "page";
      readonly stepId: string | null;
      readonly groupId: string;
      readonly page: PageRef;
      readonly documentIds: readonly string[];
    }
  | {
      readonly kind: "document";
      readonly stepId: string | null;
      readonly documentId: string;
    }
  | {
      readonly kind: "field";
      readonly resultId: string;
      readonly pointer: string;
    }
  | { readonly kind: "upload"; readonly bytes: number; readonly limit: number }
  | { readonly kind: "job" };

/** 저장 전 검증 항목. 문구는 host 가 `code`·`where`·`detail` 로 만든다. */
export type ValidationIssue = {
  readonly code: IssueCode;
  readonly severity: "error" | "warning";
  readonly jobId: string;
  readonly where: IssueWhere;
  readonly detail?: Readonly<Record<string, string | number | boolean>>;
};
