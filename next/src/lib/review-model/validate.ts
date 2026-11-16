import {
  canEditResult,
  documentsOf,
  findResult,
  layouts,
  results,
} from "./layout";
import { MAX_PAGE_NUMBER, pageKey, parsePageKey } from "./pages";
import { isJsonObject, type JsonObject, type JsonValue } from "./json";
import {
  arrayBounds,
  schemaAt,
  schemaProblem,
  stringBounds,
  toPointer,
  type JsonPath,
  type SchemaNode,
} from "./schema";
import { isClassifyStepType, isValidateStepType } from "./step-names";
import type {
  FileGroup,
  IssueWhere,
  PageRange,
  PageRef,
  ReviewDocument,
  ReviewFile,
  ReviewJob,
  ValidationIssue,
} from "./types";

export type { IssueCode, ValidationIssue } from "./types";

/** 서버 `review_limit_exceeded` 한도(Job 당). */
export const REVIEW_LIMITS = {
  files: 300,
  groups: 1_000,
  documents: 10_000,
  pages: 10_000,
} as const;

/** 문서 라벨 길이 한도(글자 수, code point). 서버 schema 의 `label` `maxLength` 와 같다. */
export const DOCUMENT_LABEL_MAX_LENGTH = 200;

/** `layout_step_id` 가 가리킬 수 있는 Step 종류. */

/** Validate Step 에 `schema` 조회 정보가 없을 때 쓰는 판정 schema(서버와 같음). */
export const VERDICT_SCHEMA: SchemaNode = {
  type: "string",
  enum: ["green", "yellow", "red"],
};

/** Validate 판정값. `VERDICT_SCHEMA` 의 enum 과 같다. */
export type VerdictValue = "green" | "yellow" | "red";

/** 값이 Validate 판정값(green·yellow·red) 중 하나인가. */
export function isVerdictValue(value: unknown): value is VerdictValue {
  return value === "green" || value === "yellow" || value === "red";
}

type Detail = Record<string, string | number | boolean>;

function issue(
  code: ValidationIssue["code"],
  jobId: string,
  where: IssueWhere,
  detail?: Detail,
  severity: ValidationIssue["severity"] = "error",
): ValidationIssue {
  return detail === undefined
    ? { code, severity, jobId, where }
    : { code, severity, jobId, where, detail };
}

/** 빈 `page_ranges`(서버 schema `minItems: 1`). */
function emptyRanges(
  jobId: string,
  where: IssueWhere,
  fileRef: string,
): ValidationIssue {
  return issue("schema_violation", jobId, where, {
    expected: "min_items",
    field: "page_ranges",
    fileRef,
    limit: 1,
    count: 0,
  });
}

function rangeIsValid([first, last]: PageRange): boolean {
  return (
    Number.isInteger(first) &&
    Number.isInteger(last) &&
    first >= 1 &&
    first <= last &&
    last <= MAX_PAGE_NUMBER
  );
}

function knownPages(file: ReviewFile): number | null {
  return Number.isInteger(file.num_pages) ? (file.num_pages as number) : null;
}

/**
 * 구조(`file_groups` + 문서 배치 보기) 검증. 서버 `validate_manifest` 와 같은 규칙:
 * 그룹마다 그 그룹의 `layout_step_id` 보기 안에서, 각 파일의 모든 페이지가 제외
 * 안 된 문서 하나에만 있거나 `excluded_pages`·제외 문서로 명시돼야 한다.
 * 한 문서가 같은 페이지를 두 번 고르거나 제외 안 된 두 문서가 같은 페이지를 가지면
 * `duplicate_review_page`, 제외 페이지가 문서 페이지와 겹치거나 두 번 제외되면
 * `page_overlap`. 제외 문서의 페이지는 다른 문서와 겹쳐도 된다.
 * `num_pages` 가 없는 파일은 빠진 페이지를 판단하지 않고 `coverageUnknown`
 * 경고(job)로 알린다. 서버 schema 가 거부하는 빈 라벨·한도를 넘는 라벨·빈
 * `source_files`/`page_ranges` 는 `schema_violation`, 문서 배치 보기에 없는 제외 문서 id 는
 * `review_document_unavailable`(같은 id 의 반복은 서버가 받으므로 보지 않는다).
 * `doc` 를 주면 `label_not_in_config` 경고와, 없거나 Classify 가 아닌 `layout_step_id` 의
 * `review_step_unavailable` 도 낸다.
 */
