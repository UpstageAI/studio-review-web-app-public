import { addChange, type ChangeDraft, type ReviewSession } from "./changes";
import { structureChanged } from "./diff";
import type { DropReason } from "./edits";
import { isReviewModelError, type ReviewModelError } from "./errors";
import { isJsonObject, jsonEquals, parseJson, type JsonValue } from "./json";
import { layouts } from "./layout";
import { normalizeDocument } from "./normalize";
import { toPointer, type JsonPath } from "./schema";
import {
  buildStructureReplacement,
  fileSetMatches,
  filesByRef,
} from "./structure-replace";
import {
  isResult,
  type Result,
  type ReviewDocument,
  type ReviewJob,
} from "./types";

/**
 * 가져오기를 막는 이유. 하나라도 있으면 적용할 수 없다.
 *
 * - `collection_mismatch`: 다른 Collection 의 파일.
 * - `job_mismatch`: Job 이 하나가 아니거나 지금 Job 이 아님.
 * - `catalog_mismatch`: `configs`·`steps` 카탈로그(라벨·schema 제외)가 다름.
 * - `unknown_result`: 지금 문서에 없는 결과 id.
 * - `result_step_mismatch`: 결과의 `step_id` 가 다름.
 * - `base_version_mismatch`: 결과·문서 배치 보기·`file_groups` 의 `base_version` 이 다름.
 * - `layout_mismatch`: 문서 배치 보기 집합(`step_id`)이 다름.
 * - `file_set_mismatch`: 파일(`file_ref`·`file_id`) 집합이 다름.
 * - `structure_mismatch`: `file_groups`·문서 배치 보기 중 한쪽만 있거나, 구성 정보가 없는 Job 에 구성을 넣음.
 * - `apply_failed`: 차이를 변경 항목으로 만들었지만 적용되지 않음(`reason` 참고 — 잠긴 결과 등).
 */
export type ImportErrorCode =
  | "collection_mismatch"
  | "job_mismatch"
  | "catalog_mismatch"
  | "unknown_result"
  | "result_step_mismatch"
  | "base_version_mismatch"
  | "layout_mismatch"
  | "file_set_mismatch"
  | "structure_mismatch"
  | "apply_failed";

/**
 * 적용은 되지만 알릴 것.
 *
 * - `read_only_ignored`: 읽기 전용 필드가 바뀌었다 — 저장해도 반영되지 않아 버린다.
 * - `layout_step_changed`: 그룹의 `layout_step_id` 가 바뀌었다 — 문서·결과 연결이 바뀔 수 있다.
 */
export type ImportWarningCode = "read_only_ignored" | "layout_step_changed";

export type ImportProblem<Code extends string> = {
  readonly code: Code;
  /** 가져온 JSON 기준 JSON Pointer. */
  readonly pointer: string;
  /** `apply_failed` 의 적용 실패 이유. */
  readonly reason?: DropReason;
};

export type ImportPlan =
  | {
      /** JSON 으로 읽을 수 없거나 검수 JSON 모양이 아니다(`details.offset` 은 텍스트 위치). */
      readonly ok: false;
      readonly error: ReviewModelError;
    }
  | {
      readonly ok: true;
      readonly errors: readonly ImportProblem<ImportErrorCode>[];
      readonly warnings: readonly ImportProblem<ImportWarningCode>[];
      /** 지금 세션(`session.current`)과 다른 점을 옮긴 변경 항목. 적용 순서대로. */
      readonly drafts: readonly ChangeDraft[];
      /** 값이 바뀐 결과 id(가져온 파일 순서). */
      readonly changedResultIds: readonly string[];
      /** 구조 교체 항목이 들어 있는가. */
      readonly structureChanged: boolean;
    };

function pointer(...tokens: (string | number)[]): string {
  return toPointer(tokens.map(String));
}

