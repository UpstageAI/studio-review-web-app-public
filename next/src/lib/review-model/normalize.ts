import { ReviewModelError } from "./errors";
import {
  isJsonObject,
  parseJson,
  type JsonObject,
  type JsonValue,
  type ParseJsonOptions,
} from "./json";
import {
  REVIEW_FORMAT,
  type FileGroup,
  type FileGroups,
  type Layout,
  type OutputItem,
  type PageRange,
  type Result,
  type ResultCheck,
  type ResultLink,
  type ResultSource,
  type ReviewConfig,
  type ReviewDocument,
  type ReviewDocumentEntry,
  type ReviewFile,
  type ReviewJob,
  type ReviewStep,
  type SourceRange,
} from "./types";

/** `"<원본 Job ID>#<input_index>"` — Schema `$defs/file/properties/file_ref/pattern`. */
export const FILE_REF_PATTERN = /^.+#(0|[1-9][0-9]*)$/;

function invalid(pointer: string, reason: string): never {
  throw new ReviewModelError("invalid_document", {
    pointer,
    details: { reason },
  });
}

function own(object: JsonObject, key: string): JsonValue | undefined {
  return Object.hasOwn(object, key) ? object[key] : undefined;
}

function at(pointer: string, key: string | number): string {
  return `${pointer}/${String(key).replace(/~/g, "~0").replace(/\//g, "~1")}`;
}

function objectAt(value: JsonValue | undefined, pointer: string): JsonObject {
  if (!isJsonObject(value)) return invalid(pointer, "expected_object");
  return value;
}

function arrayAt(value: JsonValue | undefined, pointer: string): JsonValue[] {
  if (!Array.isArray(value)) return invalid(pointer, "expected_array");
  return value;
}

function stringAt(value: JsonValue | undefined, pointer: string): string {
  if (typeof value !== "string") return invalid(pointer, "expected_string");
  return value;
}

function nullableStringAt(
  value: JsonValue | undefined,
  pointer: string,
): string | null {
  if (value === null) return null;
  return stringAt(value, pointer);
}

/** 정수(`number`). 버전·페이지는 `Number` 로 정확히 표현되는 범위라 `ExactNumber` 는 거부한다. */
function integerAt(
  value: JsonValue | undefined,
  pointer: string,
  minimum?: number,
): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return invalid(pointer, "expected_integer");
  }
  if (minimum !== undefined && value < minimum) {
    return invalid(pointer, "below_minimum");
  }
  return value;
}

function required(object: JsonObject, key: string, pointer: string): JsonValue {
  const value = own(object, key);
  if (value === undefined) return invalid(at(pointer, key), "missing");
  return value;
}

function stringList(value: JsonValue, pointer: string): string[] {
  return arrayAt(value, pointer).map((item, index) =>
    stringAt(item, at(pointer, index)),
  );
}

function normalizeSource(value: JsonValue, pointer: string): SourceRange {
  const object = objectAt(value, pointer);
  const file_ref = stringAt(
    required(object, "file_ref", pointer),
    at(pointer, "file_ref"),
  );
  const rangesPointer = at(pointer, "page_ranges");
  const page_ranges = arrayAt(
    required(object, "page_ranges", pointer),
    rangesPointer,
  ).map((range, index): PageRange => {
    const rangePointer = at(rangesPointer, index);
    const pair = arrayAt(range, rangePointer);
    if (pair.length !== 2) invalid(rangePointer, "expected_page_range");
    return [
      integerAt(pair[0], at(rangePointer, 0)),
      integerAt(pair[1], at(rangePointer, 1)),
    ];
  });
  return { file_ref, page_ranges };
}

function normalizeFile(value: JsonValue, pointer: string): ReviewFile {
  const object = objectAt(value, pointer);
  const file_ref = stringAt(
    required(object, "file_ref", pointer),
    at(pointer, "file_ref"),
  );
  if (!FILE_REF_PATTERN.test(file_ref)) {
    invalid(at(pointer, "file_ref"), "file_ref_pattern");
  }
  const file: {
    file_ref: string;
    file_id: string;
    name: string;
    num_pages?: number;
    input_index?: number;
  } = {
    file_ref,
    file_id: stringAt(
      required(object, "file_id", pointer),
      at(pointer, "file_id"),
    ),
    name: stringAt(required(object, "name", pointer), at(pointer, "name")),
  };
  const numPages = own(object, "num_pages");
  if (numPages !== undefined) {
    file.num_pages = integerAt(numPages, at(pointer, "num_pages"), 0);
  }
  const inputIndex = own(object, "input_index");
  if (inputIndex !== undefined) {
    file.input_index = integerAt(inputIndex, at(pointer, "input_index"), 0);
  }
  return file;
}

