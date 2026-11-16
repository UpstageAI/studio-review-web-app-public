import { useTranslations } from "next-intl";
import { ApiError } from "@/lib/review-api/client";
import { apiErrorInfo } from "@/lib/review-api/error-info";

const KNOWN_ERROR_CODES = [
  "server_misconfigured",
  "api_unreachable",
  "upstream_timeout",
  "network_error",
] as const;

type KnownErrorCode = (typeof KNOWN_ERROR_CODES)[number];

function isKnownCode(code: string): code is KnownErrorCode {
  return (KNOWN_ERROR_CODES as readonly string[]).includes(code);
}

/** 오류 코드 문자열. `ApiError` 가 아니면 `unknown_error`. */
export function errorCodeOf(error: unknown): string {
  return apiErrorInfo(error).code;
}

/** 오류를 사용자 문구로 바꾼다. 아는 코드·상태가 아니면 일반 문구. */
export function useErrorMessage(): (error: unknown) => string {
  const t = useTranslations("collections.errors");
  return error => {
    if (!(error instanceof ApiError)) return t("generic");
    if (isKnownCode(error.code)) return t(error.code);
    if (error.status === 401 || error.status === 403) return t("unauthorized");
    if (error.status === 404) return t("not_found");
    return t("generic");
  };
}