/** 같은 키 집합·같은 배열 길이가 재귀적으로 같고, leaf 자리도 서로 leaf 인가. */
function sameShape(a: JsonValue, b: JsonValue): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => sameShape(item, b[index] ?? null))
    );
  }
  if (isJsonObject(a) || isJsonObject(b)) {
    if (!isJsonObject(a) || !isJsonObject(b)) return false;
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every(
        key =>
          Object.hasOwn(b, key) && sameShape(a[key] ?? null, b[key] ?? null),
      )
    );
  }
  return true;
}

/** 모양이 같은 두 값에서 다른 leaf 의 경로와 새 값(`a` 의 키 순서). */
function leafChanges(
  a: JsonValue,
  b: JsonValue,
  path: JsonPath,
  out: { path: JsonPath; value: JsonValue }[],
): void {
  if (Array.isArray(a) && Array.isArray(b)) {
    a.forEach((item, index) =>
      leafChanges(item, b[index] ?? null, [...path, String(index)], out),
    );
    return;
  }
  if (isJsonObject(a) && isJsonObject(b)) {
    for (const key of Object.keys(a)) {
      leafChanges(a[key] ?? null, b[key] ?? null, [...path, key], out);
    }
    return;
  }
  if (!jsonEquals(a, b)) out.push({ path, value: b });
}

function sameCatalogs(
  current: ReviewDocument,
  imported: ReviewDocument,
  errors: ImportProblem<ImportErrorCode>[],
  warnings: ImportProblem<ImportWarningCode>[],
): void {
  const configKeys = Object.keys(current.configs);
  const importedConfigKeys = Object.keys(imported.configs);
  if (
    configKeys.length !== importedConfigKeys.length ||
    configKeys.some(key => !Object.hasOwn(imported.configs, key))
  ) {
    errors.push({ code: "catalog_mismatch", pointer: "/configs" });
  } else {
    for (const key of configKeys) {
      if (current.configs[key]?.agent_id !== imported.configs[key]?.agent_id) {
        errors.push({
          code: "catalog_mismatch",
          pointer: pointer("configs", key, "agent_id"),
        });
      }
    }
  }
  const stepKeys = Object.keys(current.steps);
  const importedStepKeys = Object.keys(imported.steps);
  if (
    stepKeys.length !== importedStepKeys.length ||
    stepKeys.some(key => !Object.hasOwn(imported.steps, key))
  ) {
    errors.push({ code: "catalog_mismatch", pointer: "/steps" });
    return;
  }
  for (const key of stepKeys) {
    const was = current.steps[key];
    const now = imported.steps[key];
    if (!was || !now) continue;
    for (const field of ["config_id", "name", "type"] as const) {
      if (was[field] !== now[field]) {
        errors.push({
          code: "catalog_mismatch",
          pointer: pointer("steps", key, field),
        });
      }
    }
    for (const field of ["labels", "schema"] as const) {
      if (!jsonEquals(was[field], now[field])) {
        warnings.push({
          code: "read_only_ignored",
          pointer: pointer("steps", key, field),
        });
      }
    }
  }
}

function linkPointer(at: string, result: Result, other: Result): string {
  const kind = result.link.kind === "none" ? other.link.kind : result.link.kind;
  return `${at}/${kind === "field_groups" ? "field_groups" : "document_ids"}`;
}