export function validateStructure(
  job: ReviewJob,
  doc?: ReviewDocument,
): ValidationIssue[] {
  const fileGroups = job.file_groups;
  if (!fileGroups) return [];
  const jobId = job.id;
  const out: ValidationIssue[] = [];
  const located = documentsOf(job);

  // 한도
  const files = fileGroups.groups.flatMap(group => group.files);
  const totalPages = files.reduce(
    (sum, file) => sum + (knownPages(file) ?? 0),
    0,
  );
  const limits: [keyof typeof REVIEW_LIMITS, number][] = [
    ["files", files.length],
    ["groups", fileGroups.groups.length],
    ["documents", located.length],
    ["pages", totalPages],
  ];
  for (const [kind, count] of limits) {
    if (count > REVIEW_LIMITS[kind]) {
      out.push(
        issue(
          "review_limit_exceeded",
          jobId,
          { kind: "job" },
          {
            limit: REVIEW_LIMITS[kind],
            count,
            resource: kind,
          },
        ),
      );
    }
  }

  // 파일 → 그룹(중복 소속은 duplicate_review_file)
  const fileOwner = new Map<string, { group: FileGroup; file: ReviewFile }>();
  for (const group of fileGroups.groups) {
    for (const file of group.files) {
      if (fileOwner.has(file.file_ref)) {
        out.push(
          issue(
            "duplicate_review_file",
            jobId,
            { kind: "job" },
            {
              fileRef: file.file_ref,
              groupId: group.group_id,
            },
          ),
        );
        continue;
      }
      fileOwner.set(file.file_ref, { group, file });
    }
  }
  const groupById = new Map(
    fileGroups.groups.map(group => [group.group_id, group] as const),
  );
  const excludedDocuments = new Set(fileGroups.excluded_documents);

  // 그룹의 문서 배치 보기 Step
  if (doc) {
    for (const group of fileGroups.groups) {
      const stepId = group.layout_step_id;
      if (stepId === null) continue;
      const step = Object.hasOwn(doc.steps, stepId)
        ? doc.steps[stepId]
        : undefined;
      if (!isClassifyStepType(step?.type)) {
        out.push(
          issue(
            "review_step_unavailable",
            jobId,
            { kind: "job" },
            { groupId: group.group_id, stepId },
          ),
        );
      }
    }
  }

  // 제외 문서 id 는 문서 배치 보기 어딘가의 문서여야 한다.
  const documentIds = new Set(
    located.map(({ document }) => document.document_id),
  );
  for (const documentId of excludedDocuments) {
    if (!documentIds.has(documentId)) {
      out.push(
        issue(
          "review_document_unavailable",
          jobId,
          { kind: "job" },
          { documentId },
        ),
      );
    }
  }

  /** 문서가 고른 페이지 중 유효한 것(자기 그룹 파일·범위 안). 문제는 issue 로. */
  const documentPages = new Map<string, PageRef[]>();
  for (const { stepId, document } of located) {
    const where: IssueWhere = {
      kind: "document",
      stepId,
      documentId: document.document_id,
    };
    let labelRejected = false;
    if (document.label !== null) {
      const length = codePointLength(document.label);
      if (length === 0 || length > DOCUMENT_LABEL_MAX_LENGTH) {
        labelRejected = true;
        out.push(
          issue("schema_violation", jobId, where, {
            expected: length === 0 ? "min_length" : "max_length",
            field: "label",
            limit: length === 0 ? 1 : DOCUMENT_LABEL_MAX_LENGTH,
            count: length,
          }),
        );
      }
    }
    if (document.source_files.length === 0) {
      out.push(
        issue("schema_violation", jobId, where, {
          expected: "min_items",
          field: "source_files",
          limit: 1,
          count: 0,
        }),
      );
    }
    const group = groupById.get(document.group_id);
    if (!group) {
      out.push(
        issue("review_group_unavailable", jobId, where, {
          groupId: document.group_id,
        }),
      );
      continue;
    }
    const pages: PageRef[] = [];
    for (const source of document.source_files) {
      if (source.page_ranges.length === 0) {
        out.push(emptyRanges(jobId, where, source.file_ref));
      }
      const owner = fileOwner.get(source.file_ref);
      if (!owner || owner.group.group_id !== group.group_id) {
        out.push(
          issue("review_file_unavailable", jobId, where, {
            fileRef: source.file_ref,
          }),
        );
        continue;
      }
      const numPages = knownPages(owner.file);
      for (const range of source.page_ranges) {
        const [first, last] = range;
        if (!rangeIsValid(range) || (numPages !== null && last > numPages)) {
          const detail: Detail = { fileRef: source.file_ref, first, last };
          if (numPages !== null) detail.numPages = numPages;
          out.push(issue("page_out_of_range", jobId, where, detail));
          if (!rangeIsValid(range)) continue;
        }
        const end = numPages === null ? last : Math.min(last, numPages);
        for (let page = first; page <= end; page++) {
          pages.push({ file_ref: source.file_ref, page });
        }
      }
    }
    documentPages.set(`${stepId}\u0000${document.document_id}`, pages);
    // 한 문서 안의 반복(제외 문서도 서버가 거부한다)
    const seen = new Set<string>();
    const repeated = new Set<string>();
    for (const page of pages) {
      const key = pageKey(page);
      if (seen.has(key)) repeated.add(key);
      seen.add(key);
    }
    for (const key of repeated) {
      out.push(
        issue("duplicate_review_page", jobId, {
          kind: "page",
          stepId,
          groupId: document.group_id,
          page: parsePageKey(key) as PageRef,
          documentIds: [document.document_id],
        }),
      );
    }
    // 서버가 거부할 라벨은 위에서 이미 알렸으므로 설정 라벨 경고를 겹쳐 내지 않는다.
    if (doc && stepId !== null && document.label !== null && !labelRejected) {
      const labels = Object.hasOwn(doc.steps, stepId)
        ? doc.steps[stepId]?.labels
        : undefined;
      if (labels && !labels.includes(document.label)) {
        out.push(
          issue(
            "label_not_in_config",
            jobId,
            where,
            { label: document.label },
            "warning",
          ),
        );
      }
    }
  }

  // 명시 제외 페이지(Job 단위)
  const excludedCount = new Map<string, number>();
  for (const source of fileGroups.excluded_pages) {
    if (source.page_ranges.length === 0) {
      out.push(emptyRanges(jobId, { kind: "job" }, source.file_ref));
    }
    const owner = fileOwner.get(source.file_ref);
    if (!owner) {
      out.push(
        issue(
          "review_file_unavailable",
          jobId,
          { kind: "job" },
          {
            fileRef: source.file_ref,
            excluded: true,
          },
        ),
      );
      continue;
    }
    const numPages = knownPages(owner.file);
    for (const range of source.page_ranges) {
      const [first, last] = range;
      if (!rangeIsValid(range) || (numPages !== null && last > numPages)) {
        const detail: Detail = {
          fileRef: source.file_ref,
          first,
          last,
          excluded: true,
        };
        if (numPages !== null) detail.numPages = numPages;
        out.push(issue("page_out_of_range", jobId, { kind: "job" }, detail));
        if (!rangeIsValid(range)) continue;
      }
      const end = numPages === null ? last : Math.min(last, numPages);
      for (let page = first; page <= end; page++) {
        const key = pageKey({ file_ref: source.file_ref, page });
        excludedCount.set(key, (excludedCount.get(key) ?? 0) + 1);
      }
    }
  }

  // 그룹마다 그 그룹의 보기 안에서 커버리지
  for (const group of fileGroups.groups) {
    const stepId = group.layout_step_id;
    const placed = new Map<string, string[]>();
    const releasedByExcludedDocument = new Set<string>();
    for (const { stepId: docStep, document } of located) {
      if (document.group_id !== group.group_id) continue;
      const pages = documentPages.get(
        `${docStep}\u0000${document.document_id}`,
      );
      if (!pages) continue;
      if (excludedDocuments.has(document.document_id)) {
        pages.forEach(page => releasedByExcludedDocument.add(pageKey(page)));
        continue;
      }
      if (docStep !== stepId) continue;
      for (const page of pages) {
        const key = pageKey(page);
        const holders = placed.get(key);
        if (!holders) placed.set(key, [document.document_id]);
        else if (!holders.includes(document.document_id)) {
          holders.push(document.document_id);
        }
      }
    }
    const pageWhere = (key: string, documentIds: readonly string[]) => {
      const page = parsePageKey(key) as PageRef;
      return {
        kind: "page" as const,
        stepId,
        groupId: group.group_id,
        page,
        documentIds,
      };
    };
    for (const [key, holders] of placed) {
      if (holders.length > 1) {
        out.push(
          issue("duplicate_review_page", jobId, pageWhere(key, holders)),
        );
      }
      if (excludedCount.has(key)) {
        out.push(
          issue("page_overlap", jobId, pageWhere(key, holders), {
            excluded: true,
          }),
        );
      }
    }
    for (const file of group.files) {
      // 두 그룹에 걸친 파일은 첫 그룹에서만 본다(duplicate_review_file 로 이미 알림).
      if (fileOwner.get(file.file_ref)?.group !== group) continue;
      for (const [key, count] of excludedCount) {
        if (count > 1 && parsePageKey(key)?.file_ref === file.file_ref) {
          out.push(
            issue("page_overlap", jobId, pageWhere(key, []), {
              excluded: true,
              count,
            }),
          );
        }
      }
      const numPages = knownPages(file);
      if (numPages === null) {
        out.push(
          issue(
            "page_missing",
            jobId,
            { kind: "job" },
            { coverageUnknown: true, fileRef: file.file_ref },
            "warning",
          ),
        );
        continue;
      }
      for (let page = 1; page <= numPages; page++) {
        const key = pageKey({ file_ref: file.file_ref, page });
        if (
          !placed.has(key) &&
          !excludedCount.has(key) &&
          !releasedByExcludedDocument.has(key)
        ) {
          out.push(issue("page_missing", jobId, pageWhere(key, [])));
        }
      }
    }
  }
  return sortIssues(job, out);
}

