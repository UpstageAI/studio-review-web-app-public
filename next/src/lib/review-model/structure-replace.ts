import {
  isResult,
  type FileGroups,
  type Layout,
  type ReviewFile,
  type ReviewJob,
  type SourceRange,
} from "./types";

/** 구조 교체에 넘기는 파일 — 정체성(`file_ref`·`file_id`)만 보고 나머지는 지금 파일에서 가져온다. */
export type StructureFileInput = {
  readonly file_ref: string;
  readonly file_id: string;
};

/** 구조 교체에 넘기는 그룹·제외 목록(`file_groups` 에서 `base_version` 을 뺀 모양). */
export type StructureGroupsInput = {
  readonly groups: readonly {
    readonly group_id: string;
    readonly layout_step_id: string | null;
    readonly files: readonly StructureFileInput[];
  }[];
  readonly excluded_pages: readonly SourceRange[];
  readonly excluded_documents: readonly string[];
};

/** 지금 그룹의 파일을 `file_ref` 로 찾는 표. */
export function filesByRef(fileGroups: FileGroups): Map<string, ReviewFile> {
  const files = new Map<string, ReviewFile>();
  for (const group of fileGroups.groups) {
    for (const file of group.files) files.set(file.file_ref, file);
  }
  return files;
}

/** 넘긴 그룹의 파일 집합(`file_ref`·`file_id`)이 지금 파일 집합과 정확히 같은가. */
export function fileSetMatches(
  current: FileGroups,
  groups: StructureGroupsInput["groups"],
): boolean {
  const files = filesByRef(current);
  const incoming = groups.flatMap(group => group.files);
  // 같은 파일이 두 번 오는 경우는 저장 전 검증(`duplicate_review_file`)이 잡는다.
  return (
    incoming.length === files.size &&
    incoming.every(file => files.get(file.file_ref)?.file_id === file.file_id)
  );
}

/**
 * 구조 통째 교체본을 만든다: 넘긴 그룹·제외 목록에 지금 파일 객체(읽기 전용 `name`·
 * `num_pages`·`input_index` 포함)와 지금 `file_groups.base_version` 을 붙이고, 문서 배치
 * 보기는 `layouts` 의 같은 `step_id` 로 바꾼 Job 을 함께 돌려준다. 지금 Job 에 구성 정보가
 * 없거나 파일 집합이 다르면 `null`.
 */
export function buildStructureReplacement(
  current: ReviewJob,
  input: StructureGroupsInput,
  layouts: readonly Layout[],
): { fileGroups: FileGroups; next: ReviewJob } | null {
  const before = current.file_groups;
  if (!before || !fileSetMatches(before, input.groups)) return null;
  const files = filesByRef(before);
  const fileGroups: FileGroups = {
    base_version: before.base_version,
    groups: input.groups.map(group => ({
      group_id: group.group_id,
      layout_step_id: group.layout_step_id,
      files: group.files.map(file => files.get(file.file_ref) as ReviewFile),
    })),
    excluded_pages: input.excluded_pages,
    excluded_documents: input.excluded_documents,
  };
  const next: ReviewJob = {
    ...current,
    file_groups: fileGroups,
    output: current.output.map(item =>
      isResult(item)
        ? item
        : (layouts.find(layout => layout.step_id === item.step_id) ?? item),
    ),
  };
  return { fileGroups, next };
}
