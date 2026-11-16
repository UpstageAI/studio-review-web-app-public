import { describe, expect, it } from "vitest";

import {
  adoptAppliedVersions,
  isTerminalStatus,
  parseImportOutcome,
  retryAfterMs,
} from "../imports";
import { stringifyJson } from "../json";
import { findLayout, findResult } from "../layout";
import { singleJob } from "./fixtures/builders";

describe("adoptAppliedVersions", () => {
  it("s: 는 file_groups 와 모든 layout, v: 는 결과 base_version — 입력 불변", () => {
    const { doc } = singleJob();
    const before = stringifyJson(doc);
    const adopted = adoptAppliedVersions(doc, [
      {
        status: "applied",
        applied_versions: { "s:job_A": 4, "v:occ_extract_1": 7 },
        copy_id_map: null,
      },
    ]);
    expect(adopted.current).toBe(true);
    expect(adopted.unmatched).toEqual([]);
    const job = adopted.doc.jobs[0]!;
    expect(job.file_groups!.base_version).toBe(4);
    expect(findLayout(job, "st_classify")!.base_version).toBe(4);
    expect(findResult(job, "occ_extract_1")!.base_version).toBe(7);
    expect(findResult(job, "occ_extract_2")!.base_version).toBe(1);
    expect(stringifyJson(doc)).toBe(before);
  });

  it("copy_id_map·짝 없는 키·미적용 unit 이면 current false", () => {
    const { doc } = singleJob();
    expect(
      adoptAppliedVersions(doc, [
        { status: "applied", applied_versions: {}, copy_id_map: { a: "b" } },
      ]).current,
    ).toBe(false);
    const unmatched = adoptAppliedVersions(doc, [
      { status: "applied", applied_versions: { "v:occ_gone": 1, "x:bad": 1 } },
    ]);
    expect(unmatched.current).toBe(false);
    expect(unmatched.unmatched.sort()).toEqual(["v:occ_gone", "x:bad"]);
    expect(adoptAppliedVersions(doc, [{ status: "conflict" }]).current).toBe(
      false,
    );
    expect(adoptAppliedVersions(doc, []).current).toBe(true);
  });
});

describe("parseImportOutcome", () => {
  it("applied·no_change·partially_applied", () => {
    expect(
      parseImportOutcome({ status: "applied", units: [{ status: "applied" }] }),
    ).toEqual({ kind: "applied", units: [{ status: "applied" }] });
    expect(parseImportOutcome({ status: "no_change", units: [] }).kind).toBe(
      "no_change",
    );
    expect(parseImportOutcome({ status: "partially_applied" }).kind).toBe(
      "partially_applied",
    );
  });

  it("base_version_conflict → conflict", () => {
    expect(
      parseImportOutcome({
        status: "failed",
        error: {
          code: "base_version_conflict",
          details: {
            conflicts: [
              {
                target: {
                  kind: "value",
                  job_id: "job_A",
                  occurrence_id: "occ_1",
                },
                base: 1,
                current: 2,
              },
              {
                target: { kind: "structure", job_id: "job_A" },
                base: 3,
                current: 4,
              },
              { target: { kind: "other" } },
            ],
          },
        },
      }),
    ).toEqual({
      kind: "conflict",
      conflicts: [
        {
          target: { kind: "value", job_id: "job_A", occurrence_id: "occ_1" },
          base: 1,
          current: 2,
        },
        { target: { kind: "structure", job_id: "job_A" }, base: 3, current: 4 },
      ],
    });
  });

  it("그 외 failed 는 code·pointer·message", () => {
    expect(
      parseImportOutcome({
        status: "failed",
        error: {
          code: "schema_violation",
          message: "invalid",
          details: {
            errors: [
              { pointer: "/jobs/0/output/2/content/amount", message: "bad" },
            ],
          },
        },
      }),
    ).toEqual({
      kind: "failed",
      code: "schema_violation",
      pointer: "/jobs/0/output/2/content/amount",
      message: "bad",
    });
  });

  it("cancelled·pending·알 수 없는 모양", () => {
    expect(
      parseImportOutcome({
        status: "cancelled",
        error: { code: "operation_expired" },
      }),
    ).toEqual({ kind: "cancelled", code: "operation_expired" });
    expect(parseImportOutcome({ status: "applying" })).toEqual({
      kind: "pending",
      status: "applying",
    });
    expect(parseImportOutcome({ status: "weird" })).toEqual({
      kind: "failed",
      code: "unknown_import_status",
    });
    expect(parseImportOutcome("x")).toEqual({
      kind: "failed",
      code: "invalid_import_resource",
    });
  });

  it("isTerminalStatus", () => {
    for (const status of [
      "applied",
      "partially_applied",
      "no_change",
      "failed",
      "cancelled",
    ]) {
      expect(isTerminalStatus(status)).toBe(true);
    }
    for (const status of ["pending", "ready", "applying", 1]) {
      expect(isTerminalStatus(status)).toBe(false);
    }
  });
});

describe("retryAfterMs", () => {
  it("정수 초·cap·fallback", () => {
    expect(retryAfterMs("2")).toBe(2000);
    expect(retryAfterMs("30")).toBe(10_000);
    expect(retryAfterMs(null)).toBe(2000);
    expect(retryAfterMs("Wed, 21 Oct 2026 07:28:00 GMT")).toBe(2000);
    expect(retryAfterMs("1.5", { fallbackMs: 500 })).toBe(500);
    expect(retryAfterMs("5", { capMs: 3000 })).toBe(3000);
  });
});