function stepSchema(doc: ReviewDocument, stepId: string): SchemaNode | null {
  const step = Object.hasOwn(doc.steps, stepId) ? doc.steps[stepId] : undefined;
  if (step?.schema && isJsonObject(step.schema)) {
    return step.schema as JsonObject as SchemaNode;
  }
  return isValidateStepType(step?.type) ? VERDICT_SCHEMA : null;
}

function schemaProperties(node: SchemaNode): JsonObject | null {
  const properties = Object.hasOwn(node, "properties")
    ? node.properties
    : undefined;
  return isJsonObject(properties) ? properties : null;
}

/**
 * JSON Schema 의 글자 수(code point). 서로게이트 쌍은 한 글자로 센다. 큰 문자열에도 배열을
 * 만들지 않도록 UTF-16 단위를 한 번 훑는다.
 */
function codePointLength(value: string): number {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) index += 1;
    }
    count += 1;
  }
  return count;
}

type ContentProblem = {
  readonly path: JsonPath;
  readonly detail: Detail;
  readonly severity: ValidationIssue["severity"];
};

/**
 * content 를 schema 를 따라 걸으며 서버 검증과 같은 규칙으로 문제를 모은다:
 * 모든 노드의 enum·const·type(null 은 허용될 때만), 객체마다 schema `properties` 에
 * 없는 키(`known_key`)·`required` 누락(`required`), 객체 배열 항목의 `null`.
 * `minItems`·`maxItems`·`minLength`·`maxLength` 는 서버가 보지 않아 경고만. 맞지 않는 노드
 * 안으로는 내려가지 않는다.
 */
