import { describe, expect, it } from "vitest";
import { ReviewModelError } from "@/lib/review-model";
import { ApiError } from "../client";
import { apiErrorInfo } from "../error-info";

describe("apiErrorInfo", () => {
  it("ApiError 는 코드·상태·Retry-After 를 그대로 읽는다", () => {
    const err = new ApiError(429, "rate_limited", "slow down", {
      retryAfter: "3",
    });
    expect(apiErrorInfo(err)).toEqual({
      code: "rate_limited",
      status: 429,
      retryAfter: "3",
    });
  });

  it("연결 실패(status 0)·Retry-After 없음도 그대로", () => {
    const err = new ApiError(0, "network_error", "Could not reach the server");
    expect(apiErrorInfo(err)).toEqual({
      code: "network_error",
      status: 0,
      retryAfter: null,
    });
  });

  it("ReviewModelError 는 ApiError 가 아니므로 unknown_error", () => {
    const err = new ReviewModelError("invalid_document", { pointer: "/jobs" });
    expect(apiErrorInfo(err)).toEqual({
      code: "unknown_error",
      status: null,
      retryAfter: null,
    });
  });

  it("일반 Error·문자열·null 도 unknown_error", () => {
    for (const err of [new Error("boom"), "boom", null, undefined]) {
      expect(apiErrorInfo(err)).toEqual({
        code: "unknown_error",
        status: null,
        retryAfter: null,
      });
    }
  });
});
