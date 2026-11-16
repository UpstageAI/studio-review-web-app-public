import { describe, expect, it } from "vitest";

import { readReviewDocument } from "@/lib/review-model";

import { MULTI_LAYOUT } from "../../review-model/__tests__/fixtures/fixtures";
import { singleJob } from "../../review-model/__tests__/fixtures/builders";
import {
  currentVersionOf,
  isCurrentRevision,
  machineTargetKey,
  machineTargets,
} from "../versions";
import { revision } from "./helpers";

describe("현재 반영본 판정", () => {
  const { job } = singleJob();

  it("값은 결과의 base_version 과 비교한다", () => {
    expect(currentVersionOf(job, revision())).toBe(2);
    expect(isCurrentRevision(job, revision({ version: 2 }))).toBe(true);
    expect(isCurrentRevision(job, revision({ version: 1 }))).toBe(false);
  });

  it("구조는 file_groups.base_version 과 비교한다", () => {
    const structure = revision({ type: "structure", result: null, version: 3 });
    expect(currentVersionOf(job, structure)).toBe(3);
    expect(isCurrentRevision(job, structure)).toBe(true);
  });

  it("대상이 없으면 null 이고 현재가 아니다", () => {
    const missing = revision({
      result: { occurrence_id: "occ_none", step_id: "st_extract" },
    });
    expect(currentVersionOf(job, missing)).toBeNull();
    expect(isCurrentRevision(job, missing)).toBe(false);
    const noGroups = { ...job, file_groups: undefined };
    expect(
      currentVersionOf(noGroups, revision({ type: "structure", result: null })),
    ).toBeNull();
  });
});

describe("machineTargets", () => {
  it("base_version > 0 인 구조와 결과만, 구조가 먼저", () => {
    const { job } = singleJob();
    const targets = machineTargets(job);
    expect(targets).toEqual([
      { type: "structure" },
      { type: "result", occurrenceId: "occ_extract_1", stepId: "st_extract" },
      { type: "result", occurrenceId: "occ_extract_2", stepId: "st_extract" },
    ]);
    expect(targets.map(machineTargetKey)).toEqual([
      "structure",
      "result:occ_extract_1",
      "result:occ_extract_2",
    ]);
  });

  it("전부 0 이면 빈 배열", () => {
    const job = readReviewDocument(MULTI_LAYOUT).jobs[0]!;
    expect(machineTargets(job)).toEqual([]);
  });
});
