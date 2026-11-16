// 저장 중 만나는 오류 코드 중 `review.errors.<code>` 문구가 있는 것. 없는 코드는 코드 그대로 보인다.
export const SAVE_ERROR_CODES = [
  // BFF·동기 오류
  "server_misconfigured",
  "api_unreachable",
  "upstream_timeout",
  "upstream_redirect",
  "forbidden",
  "package_limit_exceeded",
  "invalid_value",
  "network_error",
  "http_error",
  "invalid_response",
  "review_target_not_found",
  "collection_source_type_unsupported",
  "collection_review_disabled",
  "operation_capacity_exceeded",
  "artifact_unavailable",
  "idempotency_key_reused",
  "unsupported_media_type",
  "review_import_not_found",
  "invalid_document",
  // 가져오기 `failed`
  "unsupported_review_format",
  "base_version_conflict",
  "schema_violation",
  "mixed_file_result",
  "review_target_mismatch",
  "review_step_mismatch",
  "review_step_unavailable",
  "review_group_unavailable",
  "review_document_unavailable",
  "review_file_unavailable",
  "review_source_unavailable",
  "review_limit_exceeded",
  "duplicate_review_file",
  "page_out_of_range",
  "duplicate_review_page",
  "page_overlap",
  "page_missing",
  "label_not_in_config",
  "permission_revoked",
  "upload_checksum_mismatch",
  "operation_expired",
  "artifact_too_large",
  "unit_too_large",
  "invalid_import_resource",
  "unknown_import_status",
  // 클라이언트 검증
  "result_not_editable",
] as const;

export type SaveErrorCode = (typeof SAVE_ERROR_CODES)[number];

export function isSaveErrorCode(code: string): code is SaveErrorCode {
  return (SAVE_ERROR_CODES as readonly string[]).includes(code);
}

/** 바이트 수를 KB·MB 로(단위 기호는 번역하지 않는다). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
