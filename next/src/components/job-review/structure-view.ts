import type {
  StructureLoosePage,
  StructurePage,
  StructureDocument,
} from "@/components/studio-ui-kit/structure-editor";
import {
  documentsOf,
  flattenPages,
  flattenSources,
  formatPageRanges,
  groupOfFile,
  labelChoices,
  moveFile,
  pageKey,
  parsePageRangeText,
  type DropReason,
  type PageRef,
  type ReviewDocument,
  type ReviewJob,
  type SourceRange,
  type ValidationIssue,
} from "@/lib/review-model";
import type { FileEntry } from "./job-review-state";

export type StructureView = {
  strips: StructureDocument[];
  excluded: StructureLoosePage[];
  /** 어느 문서에도·제외에도 없는 페이지(`page_missing`). */
  unplaced: StructureLoosePage[];
  groupBoundariesAfter: number[];
  /** `num_pages` 를 모르는 파일이 있어 빠진 페이지를 판단하지 못했다. */
  coverageUnknown: boolean;
  /** 필름스트립에 놓이는 페이지 수 전부(띠 + 제외 + 빠진 페이지). 이웃 보기 전환 기준. */
  totalPages: number;
};

/**
 * `index` 띠를 포함하는, 같은 `groupId` 가 연속한 띠 구간(0-based, 양끝 포함). 같은 그룹이 떨어진
 * 자리에도 있으면 그쪽은 넣지 않는다. 문서 위치 지정이 그룹 경계를 넘지 않게 범위를 정할 때 쓴다.
 * `index` 가 범위 밖이면 `{ first: index, last: index }`.
 */
export function groupBlockOf(
  strips: readonly { groupId: string }[],
  index: number,
): { first: number; last: number } {
  const groupId = strips[index]?.groupId;
  if (groupId === undefined) return { first: index, last: index };
  let first = index;
  while (first > 0 && strips[first - 1]?.groupId === groupId) first -= 1;
  let last = index;
  while (last < strips.length - 1 && strips[last + 1]?.groupId === groupId) {
    last += 1;
  }
  return { first, last };
}

function safePages(pages: () => PageRef[]): PageRef[] {
  try {
    return pages();
  } catch {
    return [];
  }
}

function thumbnailOf(
  files: Readonly<Record<string, FileEntry>>,
  ref: PageRef,
): string | null {
  const entry = Object.hasOwn(files, ref.file_ref)
    ? files[ref.file_ref]
    : undefined;
  return entry?.imageUrls[ref.page - 1] || null;
}

/**
 * 필름스트립에 넘길 띠·제외 띠·빈 자리를 편집 중인 Job 과 저장 전 검증에서 만든다.
 * 문서 배치 보기가 하나인 Job 을 전제로 한다(여럿이면 구성 편집을 열지 않는다).
 * 페이지 키는 편집 모델의 `pageKey`(`file_ref:page`).
 */
export function buildStructureView({
  doc,
  job,
  files,
  issues,
  layoutStepId,
}: {
  doc: ReviewDocument;
  job: ReviewJob;
  files: Readonly<Record<string, FileEntry>>;
  issues: readonly ValidationIssue[];
  /** 이 문서 배치 보기의 문서만 띠로 만든다. 생략하면 모든 보기. */
  layoutStepId?: string | null;
}): StructureView {
  // 겹친 페이지: 문서별로(제외와 겹치면 제외 띠 쪽도) 표시한다.
  const overlapByDocument = new Map<string, Set<string>>();
  const overlapExcluded = new Set<string>();
  const missing: PageRef[] = [];
  let coverageUnknown = false;
  for (const issue of issues) {
    const where = issue.where;
    if (issue.code === "page_missing" && where.kind === "job") {
      if (issue.detail?.coverageUnknown) coverageUnknown = true;
      continue;
    }
    if (where.kind !== "page") continue;
    const key = pageKey(where.page);
    if (issue.code === "page_missing") missing.push(where.page);
    if (
      issue.code === "page_overlap" ||
      issue.code === "duplicate_review_page"
    ) {
      for (const id of where.documentIds) {
        const set = overlapByDocument.get(id) ?? new Set<string>();
        set.add(key);
        overlapByDocument.set(id, set);
      }
      if (issue.detail?.excluded) overlapExcluded.add(key);
    }
  }

  const excludedDocuments = new Set(job.file_groups?.excluded_documents ?? []);
  const strips: StructureDocument[] = documentsOf(job)
    .filter(item => layoutStepId === undefined || item.stepId === layoutStepId)
    .map(({ stepId, document }) => {
      const overlaps = overlapByDocument.get(document.document_id);
      const choices = labelChoices(doc, job, document.document_id, stepId);
      const pages: StructurePage[] = safePages(() =>
        flattenPages(document),
      ).map(ref => {
        const key = pageKey(ref);
        return {
          key,
          fileRef: ref.file_ref,
          page: ref.page,
          thumbnailUrl: thumbnailOf(files, ref),
          ...(overlaps?.has(key) ? { issue: "overlap" as const } : {}),
        };
      });
      return {
        documentId: document.document_id,
        label: document.label,
        ...(choices ? { labelChoices: choices } : {}),
        labelNotInConfig: Boolean(
          choices &&
          document.label !== null &&
          !choices.includes(document.label),
        ),
        groupId: document.group_id,
        pages,
        ...(excludedDocuments.has(document.document_id)
          ? { excluded: true }
          : {}),
      };
    });

  const loose = (ref: PageRef, issue?: StructurePage["issue"]) => {
    const key = pageKey(ref);
    return {
      key,
      fileRef: ref.file_ref,
      page: ref.page,
      groupId: groupOfFile(job, ref.file_ref)?.group_id ?? "",
      thumbnailUrl: thumbnailOf(files, ref),
      ...(issue ? { issue } : {}),
    };
  };

  const excluded = safePages(() =>
    flattenSources(job.file_groups?.excluded_pages ?? []),
  ).map(ref =>
    loose(ref, overlapExcluded.has(pageKey(ref)) ? "overlap" : undefined),
  );

  const groupBoundariesAfter: number[] = [];
  strips.forEach((strip, index) => {
    const next = strips[index + 1];
    if (next && next.groupId !== strip.groupId)
      groupBoundariesAfter.push(index);
  });

  const unplaced = missing.map(ref => loose(ref, "missing"));
  const totalPages =
    strips.reduce((sum, strip) => sum + strip.pages.length, 0) +
    excluded.length +
    unplaced.length;

  return {
    strips,
    excluded,
    unplaced,
    groupBoundariesAfter,
    coverageUnknown,
    totalPages,
  };
}

