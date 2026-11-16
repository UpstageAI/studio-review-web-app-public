import { describe, expect, it } from "vitest";

import { ReviewModelError } from "../errors";
import {
  isExactNumber,
  isIntegerNumber,
  isJsonNumber,
  isJsonObject,
  parseJson,
  stringifyJson,
  type JsonObject,
  type JsonValue,
} from "../json";
import { normalizeDocument, readReviewDocument } from "../normalize";
import { isResult, type Layout, type Result } from "../types";
import {
  MULTI_LAYOUT,
  NO_LOOKUPS,
  SINGLE_JOB,
  V11_SCHEMA,
} from "./fixtures/fixtures";

function errorOf(fn: () => unknown): ReviewModelError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ReviewModelError) return error;
    throw error;
  }
  throw new Error("expected ReviewModelError");
}

function resultsOf(text: string): Result[] {
  return readReviewDocument(text).jobs.flatMap(job =>
    job.output.filter(isResult),
  );
}

/** fixture 를 고친 문자열로 다시 읽는다(`parseJson` → 수정 → `stringifyJson`). */
function mutate(text: string, edit: (root: JsonObject) => void): string {
  const root = parseJson(text) as JsonObject;
  edit(root);
  return stringifyJson(root);
}

function firstJob(root: JsonObject): JsonObject {
  return (root.jobs as JsonValue[])[0] as JsonObject;
}

// ---------------------------------------------------------------------------
// fixture 가 v11 Schema 를 따르는지 확인하는 최소 검사기(테스트 전용)
// ---------------------------------------------------------------------------

function schemaErrors(text: string): string[] {
  const root = parseJson(V11_SCHEMA) as JsonObject;
  const errors: string[] = [];
  const resolve = (node: JsonObject): JsonObject => {
    const ref = node.$ref;
    if (typeof ref !== "string") return node;
    const name = ref.replace("#/$defs/", "");
    return resolve((root.$defs as JsonObject)[name] as JsonObject);
  };
  const typeOk = (type: string, value: JsonValue) =>
    type === "null"
      ? value === null
      : type === "string"
        ? typeof value === "string"
        : type === "boolean"
          ? typeof value === "boolean"
          : type === "integer"
            ? isJsonNumber(value) && isIntegerNumber(value)
            : type === "number"
              ? isJsonNumber(value)
              : type === "array"
                ? Array.isArray(value)
                : type === "object"
                  ? isJsonObject(value)
                  : true;
  const check = (raw: JsonObject, value: JsonValue, at: string): void => {
    const node = resolve(raw);
    if (isJsonObject(node.if)) {
      const req = (node.if.required as string[]) ?? [];
      const branch =
        isJsonObject(value) && req.every(key => Object.hasOwn(value, key))
          ? node.then
          : node.else;
      if (isJsonObject(branch)) check(branch, value, at);
    }
    if (node.const !== undefined && node.const !== value)
      errors.push(`${at}: const`);
    if (Array.isArray(node.enum) && !node.enum.includes(value as never)) {
      errors.push(`${at}: enum`);
    }
    const types = [node.type ?? []].flat() as string[];
    if (types.length && !types.some(type => typeOk(type, value))) {
      errors.push(`${at}: type ${types.join("|")}`);
      return;
    }
    if (typeof value === "string") {
      if (
        typeof node.pattern === "string" &&
        !new RegExp(node.pattern).test(value)
      ) {
        errors.push(`${at}: pattern`);
      }
      if (typeof node.minLength === "number" && value.length < node.minLength) {
        errors.push(`${at}: minLength`);
      }
    }
    if (typeof value === "number") {
      if (typeof node.minimum === "number" && value < node.minimum)
        errors.push(`${at}: minimum`);
      if (typeof node.maximum === "number" && value > node.maximum)
        errors.push(`${at}: maximum`);
    }
    if (Array.isArray(value)) {
      if (typeof node.minItems === "number" && value.length < node.minItems) {
        errors.push(`${at}: minItems`);
      }
      if (typeof node.maxItems === "number" && value.length > node.maxItems) {
        errors.push(`${at}: maxItems`);
      }
      if (isJsonObject(node.items)) {
        value.forEach((item, i) =>
          check(node.items as JsonObject, item, `${at}/${i}`),
        );
      }
    }
    if (isJsonObject(value) && !isExactNumber(value)) {
      for (const key of (node.required as string[]) ?? []) {
        if (!Object.hasOwn(value, key)) errors.push(`${at}: required ${key}`);
      }
      const properties = (node.properties as JsonObject) ?? {};
      for (const key of Object.keys(value)) {
        const child = Object.hasOwn(properties, key)
          ? properties[key]
          : undefined;
        if (isJsonObject(child))
          check(child, value[key] as JsonValue, `${at}/${key}`);
        else if (node.additionalProperties === false)
          errors.push(`${at}: extra ${key}`);
        else if (isJsonObject(node.additionalProperties)) {
          check(
            node.additionalProperties,
            value[key] as JsonValue,
            `${at}/${key}`,
          );
        }
      }
    }
  };
  check(root, parseJson(text), "");
  return errors;
}