function contentProblems(
  schema: SchemaNode,
  content: JsonValue,
): ContentProblem[] {
  const out: ContentProblem[] = [];
  const walk = (value: JsonValue, path: string[], inArray: boolean) => {
    const match = schemaAt(schema, path, value);
    if (!match) return;
    const problem = schemaProblem(match, value);
    if (problem) {
      out.push({
        path,
        detail: { expected: problem.expected },
        severity: "error",
      });
      return;
    }
    if (value === null) {
      if (inArray && schemaProperties(match.node)) {
        out.push({ path, detail: { expected: "object" }, severity: "error" });
      }
      return;
    }
    if (typeof value === "string") {
      const { min, max } = stringBounds(match);
      if (min === undefined && max === undefined) return;
      const count = codePointLength(value);
      if (min !== undefined && count < min) {
        out.push({
          path,
          detail: { expected: "min_length", limit: min, count },
          severity: "warning",
        });
      }
      if (max !== undefined && count > max) {
        out.push({
          path,
          detail: { expected: "max_length", limit: max, count },
          severity: "warning",
        });
      }
      return;
    }
    if (Array.isArray(value)) {
      const { min, max } = arrayBounds(match);
      if (min !== undefined && value.length < min) {
        out.push({
          path,
          detail: { expected: "min_items", limit: min, count: value.length },
          severity: "warning",
        });
      }
      if (max !== undefined && value.length > max) {
        out.push({
          path,
          detail: { expected: "max_items", limit: max, count: value.length },
          severity: "warning",
        });
      }
      value.forEach((item, index) =>
        walk(item, [...path, String(index)], true),
      );
      return;
    }
    if (!isJsonObject(value)) return;
    const properties = schemaProperties(match.node);
    const required = Object.hasOwn(match.node, "required")
      ? match.node.required
      : undefined;
    for (const key of Array.isArray(required) ? required : []) {
      if (typeof key === "string" && !Object.hasOwn(value, key)) {
        out.push({
          path,
          detail: { expected: "required", missing: key },
          severity: "error",
        });
      }
    }
    for (const key of Object.keys(value)) {
      if (properties && !Object.hasOwn(properties, key)) {
        out.push({
          path: [...path, key],
          detail: { expected: "known_key" },
          severity: "error",
        });
        continue;
      }
      walk(value[key] ?? null, [...path, key], false);
    }
  };
  walk(content, [], false);
  return out;
}