/** 결과 하나: 막는 차이·읽기 전용 경고를 모으고, 값이 다르면 변경 항목을 만든다. */
function planResult(
  jobId: string,
  current: Result | undefined,
  imported: Result,
  at: string,
  errors: ImportProblem<ImportErrorCode>[],
  warnings: ImportProblem<ImportWarningCode>[],
): ChangeDraft[] {
  if (!current) {
    errors.push({ code: "unknown_result", pointer: `${at}/id` });
    return [];
  }
  let blocked = false;
  if (current.step_id !== imported.step_id) {
    errors.push({ code: "result_step_mismatch", pointer: `${at}/step_id` });
    blocked = true;
  }
  if (current.base_version !== imported.base_version) {
    errors.push({
      code: "base_version_mismatch",
      pointer: `${at}/base_version`,
    });
    blocked = true;
  }
  if (current.state !== imported.state) {
    warnings.push({ code: "read_only_ignored", pointer: `${at}/state` });
  }
  if (!jsonEquals(current.link, imported.link)) {
    warnings.push({
      code: "read_only_ignored",
      pointer: linkPointer(at, imported, current),
    });
  }
  if (!jsonEquals(current.source, imported.source)) {
    warnings.push({ code: "read_only_ignored", pointer: `${at}/source` });
  }
  if (!jsonEquals(current.checks, imported.checks)) {
    warnings.push({ code: "read_only_ignored", pointer: `${at}/checks` });
  }
  if (blocked || jsonEquals(current.content, imported.content)) return [];
  if (!sameShape(current.content, imported.content)) {
    return [
      {
        kind: "replace_subtree",
        jobId,
        resultId: current.id,
        path: [],
        value: imported.content,
      },
    ];
  }
  const changes: { path: JsonPath; value: JsonValue }[] = [];
  leafChanges(current.content, imported.content, [], changes);
  return changes.map(change => ({
    kind: "set_value",
    jobId,
    resultId: current.id,
    path: change.path,
    value: change.value,
  }));
}

/**
 * 구조: 막는 차이·경고를 모으고, 구성이 다르면 구조 교체 항목 하나를 만든다. 교체본은
 * 가져온 그룹·제외·문서 배치에 지금 파일의 읽기 전용 정보(`name`·`num_pages`·
 * `input_index`)와 `base_version` 을 붙인 것이다.
 */
function planStructure(
  current: ReviewJob,
  imported: ReviewJob,
  errors: ImportProblem<ImportErrorCode>[],
  warnings: ImportProblem<ImportWarningCode>[],
): ChangeDraft | null {
  const importedLayouts = layouts(imported);
  if (!imported.file_groups && importedLayouts.length === 0) return null;
  const before = current.file_groups;
  const after = imported.file_groups;
  if (!before || !after) {
    errors.push({ code: "structure_mismatch", pointer: "/jobs/0/file_groups" });
    return null;
  }
  const errorCount = errors.length;
  if (before.base_version !== after.base_version) {
    errors.push({
      code: "base_version_mismatch",
      pointer: "/jobs/0/file_groups/base_version",
    });
  }
  const files = filesByRef(before);
  if (!fileSetMatches(before, after.groups)) {
    errors.push({
      code: "file_set_mismatch",
      pointer: "/jobs/0/file_groups/groups",
    });
  }
  after.groups.forEach((group, groupIndex) => {
    const groupAt = pointer("jobs", 0, "file_groups", "groups", groupIndex);
    const was = before.groups.find(item => item.group_id === group.group_id);
    if (was && was.layout_step_id !== group.layout_step_id) {
      warnings.push({
        code: "layout_step_changed",
        pointer: `${groupAt}/layout_step_id`,
      });
    }
    group.files.forEach((file, fileIndex) => {
      const old = files.get(file.file_ref);
      if (!old) return;
      for (const field of ["name", "num_pages", "input_index"] as const) {
        if (old[field] !== file[field]) {
          warnings.push({
            code: "read_only_ignored",
            pointer: `${groupAt}/files/${fileIndex}/${field}`,
          });
        }
      }
    });
  });
  const currentLayouts = layouts(current);
  if (importedLayouts.length !== currentLayouts.length) {
    errors.push({ code: "layout_mismatch", pointer: "/jobs/0/output" });
  }
  imported.output.forEach((item, index) => {
    if (isResult(item)) return;
    const at = pointer("jobs", 0, "output", index);
    const was = currentLayouts.find(layout => layout.step_id === item.step_id);
    if (!was) {
      errors.push({ code: "layout_mismatch", pointer: `${at}/step_id` });
    } else if (was.base_version !== item.base_version) {
      errors.push({
        code: "base_version_mismatch",
        pointer: `${at}/base_version`,
      });
    }
  });
  if (errors.length > errorCount) return null;

  const built = buildStructureReplacement(current, after, importedLayouts);
  if (!built || !structureChanged(current, built.next)) return null;
  return {
    kind: "replace_structure",
    jobId: current.id,
    fileGroups: built.fileGroups,
    layouts: importedLayouts,
  };
}

