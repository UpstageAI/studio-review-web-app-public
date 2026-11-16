import { apiErrorInfo } from "@/lib/review-api/review-screen";
import { isReviewModelError } from "@/lib/review-model";

/** 검수 화면의 오류 코드. 모델 오류는 그 코드, BFF 오류는 `ApiError` 코드, 그 밖은 `unknown_error`. */
export function reviewErrorCode(err: unknown): string {
  return isReviewModelError(err) ? err.code : apiErrorInfo(err).code;
}