/**
 * 결과 값 검증: 주어진 결과마다 편집 가능 상태(`result_not_editable`)와 Step
 * schema 규칙(`schema_violation`, 필드 pointer — `contentProblems`)을 본다.
 */
export function validateValues(
  doc: ReviewDocument,
  job: ReviewJob,
  resultIds: Iterable<string>,
): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  for (const resultId of resultIds) {
    const result = findResult(job, resultId);
    if (!result) continue;
    if (!canEditResult(result)) {
      out.push(
        issue(
          "result_not_editable",
          job.id,
          { kind: "field", resultId, pointer: "" },
          { state: result.state },
        ),
      );
      continue;
    }
    const schema = stepSchema(doc, result.step_id);
    if (!schema) continue;
    // 루트 schema 가 배열이 아닌데 값이 항목 하나짜리 배열이면 서버처럼 그 항목을 값으로 본다
    // (Extract 결과가 `[{…}]` 로 저장되는 경우).
    const wrapped =
      Array.isArray(result.content) &&
      result.content.length === 1 &&
      schemaProblem(schemaAt(schema, [], result.content), result.content) !==
        null &&
      result.content[0] !== undefined &&
      schemaProblem(
        schemaAt(schema, [], result.content[0]),
        result.content[0],
      ) === null;
    const content =
      wrapped && Array.isArray(result.content)
        ? (result.content[0] ?? null)
        : result.content;
    const prefix = wrapped ? ["0"] : [];
    for (const problem of contentProblems(schema, content)) {
      out.push(
        issue(
          "schema_violation",
          job.id,
          {
            kind: "field",
            resultId,
            pointer: toPointer([...prefix, ...problem.path]),
          },
          problem.detail,
          problem.severity,
        ),
      );
    }
  }
  return sortIssues(job, out);
}