function draftPointer(
  draft: ChangeDraft,
  resultAt: ReadonlyMap<string, string>,
): string {
  if ("resultId" in draft) {
    const at = resultAt.get(draft.resultId) ?? "/jobs/0/output";
    return `${at}/content${"path" in draft ? toPointer(draft.path) : ""}`;
  }
  return "/jobs/0/file_groups";
}

/**
 * 전체 JSON 텍스트를 지금 세션과 비교해 가져오기 계획을 만든다.
 *
 * 1. `parseJson`(크기·깊이·중복 키 거부) → `normalizeDocument`. 실패는 `ok: false`.
 * 2. 바꿀 수 없는 것(Collection·Job·카탈로그·결과 id·version·파일 집합)이 다르면 `errors`.
 * 3. 읽기 전용 필드·`layout_step_id` 가 바뀌면 `warnings`(적용은 된다).
 * 4. 결과마다 값이 다르면: 모양(키 집합·배열 길이)이 같으면 다른 leaf 마다 `set_value`,
 *    아니면 `replace_subtree` `path: []` 하나. 파일에 없는 결과는 그대로 둔다. 구성이
 *    다르면 `replace_structure` 하나.
 * 5. 만든 항목을 세션에 차례로 적용해 보고, 적용되지 않는 항목은 `apply_failed`.
 */
export function planImport({
  session,
  jobId,
  text,
}: {
  session: ReviewSession;
  jobId: string;
  text: string;
}): ImportPlan {
  let imported: ReviewDocument;
  try {
    imported = normalizeDocument(parseJson(text));
  } catch (caught) {
    if (isReviewModelError(caught)) return { ok: false, error: caught };
    throw caught;
  }
  const current = session.current;
  const errors: ImportProblem<ImportErrorCode>[] = [];
  const warnings: ImportProblem<ImportWarningCode>[] = [];
  const empty = {
    ok: true as const,
    errors,
    warnings,
    drafts: [],
    changedResultIds: [],
    structureChanged: false,
  };

  if (imported.collection_id !== current.collection_id) {
    errors.push({ code: "collection_mismatch", pointer: "/collection_id" });
  }
  const job = current.jobs.find(item => item.id === jobId);
  const importedJob = imported.jobs[0];
  if (imported.jobs.length !== 1 || !importedJob) {
    errors.push({ code: "job_mismatch", pointer: "/jobs" });
  } else if (!job || importedJob.id !== jobId) {
    errors.push({ code: "job_mismatch", pointer: "/jobs/0/id" });
  }
  sameCatalogs(current, imported, errors, warnings);
  if (!job || !importedJob || errors.length > 0) return empty;

  const drafts: ChangeDraft[] = [];
  const changedResultIds: string[] = [];
  const resultAt = new Map<string, string>();
  const currentResults = new Map(
    job.output.filter(isResult).map(result => [result.id, result]),
  );
  importedJob.output.forEach((item, index) => {
    if (!isResult(item)) return;
    const at = pointer("jobs", 0, "output", index);
    resultAt.set(item.id, at);
    const made = planResult(
      jobId,
      currentResults.get(item.id),
      item,
      at,
      errors,
      warnings,
    );
    if (made.length > 0) changedResultIds.push(item.id);
    drafts.push(...made);
  });
  const structure = planStructure(job, importedJob, errors, warnings);
  if (structure) drafts.push(structure);
  if (errors.length > 0) return empty;

  let trial = session;
  for (const draft of drafts) {
    const outcome = addChange(trial, draft);
    if (outcome.ok) {
      trial = outcome.session;
    } else {
      errors.push({
        code: "apply_failed",
        pointer: draftPointer(draft, resultAt),
        reason: outcome.reason,
      });
    }
  }
  return {
    ok: true,
    errors,
    warnings,
    drafts,
    changedResultIds,
    structureChanged: structure !== null,
  };
}
