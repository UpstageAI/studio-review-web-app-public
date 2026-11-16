import { describe, expect, it } from "vitest";

import {
  isResult,
  validateValues,
  type JsonObject,
  type Result,
  type ReviewJob,
  type ValidationIssue,
} from "@/lib/review-model";
import { singleJob } from "@/lib/review-model/__tests__/fixtures/builders";

import {
  boundErrorMessage,
  EMPTY_FIELD_ERRORS,
  fieldErrorsFrom,
  schemaErrorsFor,
  schemaIssueMessage,
  withServerError,
  type FieldError,
  type SchemaMessage,
} from "../field-errors";

const R = "occ_extract_1";

function schemaIssue(
  pointer: string,
  detail: Record<string, string | number>,
  severity: ValidationIssue["severity"] = "error",
  resultId = R,
): ValidationIssue {
  return {
    code: "schema_violation",
    severity,
    jobId: "job",
    where: { kind: "field", resultId, pointer },
    detail,
  };
}

const format = (message: SchemaMessage) =>
  `${message.key}(${Object.entries(message.values)
    .map(([key, value]) => `${key}=${value}`)
    .join(",")})`;

describe("schemaIssueMessage", () => {
  it("expected 마다 문구 키와 값", () => {
    expect(
      schemaIssueMessage(schemaIssue("/a", { expected: "string" })),
    ).toEqual({ key: "type", values: { expected: "string" } });
    expect(
      schemaIssueMessage(schemaIssue("/a", { expected: "number | null" })),
    ).toEqual({ key: "type", values: { expected: "number | null" } });
    expect(
      schemaIssueMessage(schemaIssue("/0", { expected: "object" })),
    ).toEqual({ key: "type", values: { expected: "object" } });
    expect(schemaIssueMessage(schemaIssue("/a", { expected: "enum" }))).toEqual(
      {
        key: "enum",
        values: {},
      },
    );
    expect(
      schemaIssueMessage(
        schemaIssue("", { expected: "required", missing: "b" }),
      ),
    ).toEqual({ key: "required", values: { missing: "b" } });
    expect(
      schemaIssueMessage(schemaIssue("/x", { expected: "known_key" })),
    ).toEqual({ key: "known_key", values: {} });
    expect(
      schemaIssueMessage(
        schemaIssue("/items", { expected: "min_items", limit: 2, count: 1 }),
      ),
    ).toEqual({ key: "min_items", values: { limit: 2, count: 1 } });
    expect(
      schemaIssueMessage(
        schemaIssue("/items", { expected: "max_items", limit: 3, count: 4 }),
      ),
    ).toEqual({ key: "max_items", values: { limit: 3, count: 4 } });
    expect(
      schemaIssueMessage(
        schemaIssue("/a", { expected: "min_length", limit: 3, count: 2 }),
      ),
    ).toEqual({ key: "min_length", values: { limit: 3, count: 2 } });
    expect(
      schemaIssueMessage(
        schemaIssue("/a", { expected: "max_length", limit: 2, count: 4 }),
      ),
    ).toEqual({ key: "max_length", values: { limit: 2, count: 4 } });
  });

  it("result_not_editable 은 null(잠금 칩이 이미 보인다)", () => {
    expect(
      schemaIssueMessage({
        code: "result_not_editable",
        severity: "error",
        jobId: "job",
        where: { kind: "field", resultId: R, pointer: "" },
        detail: { state: "running" },
      }),
    ).toBeNull();
  });
});

describe("fieldErrorsFrom", () => {
  it("문제가 없으면 공유 빈 Map", () => {
    expect(fieldErrorsFrom([], R, format)).toBe(EMPTY_FIELD_ERRORS);
  });

  it("같은 pointer 의 필수 필드 누락은 한 문구로 합친다", () => {
    const errors = fieldErrorsFrom(
      [
        schemaIssue("/0", { expected: "required", missing: "a" }),
        schemaIssue("/0", { expected: "required", missing: "b" }),
      ],
      R,
      format,
    );
    expect([...errors]).toEqual([
      ["/0", { message: "required(missing=a, b)", severity: "error" }],
    ]);
  });

  it("다른 문구는 ' · ' 로 잇고, 오류가 경고보다 앞선다", () => {
    const errors = fieldErrorsFrom(
      [
        schemaIssue(
          "/items",
          { expected: "min_items", limit: 2, count: 1 },
          "warning",
        ),
        schemaIssue("/items", { expected: "array" }),
        schemaIssue(
          "/other",
          { expected: "max_items", limit: 1, count: 2 },
          "warning",
        ),
      ],
      R,
      format,
    );
    expect(errors.get("/items")).toEqual({
      message: "min_items(limit=2,count=1) · type(expected=array)",
      severity: "error",
    });
    expect(errors.get("/other")?.severity).toBe("warning");
  });

  it("다른 결과의 문제는 넣지 않는다", () => {
    const errors = fieldErrorsFrom(
      [schemaIssue("/a", { expected: "enum" }, "error", "other")],
      R,
      format,
    );
    expect(errors.size).toBe(0);
  });

  it("validateValues 와 함께: schema 에 없는 키는 그 키 pointer", () => {
    const { doc, job } = singleJob();
    const schema: JsonObject = {
      type: "object",
      properties: { a: { type: "string" } },
    };
    const edited: ReviewJob = {
      ...job,
      output: job.output.map(item =>
        isResult(item) && item.id === R
          ? { ...item, content: { a: "x", extra: 1 } }
          : item,
      ),
    };
    const current = {
      ...doc,
      steps: {
        ...doc.steps,
        st_extract: { ...doc.steps.st_extract!, schema },
      },
      jobs: [edited],
    };
    const errors = fieldErrorsFrom(
      validateValues(current, edited, [R]),
      R,
      format,
    );
    expect([...errors]).toEqual([
      ["/extra", { message: "known_key()", severity: "error" }],
    ]);
  });
});

