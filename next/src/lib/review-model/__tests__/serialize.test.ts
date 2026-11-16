import { describe, expect, it } from "vitest";

import { applyEntry } from "../changes";
import { ExactNumber, jsonEquals, parseJson, stringifyJson } from "../json";
import { readReviewDocument } from "../normalize";
import { serializeReviewDocument } from "../serialize";
import { twoGroupDoc } from "./fixtures/builders";
import { MULTI_LAYOUT, NO_LOOKUPS, SINGLE_JOB } from "./fixtures/fixtures";

const roundTrip = (text: string) => {
  const doc = readReviewDocument(text);
  const again = readReviewDocument(stringifyJson(serializeReviewDocument(doc)));
  return { doc, again };
};

describe("serializeReviewDocument", () => {
  it.each([
    ["single-job", SINGLE_JOB],
    ["multi-layout", MULTI_LAYOUT],
    ["no-lookups", NO_LOOKUPS],
  ])("왕복하면 같은 문서 (%s)", (_name, text) => {
    const { doc, again } = roundTrip(text);
    expect(jsonEquals(again, doc)).toBe(true);
  });

  it("두 그룹·제외 페이지·제외 문서도 왕복", () => {
    const doc = twoGroupDoc();
    const again = readReviewDocument(
      stringifyJson(serializeReviewDocument(doc)),
    );
    expect(jsonEquals(again, doc)).toBe(true);
  });

  it("숫자 원문 토큰을 그대로 낸다(ExactNumber)", () => {
    const { doc } = roundTrip(SINGLE_JOB);
    const text = stringifyJson(serializeReviewDocument(doc));
    expect(text).toContain('"amount":12345678901234567890');
    expect(text).toContain('"rate":0.1234567890123456789');
    const result = doc.jobs[0]!.output.find(
      item => "id" in item && item.id === "occ_extract_1",
    );
    expect(result && "content" in result).toBe(true);
    const content = (result as { content: Record<string, unknown> }).content;
    expect(content.amount).toBeInstanceOf(ExactNumber);
  });

  it("state present 는 생략, 연결은 document_ids 또는 field_groups 하나만", () => {
    const { doc } = roundTrip(SINGLE_JOB);
    const wire = parseJson(stringifyJson(serializeReviewDocument(doc))) as {
      jobs: { output: Record<string, unknown>[] }[];
    };
    const byId = new Map(
      wire.jobs[0]!.output.filter(item => "id" in item).map(item => [
        item.id,
        item,
      ]),
    );
    const present = byId.get("occ_extract_1")!;
    expect(Object.hasOwn(present, "state")).toBe(false);
    expect(present.document_ids).toEqual(["doc_1"]);
    expect(Object.hasOwn(present, "field_groups")).toBe(false);
    expect(byId.get("occ_extract_2")!.state).toBe("input_changed");
    const merge = byId.get("occ_merge_1")!;
    expect(merge.field_groups).toEqual({ invoice: ["doc_1", "doc_2"] });
    expect(Object.hasOwn(merge, "document_ids")).toBe(false);
    expect(byId.get("occ_validate_1")!.checks).toEqual([
      {
        name: "amount_positive",
        severity: "error",
        passed: true,
        reason: "amount > 0",
      },
    ]);
  });

  it("읽기 전용 조회 정보(labels·schema·num_pages·input_index)를 싣는다", () => {
    const { doc } = roundTrip(SINGLE_JOB);
    const wire = serializeReviewDocument(doc) as {
      steps: Record<string, Record<string, unknown>>;
      jobs: {
        file_groups: { groups: { files: Record<string, unknown>[] }[] };
      }[];
    };
    expect(wire.steps.st_classify!.labels).toEqual([
      "invoice",
      "receipt",
      "contract",
    ]);
    expect(wire.steps.st_extract!.schema).toBeDefined();
    expect(wire.jobs[0]!.file_groups.groups[0]!.files[0]).toEqual({
      file_ref: "job_A#0",
      file_id: "file_1",
      name: "a.pdf",
      num_pages: 3,
      input_index: 0,
    });
  });

  it("연결 없는 결과는 연결 키가 없다", () => {
    const { doc } = roundTrip(NO_LOOKUPS);
    const wire = serializeReviewDocument(doc) as {
      jobs: { output: Record<string, unknown>[] }[];
    };
    const values = wire.jobs[1]!.output[0]!;
    expect(Object.hasOwn(values, "document_ids")).toBe(false);
    expect(Object.hasOwn(values, "field_groups")).toBe(false);
    expect(Object.hasOwn(wire.jobs[1]!, "file_groups")).toBe(false);
  });

  it("편집본도 왕복한다", () => {
    const { doc } = roundTrip(SINGLE_JOB);
    const outcome = applyEntry(doc, {
      kind: "set_label",
      jobId: "job_A",
      stepId: "st_classify",
      documentId: "doc_1",
      label: "receipt",
    });
    if (!outcome.ok) throw new Error(outcome.reason);
    const again = readReviewDocument(
      stringifyJson(serializeReviewDocument(outcome.job), { pretty: true }),
    );
    expect(jsonEquals(again, outcome.job)).toBe(true);
  });
});