function normalizeGroup(value: JsonValue, pointer: string): FileGroup {
  const object = objectAt(value, pointer);
  const filesPointer = at(pointer, "files");
  return {
    group_id: stringAt(
      required(object, "group_id", pointer),
      at(pointer, "group_id"),
    ),
    files: arrayAt(required(object, "files", pointer), filesPointer).map(
      (file, index) => normalizeFile(file, at(filesPointer, index)),
    ),
    layout_step_id: nullableStringAt(
      required(object, "layout_step_id", pointer),
      at(pointer, "layout_step_id"),
    ),
  };
}

function normalizeFileGroups(value: JsonValue, pointer: string): FileGroups {
  const object = objectAt(value, pointer);
  const groupsPointer = at(pointer, "groups");
  const groups = arrayAt(
    required(object, "groups", pointer),
    groupsPointer,
  ).map((group, index) => normalizeGroup(group, at(groupsPointer, index)));
  const seen = new Set<string>();
  groups.forEach((group, index) => {
    if (seen.has(group.group_id)) {
      invalid(at(at(groupsPointer, index), "group_id"), "duplicate_group_id");
    }
    seen.add(group.group_id);
  });
  const excludedPages = own(object, "excluded_pages");
  const excludedDocuments = own(object, "excluded_documents");
  const excludedPagesPointer = at(pointer, "excluded_pages");
  return {
    base_version: integerAt(
      required(object, "base_version", pointer),
      at(pointer, "base_version"),
      0,
    ),
    groups,
    excluded_pages:
      excludedPages === undefined
        ? []
        : arrayAt(excludedPages, excludedPagesPointer).map((source, index) =>
            normalizeSource(source, at(excludedPagesPointer, index)),
          ),
    excluded_documents:
      excludedDocuments === undefined
        ? []
        : stringList(excludedDocuments, at(pointer, "excluded_documents")),
  };
}

function normalizeDocumentEntry(
  value: JsonValue,
  pointer: string,
): ReviewDocumentEntry {
  const object = objectAt(value, pointer);
  const sourcesPointer = at(pointer, "source_files");
  return {
    document_id: stringAt(
      required(object, "document_id", pointer),
      at(pointer, "document_id"),
    ),
    group_id: stringAt(
      required(object, "group_id", pointer),
      at(pointer, "group_id"),
    ),
    label: nullableStringAt(
      required(object, "label", pointer),
      at(pointer, "label"),
    ),
    source_files: arrayAt(
      required(object, "source_files", pointer),
      sourcesPointer,
    ).map((source, index) =>
      normalizeSource(source, at(sourcesPointer, index)),
    ),
  };
}

function normalizeLayout(object: JsonObject, pointer: string): Layout {
  const contentPointer = at(pointer, "content");
  const content = objectAt(
    required(object, "content", pointer),
    contentPointer,
  );
  const documentsPointer = at(contentPointer, "documents");
  const documents = arrayAt(
    required(content, "documents", contentPointer),
    documentsPointer,
  ).map((document, index) =>
    normalizeDocumentEntry(document, at(documentsPointer, index)),
  );
  const seen = new Set<string>();
  documents.forEach((document, index) => {
    if (seen.has(document.document_id)) {
      invalid(
        at(at(documentsPointer, index), "document_id"),
        "duplicate_document_id",
      );
    }
    seen.add(document.document_id);
  });
  return {
    step_id: nullableStringAt(
      required(object, "step_id", pointer),
      at(pointer, "step_id"),
    ),
    base_version: integerAt(
      required(object, "base_version", pointer),
      at(pointer, "base_version"),
      0,
    ),
    content: { documents },
  };
}

