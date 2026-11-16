import {
  isResult,
  type FileGroup,
  type Layout,
  type Result,
  type ReviewDocument,
  type ReviewDocumentEntry,
  type ReviewJob,
} from "./types";

/** 문서 배치 보기 전부(Classify Step 보기와 `step_id: null` 보기). */
export function layouts(job: ReviewJob): readonly Layout[] {
  return job.output.filter((item): item is Layout => !isResult(item));
}

export function results(job: ReviewJob): readonly Result[] {
  return job.output.filter(isResult);
}

export function isMultiLayout(job: ReviewJob): boolean {
  return layouts(job).length > 1;
}

export function findLayout(
  job: ReviewJob,
  stepId: string | null,
): Layout | null {
  return layouts(job).find(layout => layout.step_id === stepId) ?? null;
}

export function findDocument(
  job: ReviewJob,
  stepId: string | null,
  documentId: string,
): ReviewDocumentEntry | null {
  return (
    findLayout(job, stepId)?.content.documents.find(
      document => document.document_id === documentId,
    ) ?? null
  );
}

export function findResult(job: ReviewJob, resultId: string): Result | null {
  return results(job).find(result => result.id === resultId) ?? null;
}

export type LocatedDocument = {
  readonly stepId: string | null;
  /** 보기 안 `documents[]` 위치. */
  readonly index: number;
  readonly document: ReviewDocumentEntry;
};

/** 모든 보기의 문서를 보기 순서 → 문서 순서로. */
export function documentsOf(job: ReviewJob): readonly LocatedDocument[] {
  return layouts(job).flatMap(layout =>
    layout.content.documents.map((document, index) => ({
      stepId: layout.step_id,
      index,
      document,
    })),
  );
}

export function groupOf(job: ReviewJob, groupId: string): FileGroup | null {
  return (
    job.file_groups?.groups.find(group => group.group_id === groupId) ?? null
  );
}

export function groupOfFile(job: ReviewJob, fileRef: string): FileGroup | null {
  return (
    job.file_groups?.groups.find(group =>
      group.files.some(file => file.file_ref === fileRef),
    ) ?? null
  );
}

/** 결과가 읽는 문서 id(`document_ids` 또는 `field_groups` 의 값 전부). */
export function linkedDocumentIds(result: Result): readonly string[] {
  if (result.link.kind === "documents") return result.link.document_ids;
  if (result.link.kind === "field_groups") {
    return [...new Set(Object.values(result.link.field_groups).flat())];
  }
  return [];
}

/**
 * 문서에 연결된 결과(받은 `link` 기준 — `document_ids` 또는 Merge 결과의 `field_groups`).
 * 분리로 새로 생긴 문서는 저장해서 서버가 다시 연결하기 전까지 연결된 결과가 없다.
 */
export function resultsForDocument(
  job: ReviewJob,
  documentId: string,
): readonly Result[] {
  return results(job).filter(result =>
    linkedDocumentIds(result).includes(documentId),
  );
}

/** 어느 문서에도 연결되지 않은 결과(`link.kind === "none"`). */
export function unlinkedResults(job: ReviewJob): readonly Result[] {
  return results(job).filter(result => result.link.kind === "none");
}

/**
 * 문서 라벨 선택지(문서가 속한 보기 Step 의 `labels`). 보기가 `step_id: null`
 * 이거나 `labels` 가 없으면 `null` → 자유 입력. 멀티 layout 에서 같은 id 가
 * 겹치면 `stepId` 로 보기를 고른다.
 */
export function labelChoices(
  doc: ReviewDocument,
  job: ReviewJob,
  documentId: string,
  stepId?: string | null,
): readonly string[] | null {
  const layout = layouts(job).find(
    item =>
      (stepId === undefined || item.step_id === stepId) &&
      item.content.documents.some(
        document => document.document_id === documentId,
      ),
  );
  if (!layout || layout.step_id === null) return null;
  const step = Object.hasOwn(doc.steps, layout.step_id)
    ? doc.steps[layout.step_id]
    : undefined;
  return step?.labels ?? null;
}

/** `content` 를 고칠 수 있는 상태(`present`·`stale`)인가. */
export function canEditResult(result: Pick<Result, "state">): boolean {
  return result.state === "present" || result.state === "stale";
}

/** 새 문서 id — `review-doc-<uuid>`(47 자, `^[A-Za-z0-9_-]{0,64}$` 안). */
export function newDocumentId(randomUUID: () => string): string {
  return `review-doc-${randomUUID()}`;
}

export const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_-]{0,64}$/;

/** 새 파일 그룹 id — `review-grp-<uuid>`(47 자, 서버 상한 64 자 안). */
export function newGroupId(randomUUID: () => string): string {
  return `review-grp-${randomUUID()}`;
}

/** 파일 그룹 id 모양(서버 규칙: 1..64 자 문자열). */
export function isValidGroupId(id: string): boolean {
  return id.length >= 1 && id.length <= 64;
}

/**
 * 문서 배치가 "나뉜" Job 인가 — 어떤 파일 그룹에 그 그룹 보기(`layout_step_id`)의 문서가 둘 이상이거나,
 * 문서 하나뿐이어도 그 문서가 그룹 파일의 모든 페이지를 덮지 않는다(`num_pages` 를 아는 파일만 센다).
 * 제외 문서도 문서 수에 넣는다(나눈 결과이므로). `file_groups` 나 보기가 없으면 false.
 * 서버는 Classify 의 split 설정을 검수 JSON 에 싣지 않으므로 실제 배치로만 판정한다.
 */
export function hasSplitDocuments(job: ReviewJob): boolean {
  for (const group of job.file_groups?.groups ?? []) {
    const layout = findLayout(job, group.layout_step_id);
    if (!layout) continue;
    const documents = layout.content.documents.filter(
      document => document.group_id === group.group_id,
    );
    if (documents.length >= 2) return true;
    const only = documents[0];
    if (only === undefined) continue;
    // 문서 하나: 그룹 파일의 쪽수를 모두 알 때만 덮는 페이지 수와 비교한다.
    const pageCounts = new Map<string, number>();
    let known = true;
    for (const file of group.files) {
      if (!Number.isInteger(file.num_pages)) {
        known = false;
        break;
      }
      pageCounts.set(file.file_ref, file.num_pages as number);
    }
    if (!known) continue;
    let total = 0;
    for (const count of pageCounts.values()) total += count;
    const covered = new Set<string>();
    for (const source of only.source_files) {
      const count = pageCounts.get(source.file_ref);
      if (count === undefined) continue;
      for (const [first, last] of source.page_ranges) {
        const from = Math.max(1, first);
        const to = Math.min(count, last);
        for (let page = from; page <= to; page++) {
          covered.add(`${source.file_ref}:${page}`);
        }
      }
    }
    if (covered.size < total) return true;
  }
  return false;
}