describe("fixture", () => {
  it.each([
    ["single-job", SINGLE_JOB],
    ["multi-layout", MULTI_LAYOUT],
    ["no-lookups", NO_LOOKUPS],
  ])("%s 는 v11 Schema 를 따른다", (_name, text) => {
    expect(schemaErrors(text)).toEqual([]);
  });

  it("검사기가 Schema 위반을 실제로 잡는다", () => {
    const broken = mutate(SINGLE_JOB, root => {
      firstJob(root).extra = 1;
    });
    expect(schemaErrors(broken)).toEqual(["/jobs/0: extra extra"]);
  });
});

describe("readReviewDocument", () => {
  it("single-job 을 읽고 정밀 숫자를 보존한다", () => {
    const doc = readReviewDocument(SINGLE_JOB);
    expect(doc.format).toBe("collection-results/11");
    expect(doc.steps.st_classify?.labels).toEqual([
      "invoice",
      "receipt",
      "contract",
    ]);
    const job = doc.jobs[0]!;
    expect(
      job.file_groups?.groups[0]?.files.map(file => file.num_pages),
    ).toEqual([3, 2]);
    const extract = job.output.find(
      (item): item is Result => isResult(item) && item.id === "occ_extract_1",
    )!;
    expect(stringifyJson(extract.content)).toContain(
      '"amount":12345678901234567890',
    );
    expect(stringifyJson(extract.content)).toContain(
      '"rate":0.1234567890123456789',
    );
    expect(stringifyJson(extract.content)).toContain('"scale":1E2,"delta":-0');
  });

  it("state 없음 → present, 있으면 그대로", () => {
    expect(
      Object.fromEntries(
        resultsOf(SINGLE_JOB).map(result => [result.id, result.state]),
      ),
    ).toEqual({
      occ_extract_1: "present",
      occ_extract_2: "input_changed",
      occ_merge_1: "present",
      occ_validate_1: "stale",
    });
  });

  it("document_ids·field_groups·없음 → link 3 종", () => {
    const links = Object.fromEntries(
      [...resultsOf(SINGLE_JOB), ...resultsOf(NO_LOOKUPS)].map(result => [
        result.id,
        result.link,
      ]),
    );
    expect(links.occ_extract_1).toEqual({
      kind: "documents",
      document_ids: ["doc_1"],
    });
    expect(links.occ_merge_1).toEqual({
      kind: "field_groups",
      field_groups: { invoice: ["doc_1", "doc_2"] },
    });
    expect(links.occ_v_1).toEqual({ kind: "none" });
  });

  it("document_ids 와 field_groups 가 함께 있으면 거부", () => {
    const text = mutate(SINGLE_JOB, root => {
      const result = (firstJob(root).output as JsonObject[])[1]!;
      result.field_groups = { a: ["doc_1"] };
    });
    expect(errorOf(() => readReviewDocument(text)).pointer).toBe(
      "/jobs/0/output/1",
    );
  });

  it("excluded_* 가 없으면 [] 로 채운다", () => {
    const fileGroups = readReviewDocument(NO_LOOKUPS).jobs[0]!.file_groups!;
    expect(fileGroups.excluded_pages).toEqual([]);
    expect(fileGroups.excluded_documents).toEqual([]);
  });

  it("조회 정보가 없어도 읽는다(no-lookups)", () => {
    const doc = readReviewDocument(NO_LOOKUPS);
    expect(doc.steps.st_extract).toEqual({
      config_id: "cfg_1",
      name: "추출",
      type: "information-extract",
    });
    const file = doc.jobs[0]!.file_groups!.groups[0]!.files[0]!;
    expect(file.num_pages).toBeUndefined();
    expect(Object.hasOwn(file, "num_pages")).toBe(false);
    expect((doc.jobs[0]!.output[0] as Layout).step_id).toBeNull();
    expect(doc.jobs[1]!.file_groups).toBeUndefined();
  });

  it("checks·source 읽기 전용 키를 보관한다", () => {
    const text = mutate(SINGLE_JOB, root => {
      const result = (firstJob(root).output as JsonObject[])[1]!;
      result.source = { job_id: "job_Z", occurrence_id: null };
    });
    const results = resultsOf(text);
    expect(results[0]?.source).toEqual({
      job_id: "job_Z",
      occurrence_id: null,
    });
    expect(results[3]?.checks?.[0]?.passed).toBe(true);
  });

  it("format 이 다르면 unsupported_review_format", () => {
    const text = SINGLE_JOB.replace(
      "collection-results/11",
      "collection-results/9",
    );
    const error = errorOf(() => readReviewDocument(text));
    expect(error.code).toBe("unsupported_review_format");
    expect(error.details).toEqual({ format: "collection-results/9" });
  });

  it("필수 키가 없으면 invalid_document + pointer", () => {
    const text = mutate(SINGLE_JOB, root => {
      delete firstJob(root).output;
    });
    const error = errorOf(() => readReviewDocument(text));
    expect(error.code).toBe("invalid_document");
    expect(error.pointer).toBe("/jobs/0/output");
  });

  it("타입이 틀리면 그 위치의 pointer", () => {
    const text = mutate(SINGLE_JOB, root => {
      const layout = (firstJob(root).output as JsonObject[])[0]!;
      const documents = (layout.content as JsonObject)
        .documents as JsonObject[];
      documents[1]!.label = 3;
    });
    expect(errorOf(() => readReviewDocument(text)).pointer).toBe(
      "/jobs/0/output/0/content/documents/1/label",
    );
  });

  it("결과 id 중복은 거부", () => {
    const text = SINGLE_JOB.replace(
      '"id": "occ_extract_2"',
      '"id": "occ_extract_1"',
    );
    const error = errorOf(() => readReviewDocument(text));
    expect(error.code).toBe("invalid_document");
    expect(error.pointer).toBe("/jobs/0/output/2/id");
    expect(error.details).toEqual({ reason: "duplicate_result_id" });
  });

  it("file_ref 패턴·중복을 검사한다", () => {
    expect(
      errorOf(() =>
        readReviewDocument(
          SINGLE_JOB.replace('"job_A#1", "file_id"', '"job_A#01", "file_id"'),
        ),
      ).details,
    ).toEqual({ reason: "file_ref_pattern" });
    expect(
      errorOf(() =>
        readReviewDocument(
          SINGLE_JOB.replace('"job_A#1", "file_id"', '"job_A#0", "file_id"'),
        ),
      ).details,
    ).toEqual({ reason: "duplicate_file_ref" });
  });

  it("같은 Job 의 같은 step_id 보기 중복은 거부", () => {
    const text = mutate(MULTI_LAYOUT, root => {
      const output = firstJob(root).output as JsonObject[];
      output[1]!.step_id = "st_classify_a";
    });
    expect(errorOf(() => readReviewDocument(text)).details).toEqual({
      reason: "duplicate_layout_step",
    });
  });

  it("parseJson 오류(중복 키)를 그대로 던진다", () => {
    expect(
      errorOf(() => readReviewDocument('{"format":1,"format":2}')).code,
    ).toBe("duplicate_key");
  });

  it("normalizeDocument 는 루트가 객체가 아니면 거부", () => {
    expect(errorOf(() => normalizeDocument([])).code).toBe("invalid_document");
  });
});