describe("schemaErrorsFor", () => {
  const resultOf = (): Result => {
    const { job } = singleJob();
    const found = job.output.find(
      (item): item is Result => isResult(item) && item.id === R,
    );
    if (!found) throw new Error("fixture result missing");
    return { ...found };
  };
  const counted = () => {
    let calls = 0;
    const compute = (): ReadonlyMap<string, FieldError> => {
      calls += 1;
      return new Map([["/a", { message: `m${calls}`, severity: "error" }]]);
    };
    return { compute, calls: () => calls };
  };

  it("같은 결과·Step schema·locale 이면 한 번만 계산해 같은 Map 을 돌려준다", () => {
    const result = resultOf();
    const steps = {};
    const { compute, calls } = counted();
    const first = schemaErrorsFor(result, steps, "ko", compute);
    expect(schemaErrorsFor(result, steps, "ko", compute)).toBe(first);
    expect(calls()).toBe(1);
  });

  it("locale·Step schema 가 바뀌면 다시 계산한다", () => {
    const result = resultOf();
    const steps = {};
    const { compute, calls } = counted();
    const first = schemaErrorsFor(result, steps, "ko", compute);
    const english = schemaErrorsFor(result, steps, "en", compute);
    expect(english).not.toBe(first);
    expect(calls()).toBe(2);
    expect(schemaErrorsFor(result, {}, "en", compute)).not.toBe(english);
    expect(calls()).toBe(3);
  });

  it("내용이 같아도 다른 결과 객체면 다시 계산한다", () => {
    const steps = {};
    const { compute, calls } = counted();
    const first = schemaErrorsFor(resultOf(), steps, "ko", compute);
    expect(schemaErrorsFor(resultOf(), steps, "ko", compute)).not.toBe(first);
    expect(calls()).toBe(2);
  });
});

describe("withServerError", () => {
  const local = fieldErrorsFrom(
    [schemaIssue("/a", { expected: "enum" })],
    R,
    format,
  );

  it("서버 pointer 가 있으면 그 행을 덮어쓴다", () => {
    const merged = withServerError(local, { message: "서버", pointer: "/a" });
    expect(merged.get("/a")).toEqual({ message: "서버", severity: "error" });
    expect(local.get("/a")?.message).toBe("enum()");
  });

  it("서버 오류가 없거나 pointer 가 없으면 로컬 그대로", () => {
    expect(withServerError(local, null)).toBe(local);
    expect(withServerError(local, { message: "서버", pointer: null })).toBe(
      local,
    );
  });

  it("로컬이 비어도 서버 행 오류를 더한다", () => {
    const merged = withServerError(EMPTY_FIELD_ERRORS, {
      message: "서버",
      pointer: "/0/b",
    });
    expect([...merged.keys()]).toEqual(["/0/b"]);
    expect(EMPTY_FIELD_ERRORS.size).toBe(0);
  });
});

describe("boundErrorMessage", () => {
  it("오류를 낸 값을 그대로 그리는 동안만 문구를 돌려준다", () => {
    const error = { value: 12, message: "숫자가 아닙니다" };
    expect(boundErrorMessage(error, 12)).toBe("숫자가 아닙니다");
    expect(boundErrorMessage(null, 12)).toBeNull();
  });

  it("행이 다른 항목을 그리게 되면(삭제·이동) 문구를 버린다", () => {
    const error = { value: { a: 1 }, message: "x" };
    expect(boundErrorMessage(error, { a: 2 })).toBeNull();
    expect(boundErrorMessage(error, null)).toBeNull();
    expect(boundErrorMessage(error, { a: 1 })).toBe("x");
  });
});