function normalizeLink(object: JsonObject, pointer: string): ResultLink {
  const documentIds = own(object, "document_ids");
  const fieldGroups = own(object, "field_groups");
  if (documentIds !== undefined && fieldGroups !== undefined) {
    invalid(pointer, "document_ids_and_field_groups");
  }
  if (documentIds !== undefined) {
    return {
      kind: "documents",
      document_ids: stringList(documentIds, at(pointer, "document_ids")),
    };
  }
  if (fieldGroups !== undefined) {
    const groupsPointer = at(pointer, "field_groups");
    const groups = objectAt(fieldGroups, groupsPointer);
    const field_groups: Record<string, readonly string[]> = {};
    for (const key of Object.keys(groups)) {
      Object.defineProperty(field_groups, key, {
        value: stringList(groups[key] ?? null, at(groupsPointer, key)),
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    return { kind: "field_groups", field_groups };
  }
  return { kind: "none" };
}

function normalizeResult(object: JsonObject, pointer: string): Result {
  const state = own(object, "state");
  const result: {
    id: string;
    step_id: string;
    base_version: number;
    content: JsonValue;
    state: string;
    link: ResultLink;
    source?: ResultSource;
    checks?: readonly ResultCheck[];
  } = {
    id: stringAt(required(object, "id", pointer), at(pointer, "id")),
    step_id: stringAt(
      required(object, "step_id", pointer),
      at(pointer, "step_id"),
    ),
    base_version: integerAt(
      required(object, "base_version", pointer),
      at(pointer, "base_version"),
      0,
    ),
    content: required(object, "content", pointer),
    state:
      state === undefined ? "present" : stringAt(state, at(pointer, "state")),
    link: normalizeLink(object, pointer),
  };
  const source = own(object, "source");
  if (source !== undefined) {
    const sourcePointer = at(pointer, "source");
    const sourceObject = objectAt(source, sourcePointer);
    result.source = {
      job_id: stringAt(
        required(sourceObject, "job_id", sourcePointer),
        at(sourcePointer, "job_id"),
      ),
      occurrence_id: nullableStringAt(
        required(sourceObject, "occurrence_id", sourcePointer),
        at(sourcePointer, "occurrence_id"),
      ),
    };
  }
  const checks = own(object, "checks");
  if (checks !== undefined) {
    const checksPointer = at(pointer, "checks");
    result.checks = arrayAt(checks, checksPointer).map((check, index) => {
      const checkPointer = at(checksPointer, index);
      const item = objectAt(check, checkPointer);
      const out: {
        name?: string;
        severity?: string;
        passed?: boolean;
        reason?: string;
      } = {};
      const name = own(item, "name");
      if (name !== undefined)
        out.name = stringAt(name, at(checkPointer, "name"));
      const severity = own(item, "severity");
      if (severity !== undefined) {
        out.severity = stringAt(severity, at(checkPointer, "severity"));
      }
      const passed = own(item, "passed");
      if (passed !== undefined) {
        if (typeof passed !== "boolean") {
          invalid(at(checkPointer, "passed"), "expected_boolean");
        }
        out.passed = passed;
      }
      const reason = own(item, "reason");
      if (reason !== undefined) {
        out.reason = stringAt(reason, at(checkPointer, "reason"));
      }
      return out;
    });
  }
  return result;
}

function normalizeJob(value: JsonValue, pointer: string): ReviewJob {
  const object = objectAt(value, pointer);
  const outputPointer = at(pointer, "output");
  const output = arrayAt(
    required(object, "output", pointer),
    outputPointer,
  ).map((item, index): OutputItem => {
    const itemPointer = at(outputPointer, index);
    const itemObject = objectAt(item, itemPointer);
    return Object.hasOwn(itemObject, "id")
      ? normalizeResult(itemObject, itemPointer)
      : normalizeLayout(itemObject, itemPointer);
  });
  const layoutSteps = new Set<string | null>();
  output.forEach((item, index) => {
    if (Object.hasOwn(item, "id")) return;
    const layout = item as Layout;
    if (layoutSteps.has(layout.step_id)) {
      invalid(at(at(outputPointer, index), "step_id"), "duplicate_layout_step");
    }
    layoutSteps.add(layout.step_id);
  });
  const job: { id: string; file_groups?: FileGroups; output: OutputItem[] } = {
    id: stringAt(required(object, "id", pointer), at(pointer, "id")),
    output,
  };
  const fileGroups = own(object, "file_groups");
  if (fileGroups !== undefined) {
    job.file_groups = normalizeFileGroups(
      fileGroups,
      at(pointer, "file_groups"),
    );
  }
  return job;
}

function normalizeRecord<T>(
  value: JsonValue,
  pointer: string,
  each: (item: JsonObject, pointer: string) => T,
): Record<string, T> {
  const object = objectAt(value, pointer);
  const out: Record<string, T> = {};
  for (const key of Object.keys(object)) {
    const itemPointer = at(pointer, key);
    Object.defineProperty(out, key, {
      value: each(objectAt(object[key], itemPointer), itemPointer),
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  return out;
}

function normalizeStep(object: JsonObject, pointer: string): ReviewStep {
  const step: {
    config_id: string;
    name: string;
    type: string;
    labels?: readonly string[];
    schema?: JsonObject;
  } = {
    config_id: stringAt(
      required(object, "config_id", pointer),
      at(pointer, "config_id"),
    ),
    name: stringAt(required(object, "name", pointer), at(pointer, "name")),
    type: stringAt(required(object, "type", pointer), at(pointer, "type")),
  };
  const labels = own(object, "labels");
  if (labels !== undefined)
    step.labels = stringList(labels, at(pointer, "labels"));
  const schema = own(object, "schema");
  if (schema !== undefined)
    step.schema = objectAt(schema, at(pointer, "schema"));
  return step;
}

/**
 * 파싱된 JSON 을 검사하고 읽기 정규화한다. 모양이 틀리면 `invalid_document`
 * (+ JSON Pointer), `format` 이 다르면 `unsupported_review_format`.
 * 의미 검증(페이지 커버리지·범위 등)은 `validateJob` 이 한다.
 */
export function normalizeDocument(raw: JsonValue): ReviewDocument {
  const root = objectAt(raw, "");
  const format = own(root, "format");
  if (format !== REVIEW_FORMAT) {
    throw new ReviewModelError("unsupported_review_format", {
      pointer: "/format",
      details: { format: typeof format === "string" ? format : null },
    });
  }
  const configs = normalizeRecord(
    required(root, "configs", ""),
    "/configs",
    (item, pointer): ReviewConfig => ({
      agent_id: nullableStringAt(
        required(item, "agent_id", pointer),
        at(pointer, "agent_id"),
      ),
    }),
  );
  const steps = normalizeRecord(
    required(root, "steps", ""),
    "/steps",
    normalizeStep,
  );
  const jobs = arrayAt(required(root, "jobs", ""), "/jobs").map((job, index) =>
    normalizeJob(job, at("/jobs", index)),
  );

  const jobIds = new Set<string>();
  const resultIds = new Set<string>();
  const fileRefs = new Set<string>();
  jobs.forEach((job, jobIndex) => {
    const jobPointer = at("/jobs", jobIndex);
    if (jobIds.has(job.id)) invalid(at(jobPointer, "id"), "duplicate_job_id");
    jobIds.add(job.id);
    job.output.forEach((item, index) => {
      if (!Object.hasOwn(item, "id")) return;
      const id = (item as Result).id;
      if (resultIds.has(id)) {
        invalid(
          at(at(at(jobPointer, "output"), index), "id"),
          "duplicate_result_id",
        );
      }
      resultIds.add(id);
    });
    job.file_groups?.groups.forEach((group, groupIndex) => {
      group.files.forEach((file, fileIndex) => {
        if (fileRefs.has(file.file_ref)) {
          invalid(
            `${jobPointer}/file_groups/groups/${groupIndex}/files/${fileIndex}/file_ref`,
            "duplicate_file_ref",
          );
        }
        fileRefs.add(file.file_ref);
      });
    });
  });

  return {
    format: REVIEW_FORMAT,
    collection_id: stringAt(
      required(root, "collection_id", ""),
      "/collection_id",
    ),
    configs,
    steps,
    jobs,
  };
}

/** 검수 JSON 문자열 → 정규화된 문서. `parseJson` 오류도 그대로 던진다. */
export function readReviewDocument(
  text: string,
  options?: ParseJsonOptions,
): ReviewDocument {
  return normalizeDocument(parseJson(text, options));
}
