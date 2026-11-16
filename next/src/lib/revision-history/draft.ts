import {
  buildStructureReplacement,
  canEditResult,
  findResult,
  isJsonObject,
  jsonEquals,
  layouts,
  structureChanged,
  type ChangeDraft,
  type JsonValue,
  type Layout,
  type PageRange,
  type ReviewDocumentEntry,
  type ReviewJob,
  type SourceRange,
} from "@/lib/review-model";
import type { JobRevision } from "@/lib/review-api/types";

/** 구조 변경 이력의 파일. 정체성 외 필드는 서버 설정에 따라 빠질 수 있다. */
export type StructureContentFile = {
  readonly file_ref: string;
  readonly file_id: string;
  readonly name?: string;
  readonly num_pages?: number;
  readonly input_index?: number;
};

export type StructureContentGroup = {
  readonly group_id: string;
  readonly files: readonly StructureContentFile[];
  readonly layout_step_id: string | null;
};

/** 구조 변경 이력의 문서 — 어느 문서 배치 보기(`step_id`) 소속인지 함께 적혀 있다. */
export type StructureContentDocument = {
  readonly document_id: string;
  readonly step_id: string | null;
  readonly group_id: string;
  readonly label: string | null;
  readonly source_files: readonly SourceRange[];
};

/** 구조 변경 이력의 `content`·`base_content` 모양(`file_groups` 에 `base_version` 없음). */
export type StructureContent = {
  readonly file_groups: {
    readonly groups: readonly StructureContentGroup[];
    readonly excluded_pages: readonly SourceRange[];
    readonly excluded_documents: readonly string[];
  };
  readonly documents: readonly StructureContentDocument[];
};

/** 모양이 틀리면 던져 한 번에 빠져나온다(`readStructureContent` 안에서만 쓴다). */
class Invalid extends Error {}

function fail(): never {
  throw new Invalid();
}

function object(value: JsonValue | undefined): { [key: string]: JsonValue } {
  return isJsonObject(value) ? value : fail();
}

function array(value: JsonValue | undefined): readonly JsonValue[] {
  return Array.isArray(value) ? value : fail();
}

/** 없으면 빈 배열(서버는 항상 배열을 주지만 빠져도 읽는다). */
function optionalArray(value: JsonValue | undefined): readonly JsonValue[] {
  return value === undefined ? [] : array(value);
}

function string(value: JsonValue | undefined): string {
  return typeof value === "string" ? value : fail();
}

function nullableString(value: JsonValue | undefined): string | null {
  return value === undefined || value === null ? null : string(value);
}

function integer(value: JsonValue | undefined): number {
  return typeof value === "number" && Number.isInteger(value) ? value : fail();
}

function sourceRanges(value: JsonValue | undefined): SourceRange[] {
  return array(value).map(item => {
    const source = object(item);
    return {
      file_ref: string(source.file_ref),
      page_ranges: array(source.page_ranges).map((range): PageRange => {
        const pair = array(range);
        if (pair.length !== 2) fail();
        return [integer(pair[0]), integer(pair[1])];
      }),
    };
  });
}

function readFile(value: JsonValue): StructureContentFile {
  const file = object(value);
  const out: {
    file_ref: string;
    file_id: string;
    name?: string;
    num_pages?: number;
    input_index?: number;
  } = { file_ref: string(file.file_ref), file_id: string(file.file_id) };
  if (typeof file.name === "string") out.name = file.name;
  if (typeof file.num_pages === "number") out.num_pages = file.num_pages;
  if (typeof file.input_index === "number") out.input_index = file.input_index;
  return out;
}

/**
 * 구조 변경 이력 내용을 읽는다. 그룹·파일·문서·페이지 범위(정수 `[a, b]`)의 모양이 틀리면
 * `null`. 범위 값의 유효성(1 이상·순서)은 저장 전 검증이 본다.
 */
export function readStructureContent(
  value: JsonValue | null | undefined,
): StructureContent | null {
  if (value === null || value === undefined) return null;
  try {
    const root = object(value);
    const fileGroups = object(root.file_groups);
    return {
      file_groups: {
        groups: array(fileGroups.groups).map(item => {
          const group = object(item);
          return {
            group_id: string(group.group_id),
            files: array(group.files).map(readFile),
            layout_step_id: nullableString(group.layout_step_id),
          };
        }),
        excluded_pages: sourceRanges(
          fileGroups.excluded_pages === undefined
            ? []
            : fileGroups.excluded_pages,
        ),
        excluded_documents: optionalArray(fileGroups.excluded_documents).map(
          string,
        ),
      },
      documents: array(root.documents).map(item => {
        const document = object(item);
        return {
          document_id: string(document.document_id),
          step_id: nullableString(document.step_id),
          group_id: string(document.group_id),
          label: nullableString(document.label),
          source_files: sourceRanges(document.source_files),
        };
      }),
    };
  } catch (caught) {
    if (caught instanceof Invalid) return null;
    throw caught;
  }
}