/**
 * 저장 전 검증. 구조 + 값. `changedResultIds` 를 주면 그 결과만(편집 불가 상태면
 * `result_not_editable`), 안 주면 편집 가능한 모든 결과의 schema 를 본다.
 */
export function validateJob(
  doc: ReviewDocument,
  job: ReviewJob,
  options: { changedResultIds?: Iterable<string> } = {},
): ValidationIssue[] {
  const ids =
    options.changedResultIds ??
    results(job)
      .filter(canEditResult)
      .map(result => result.id);
  return sortIssues(job, [
    ...validateStructure(job, doc),
    ...validateValues(doc, job, ids),
  ]);
}

/** 저장을 막는 항목(`error`)이 있는가. 경고(`label_not_in_config`·`coverageUnknown`)는 막지 않는다. */
export function hasBlockingIssues(issues: readonly ValidationIssue[]): boolean {
  return issues.some(item => item.severity === "error");
}

const RANK: Record<IssueWhere["kind"], number> = {
  job: 0,
  document: 1,
  page: 1,
  field: 2,
  upload: 3,
};

/** 정렬: Job 전체 → 문서 순(보기 순서·문서 순서) → 페이지 순(파일 순서·페이지) → 결과 순. */
function sortIssues(
  job: ReviewJob,
  issues: ValidationIssue[],
): ValidationIssue[] {
  const docOrder = new Map<string, number>();
  let position = 0;
  for (const layout of layouts(job)) {
    for (const document of layout.content.documents) {
      const key = `${layout.step_id}\u0000${document.document_id}`;
      if (!docOrder.has(key)) docOrder.set(key, position++);
    }
  }
  const fileOrder = new Map<string, number>();
  job.file_groups?.groups.forEach(group =>
    group.files.forEach(file => {
      if (!fileOrder.has(file.file_ref)) {
        fileOrder.set(file.file_ref, fileOrder.size);
      }
    }),
  );
  const outputOrder = new Map<string, number>();
  job.output.forEach((item, index) => {
    if (Object.hasOwn(item, "id")) {
      outputOrder.set((item as { id: string }).id, index);
    }
  });
  const missing = Number.MAX_SAFE_INTEGER;
  const key = (item: ValidationIssue): number[] => {
    const where = item.where;
    switch (where.kind) {
      case "document":
        return [
          RANK.document,
          docOrder.get(`${where.stepId}\u0000${where.documentId}`) ?? missing,
          -1,
          0,
        ];
      case "page": {
        const docs = where.documentIds.map(
          id => docOrder.get(`${where.stepId}\u0000${id}`) ?? missing,
        );
        return [
          RANK.page,
          docs.length > 0 ? Math.min(...docs) : missing,
          fileOrder.get(where.page.file_ref) ?? missing,
          where.page.page,
        ];
      }
      case "field":
        return [RANK.field, outputOrder.get(where.resultId) ?? missing, 0, 0];
      default:
        return [RANK[where.kind], 0, 0, 0];
    }
  };
  const keyed = issues.map((item, index) => ({ item, index, key: key(item) }));
  keyed.sort((a, b) => {
    for (let i = 0; i < a.key.length; i++) {
      const diff = (a.key[i] ?? 0) - (b.key[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return a.index - b.index;
  });
  return keyed.map(entry => entry.item);
}
