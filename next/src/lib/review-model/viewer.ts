import { flattenPages, samePage } from "./pages";
import type { PageRef, ReviewDocumentEntry, ReviewJob } from "./types";

/**
 * Job 응답(원본 결과 좌표)의 병합 페이지 공간. 그 Job 의 입력 파일을
 * `input_index` 순으로 이어 붙인 번호다. `offset` 은 앞 파일들의 페이지 수 합.
 */
export type PageSpace = {
  readonly files: readonly {
    readonly file_ref: string;
    readonly input_index: number;
    readonly num_pages: number;
    readonly offset: number;
  }[];
};

/**
 * Job 응답 `page` 의 첫 번호. 서버는 이 번호를 Job 입력 파일을 그룹 순서로 이어
 * 붙인 1-based 병합 페이지로 읽는다(검수 baseline 을 만들 때와 같은 규칙). 앱은
 * `input_index` 순으로 이어 붙이며, 보통 Job 에서는 두 순서가 같다.
 */
export const MERGED_PAGE_BASE = 1;

function ownOrdinal(jobId: string, fileRef: string): number | null {
  const hash = fileRef.lastIndexOf("#");
  if (hash <= 0 || fileRef.slice(0, hash) !== jobId) return null;
  const text = fileRef.slice(hash + 1);
  return /^(0|[1-9]\d*)$/.test(text) ? Number(text) : null;
}

/** `file_ref` 가 이 Job 의 입력인가(`"<jobId>#<n>"`). */
export function isOwnFileRef(jobId: string, fileRef: string): boolean {
  return ownOrdinal(jobId, fileRef) !== null;
}

/**
 * 병합 페이지 공간을 만든다. 이 Job 자신의 입력 파일(`file_ref` 접두사가 Job id)만
 * 쓴다 — 다른 Job 에서 온 파일은 그 Job 의 좌표 공간이다. `input_index` 가 없으면
 * `file_ref` 의 `#n`(서버가 같은 값을 쓴다), `num_pages` 가 없으면
 * `numPagesByFileRef` 로 보충한다. 페이지 수를 모르는 파일이 있거나 `input_index`
 * 가 0..n-1 로 이어지지 않으면(빠진 입력이 있어 offset 을 알 수 없음) `null`.
 */
export function buildPageSpace(
  job: ReviewJob,
  numPagesByFileRef?: Readonly<Record<string, number>>,
): PageSpace | null {
  const files: { file_ref: string; input_index: number; num_pages: number }[] =
    [];
  for (const group of job.file_groups?.groups ?? []) {
    for (const file of group.files) {
      const ordinal = ownOrdinal(job.id, file.file_ref);
      if (ordinal === null) continue;
      const inputIndex = Number.isInteger(file.input_index)
        ? (file.input_index as number)
        : ordinal;
      const supplied =
        numPagesByFileRef && Object.hasOwn(numPagesByFileRef, file.file_ref)
          ? numPagesByFileRef[file.file_ref]
          : undefined;
      const numPages = Number.isInteger(file.num_pages)
        ? (file.num_pages as number)
        : supplied;
      if (
        numPages === undefined ||
        !Number.isInteger(numPages) ||
        numPages < 1
      ) {
        return null;
      }
      files.push({
        file_ref: file.file_ref,
        input_index: inputIndex,
        num_pages: numPages,
      });
    }
  }
  if (files.length === 0) return null;
  const sorted = [...files].sort((a, b) => a.input_index - b.input_index);
  let offset = 0;
  const out: PageSpace["files"][number][] = [];
  for (const [index, file] of sorted.entries()) {
    if (file.input_index !== index) return null;
    out.push({ ...file, offset });
    offset += file.num_pages;
  }
  return { files: out };
}

/** 병합 페이지 → 파일 로컬 페이지. 공간 밖이면 `null`. */
export function mergedToLocal(
  space: PageSpace,
  mergedPage: number,
): PageRef | null {
  if (!Number.isInteger(mergedPage)) return null;
  const zeroBased = mergedPage - MERGED_PAGE_BASE;
  for (const file of space.files) {
    if (zeroBased >= file.offset && zeroBased < file.offset + file.num_pages) {
      return { file_ref: file.file_ref, page: zeroBased - file.offset + 1 };
    }
  }
  return null;
}

/** 파일 로컬 페이지 → 병합 페이지. 공간 밖이면 `null`. */
export function localToMerged(space: PageSpace, ref: PageRef): number | null {
  const file = space.files.find(item => item.file_ref === ref.file_ref);
  if (!file || !Number.isInteger(ref.page)) return null;
  if (ref.page < 1 || ref.page > file.num_pages) return null;
  return file.offset + ref.page - 1 + MERGED_PAGE_BASE;
}

/** 문서의 뷰어 페이지 순서. 범위가 잘못된 문서는 빈 목록(검증이 따로 알린다). */
export function documentPages(document: ReviewDocumentEntry): PageRef[] {
  try {
    return flattenPages(document);
  } catch {
    return [];
  }
}

/** 문서 안 뷰어 위치(0-based). 없으면 -1. */
export function viewerIndex(
  docPages: readonly PageRef[],
  ref: PageRef,
): number {
  return docPages.findIndex(page => samePage(page, ref));
}

/** 뷰어 위치(0-based) → 페이지. 범위 밖이면 `null`. */
export function viewerPage(
  docPages: readonly PageRef[],
  index: number,
): PageRef | null {
  return Number.isInteger(index) ? (docPages[index] ?? null) : null;
}