/**
 * 이력 내용을 편집에 불러올 수 없는 이유.
 *
 * - `content_unavailable`: 내용을 받지 못했다(`*_omitted` 등).
 * - `invalid_content`: 구조 내용의 모양이 틀렸다.
 * - `result_missing`: 지금 Job 에 그 결과가 없다.
 * - `result_not_editable`: 결과를 지금 고칠 수 없는 상태(`input_changed` 등)다.
 * - `structure_missing`: 지금 Job 에 구성 정보(`file_groups`)가 없다.
 * - `layout_mismatch`: 내용의 문서가 지금 없는 문서 배치 보기(`step_id`)에 있다.
 * - `file_set_mismatch`: 파일(`file_ref`·`file_id`) 집합이 지금과 다르다.
 * - `unchanged`: 지금 편집 중인 값·구성과 같다.
 */
export type RevisionDraftFailure =
  | "content_unavailable"
  | "invalid_content"
  | "result_missing"
  | "result_not_editable"
  | "structure_missing"
  | "layout_mismatch"
  | "file_set_mismatch"
  | "unchanged";

export type RevisionDraftOutcome =
  | { readonly ok: true; readonly draft: ChangeDraft }
  | { readonly ok: false; readonly reason: RevisionDraftFailure };

const failed = (reason: RevisionDraftFailure): RevisionDraftOutcome => ({
  ok: false,
  reason,
});

function resultDraft(
  job: ReviewJob,
  rev: Pick<JobRevision, "result">,
  content: JsonValue,
): RevisionDraftOutcome {
  const result = rev.result ? findResult(job, rev.result.occurrence_id) : null;
  if (!result) return failed("result_missing");
  if (!canEditResult(result)) return failed("result_not_editable");
  if (jsonEquals(result.content, content)) return failed("unchanged");
  return {
    ok: true,
    draft: {
      kind: "replace_subtree",
      jobId: job.id,
      resultId: result.id,
      path: [],
      value: content,
    },
  };
}

function structureDraft(
  job: ReviewJob,
  content: JsonValue,
): RevisionDraftOutcome {
  const structure = readStructureContent(content);
  if (!structure) return failed("invalid_content");
  if (!job.file_groups) return failed("structure_missing");
  const current = layouts(job);
  const byStep = new Map<string | null, ReviewDocumentEntry[]>(
    current.map(layout => [layout.step_id, []]),
  );
  for (const document of structure.documents) {
    const bucket = byStep.get(document.step_id);
    if (!bucket) return failed("layout_mismatch");
    bucket.push({
      document_id: document.document_id,
      group_id: document.group_id,
      label: document.label,
      source_files: document.source_files,
    });
  }
  // 문서 배치 보기의 `base_version` 은 지금 값을 이어받아 저장 충돌 검사가 지금 기준으로 돈다.
  const nextLayouts: Layout[] = current.map(layout => ({
    step_id: layout.step_id,
    base_version: layout.base_version,
    content: { documents: byStep.get(layout.step_id) ?? [] },
  }));
  const built = buildStructureReplacement(
    job,
    structure.file_groups,
    nextLayouts,
  );
  if (!built) return failed("file_set_mismatch");
  if (!structureChanged(job, built.next)) return failed("unchanged");
  return {
    ok: true,
    draft: {
      kind: "replace_structure",
      jobId: job.id,
      fileGroups: built.fileGroups,
      layouts: nextLayouts,
    },
  };
}

/**
 * 이력 내용(`content`, 기계 출력이면 `base_content`)을 지금 편집 중인 Job(`session.current`)
 * 에 넣을 변경 항목으로 바꾼다. 값은 결과 `content` 전체를 바꾸는 `replace_subtree`(`path: []`),
 * 구조는 `replace_structure` 하나다. 어느 쪽이든 `base_version` 은 지금 값을 쓰므로 저장하면
 * 새 version 이 쌓인다(되돌리기가 아니다).
 */
export function revisionToDraft(
  job: ReviewJob,
  rev: Pick<JobRevision, "type" | "result">,
  content: JsonValue | null | undefined,
): RevisionDraftOutcome {
  if (content === null || content === undefined) {
    return failed("content_unavailable");
  }
  return rev.type === "structure"
    ? structureDraft(job, content)
    : resultDraft(job, rev, content);
}
