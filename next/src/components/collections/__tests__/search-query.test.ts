import { describe, expect, it } from "vitest";

import { collectionHref, jobHref } from "../links";
import { filterQueryOf, isJobIdInput, isTooShortQuery } from "../search-query";

describe("검색 입력 해석", () => {
  it("job_ 형식은 Job ID 로 보고 목록 필터로 쓰지 않는다", () => {
    expect(isJobIdInput("job_abc-123_X")).toBe(true);
    expect(isJobIdInput("  job_abc  ")).toBe(true);
    expect(filterQueryOf("job_abc")).toBeUndefined();
  });

  it("job_ 형식이 아니면 Job ID 가 아니다", () => {
    for (const value of ["job_", "job_a b", "Job_abc", "xjob_abc", "job_a/b"]) {
      expect(isJobIdInput(value)).toBe(false);
    }
    expect(isJobIdInput(`job_${"a".repeat(125)}`)).toBe(false);
  });

  it("2 자 이상만 필터로 쓰고 앞뒤 공백을 뺀다", () => {
    expect(filterQueryOf("")).toBeUndefined();
    expect(filterQueryOf("a")).toBeUndefined();
    expect(filterQueryOf("  ab ")).toBe("ab");
    expect(filterQueryOf("보고")).toBe("보고");
  });

  it("길이는 코드 포인트로 센다", () => {
    expect(filterQueryOf("😀")).toBeUndefined();
    expect(filterQueryOf("😀😀")).toBe("😀😀");
    expect(filterQueryOf("a".repeat(200))).toBe("a".repeat(200));
    expect(filterQueryOf("a".repeat(201))).toBeUndefined();
  });

  it("1 자 입력만 짧다고 안내한다", () => {
    expect(isTooShortQuery("a")).toBe(true);
    expect(isTooShortQuery("")).toBe(false);
    expect(isTooShortQuery("  ")).toBe(false);
    expect(isTooShortQuery("ab")).toBe(false);
    expect(isTooShortQuery("job_a")).toBe(false);
  });
});

describe("내부 경로", () => {
  it("세그먼트를 인코딩한다", () => {
    expect(collectionHref("col_1")).toBe("/collections/col_1");
    expect(jobHref("col 1", "job_a")).toBe("/collections/col%201/jobs/job_a");
  });
});
