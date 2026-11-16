import { describe, expect, it } from "vitest";

import { ReviewModelError } from "../errors";
import { parseJson, stringifyJson, type JsonObject } from "../json";
import { readReviewDocument } from "../normalize";
import { openJobReview } from "../open-job-review";
import { SINGLE_JOB } from "./fixtures/fixtures";

/** `SINGLE_JOB` 의 `jobs` 배열을 바꾼 문자열. 정밀 숫자를 잃지 않게 `parseJson` 을 거친다. */
function withJobs(change: (jobs: JsonObject[]) => JsonObject[]): string {
  const root = parseJson(SINGLE_JOB) as JsonObject;
  return stringifyJson({ ...root, jobs: change(root.jobs as JsonObject[]) });
}

function errorOf(fn: () => unknown): ReviewModelError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ReviewModelError) return error;
    throw error;
  }
  throw new Error("expected ReviewModelError");
}

describe("openJobReview", () => {
  it("Job 이 하나이고 id 가 같으면 readReviewDocument 와 같은 문서를 돌려준다", () => {
    expect(openJobReview(SINGLE_JOB, "job_A")).toEqual(
      readReviewDocument(SINGLE_JOB),
    );
  });

  it("Job 이 없으면 invalid_document(/jobs)", () => {
    const error = errorOf(() =>
      openJobReview(
        withJobs(() => []),
        "job_A",
      ),
    );
    expect(error.code).toBe("invalid_document");
    expect(error.pointer).toBe("/jobs");
  });

  it("Job 이 둘이면 첫 id 가 같아도 invalid_document(/jobs)", () => {
    const text = withJobs(jobs => [jobs[0]!, { id: "job_B", output: [] }]);
    const error = errorOf(() => openJobReview(text, "job_A"));
    expect(error.code).toBe("invalid_document");
    expect(error.pointer).toBe("/jobs");
  });

  it("id 가 다르면 invalid_document(/jobs)", () => {
    const error = errorOf(() => openJobReview(SINGLE_JOB, "job_other"));
    expect(error.code).toBe("invalid_document");
    expect(error.pointer).toBe("/jobs");
  });

  it("파싱·정규화 오류는 그대로 던진다", () => {
    expect(errorOf(() => openJobReview("{", "job_A")).code).toBe(
      "invalid_json",
    );
    const unsupported = SINGLE_JOB.replace(
      "collection-results/11",
      "collection-results/10",
    );
    expect(errorOf(() => openJobReview(unsupported, "job_A")).code).toBe(
      errorOf(() => readReviewDocument(unsupported)).code,
    );
  });
});