/** 페이지 범위 입력의 한 행(파일 + 범위 표기). */
export type PageRangeText = { fileRef: string; text: string };

/** 문서 `source_files` → 범위 입력 행(파일마다 한 행, 입력 순서 그대로). */
export function pageRangeRows(
  sourceFiles: readonly SourceRange[],
): PageRangeText[] {
  return sourceFiles.map(source => ({
    fileRef: source.file_ref,
    text: formatPageRanges(source.page_ranges),
  }));
}

/** 범위 입력 행 → `source_files`. 읽을 수 없는 행이 있으면 `null`. */
export function sourcesFromRows(
  rows: readonly PageRangeText[],
): SourceRange[] | null {
  const out: SourceRange[] = [];
  for (const row of rows) {
    const ranges = parsePageRangeText(row.text);
    if (!ranges) return null;
    out.push({ file_ref: row.fileRef, page_ranges: ranges });
  }
  return out;
}

/** `review.structure.errors.*` 문구가 있는 편집 실패 사유. */
const DROP_REASONS = [
  "document_missing",
  "page_not_in_document",
  "result_missing",
  "path_missing",
  "result_not_editable",
  "group_mismatch",
  "target_missing",
  "already_excluded",
  "multi_layout_unsupported",
  "index_out_of_range",
  "invalid_document_id",
  "path_exists",
  "depends_on_reverted",
  "invalid_page_ranges",
  "mixed_file_document",
] as const satisfies readonly DropReason[];

export function isKnownDropReason(
  code: DropReason,
): code is (typeof DROP_REASONS)[number] {
  return (DROP_REASONS as readonly string[]).includes(code);
}

/** 파일 하나의 이동 선택지. 사유가 `null` 이면 그쪽으로 옮길 수 있다. */
export type FileMoveOptions = {
  /** 다른 그룹마다(그룹 순서대로). `position` 은 지금 그룹 순서(1-based). */
  targets: { groupId: string; position: number; reason: DropReason | null }[];
  /** 새 그룹으로 분리. */
  newGroup: DropReason | null;
};

/** 시험 적용에만 쓰는 새 그룹 id(실제 변경에는 새로 만든 id 를 쓴다). */
const PROBE_GROUP_ID = "review-grp-probe";

/**
 * 파일 `fileRef` 를 옮길 수 있는 곳과 막는 사유. 편집 모델의 `moveFile` 을 시험
 * 적용해 정한다(순수 계산 — 세션은 그대로).
 */
export function fileMoveOptions(
  job: ReviewJob,
  fileRef: string,
): FileMoveOptions {
  const groups = job.file_groups?.groups ?? [];
  const reasonOf = (outcome: ReturnType<typeof moveFile>) =>
    outcome.ok ? null : outcome.reason;
  const targets = groups.flatMap((group, index) =>
    group.files.some(file => file.file_ref === fileRef)
      ? []
      : [
          {
            groupId: group.group_id,
            position: index + 1,
            reason: reasonOf(
              moveFile(job, fileRef, { groupId: group.group_id }),
            ),
          },
        ],
  );
  return {
    targets,
    newGroup: reasonOf(moveFile(job, fileRef, { newGroupId: PROBE_GROUP_ID })),
  };
}
