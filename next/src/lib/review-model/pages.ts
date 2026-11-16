import { ReviewModelError } from "./errors";
import type {
  PageRange,
  PageRef,
  ReviewDocumentEntry,
  ReviewJob,
  SourceRange,
} from "./types";

/** 페이지 번호 상한과 문서당 펼친 페이지 상한(Schema·서버 한도). */
export const MAX_PAGE_NUMBER = 10_000;
export const MAX_DOCUMENT_PAGES = 10_000;

/** 범위 하나가 정수·1 이상·`first <= last`·`MAX_PAGE_NUMBER` 이하인가. */
export function isValidPageRange(range: PageRange): boolean {
  const [first, last] = range;
  return (
    Number.isInteger(first) &&
    Number.isInteger(last) &&
    first >= 1 &&
    first <= last &&
    last <= MAX_PAGE_NUMBER
  );
}

/**
 * `source_files` 를 페이지 단위 목록으로 펼친다(순서 유지, 반복 참조 그대로).
 * 범위가 1..10,000 밖이거나 역순이면, 또는 총 10,000 페이지를 넘으면 펼치기 전에 거부한다.
 */
export function flattenSources(sources: readonly SourceRange[]): PageRef[] {
  let total = 0;
  sources.forEach((source, sourceIndex) => {
    source.page_ranges.forEach((range, rangeIndex) => {
      if (!isValidPageRange(range)) {
        throw new ReviewModelError("invalid_document", {
          pointer: `/${sourceIndex}/page_ranges/${rangeIndex}`,
          details: { reason: "page_range", file_ref: source.file_ref },
        });
      }
      total += range[1] - range[0] + 1;
    });
  });
  if (total > MAX_DOCUMENT_PAGES) {
    throw new ReviewModelError("invalid_document", {
      details: {
        reason: "page_limit",
        pages: total,
        limit: MAX_DOCUMENT_PAGES,
      },
    });
  }
  const out: PageRef[] = [];
  for (const source of sources) {
    for (const [first, last] of source.page_ranges) {
      for (let page = first; page <= last; page++) {
        out.push({ file_ref: source.file_ref, page });
      }
    }
  }
  return out;
}

/** 문서의 페이지 목록(뷰어 순서). */
export function flattenPages(document: ReviewDocumentEntry): PageRef[] {
  return flattenSources(document.source_files);
}

/**
 * 페이지 목록을 `source_files` 로 다시 묶는다. 같은 파일이 이어지는 동안은 한
 * source 에 두고, 그 안에서 바로 다음 페이지(오름차순 +1)만 범위로 합친다.
 * 절대 정렬하지 않는다 — `flattenSources(compressPages(x))` 는 `x` 와 같다.
 */
export function compressPages(pages: readonly PageRef[]): SourceRange[] {
  const out: { file_ref: string; page_ranges: [number, number][] }[] = [];
  for (const { file_ref, page } of pages) {
    const current = out[out.length - 1];
    if (current === undefined || current.file_ref !== file_ref) {
      out.push({ file_ref, page_ranges: [[page, page]] });
      continue;
    }
    const last = current.page_ranges[current.page_ranges.length - 1];
    if (last !== undefined && page === last[1] + 1) last[1] = page;
    else current.page_ranges.push([page, page]);
  }
  return out;
}

export function pageKey(ref: PageRef): string {
  return `${ref.file_ref}:${ref.page}`;
}

/** `pageKey` 의 역. `file_ref` 에 `:` 가 있어도 마지막 `:` 로 나눈다. */
export function parsePageKey(key: string): PageRef | null {
  const colon = key.lastIndexOf(":");
  if (colon <= 0) return null;
  const pageText = key.slice(colon + 1);
  if (!/^[1-9]\d*$/.test(pageText)) return null;
  return { file_ref: key.slice(0, colon), page: Number(pageText) };
}

export function samePage(a: PageRef, b: PageRef): boolean {
  return a.file_ref === b.file_ref && a.page === b.page;
}

/** 페이지 "집합" 비교 — 순서·반복은 보지 않는다(서버 링크 판정과 같은 기준). */
export function pageSetEquals(
  a: readonly PageRef[],
  b: readonly PageRef[],
): boolean {
  const left = new Set(a.map(pageKey));
  const right = new Set(b.map(pageKey));
  if (left.size !== right.size) return false;
  for (const key of left) if (!right.has(key)) return false;
  return true;
}

/** 읽기 전용 `num_pages`. 없으면 `null`. */
export function filePageCount(job: ReviewJob, fileRef: string): number | null {
  for (const group of job.file_groups?.groups ?? []) {
    for (const file of group.files) {
      if (file.file_ref === fileRef) {
        return Number.isInteger(file.num_pages)
          ? (file.num_pages as number)
          : null;
      }
    }
  }
  return null;
}

const RANGE_TEXT = /^(\d+)(?:\s*[-–]\s*(\d+))?$/;

/**
 * 페이지 범위 입력(`"1-3, 5"`·`"1–3"`·`"7"`)을 범위 목록으로. 공백은 무시하고,
 * 하이픈과 en dash 를 받는다. 빈 입력·빈 항목·0·역순(`5-3`)·정수가 아닌 값은 `null`.
 * 결과는 입력 순서 그대로다(정렬·병합하지 않는다 — 순서가 문서 안 페이지 순서).
 * 파일 페이지 수·`MAX_PAGE_NUMBER` 초과는 여기서 보지 않는다.
 */
export function parsePageRangeText(text: string): PageRange[] | null {
  const parts = text.split(",").map(part => part.trim());
  if (parts.length === 0 || parts.every(part => part === "")) return null;
  const out: PageRange[] = [];
  for (const part of parts) {
    const match = RANGE_TEXT.exec(part);
    if (!match) return null;
    const first = Number(match[1]);
    const last = match[2] === undefined ? first : Number(match[2]);
    if (
      !Number.isSafeInteger(first) ||
      !Number.isSafeInteger(last) ||
      first < 1 ||
      first > last
    ) {
      return null;
    }
    out.push([first, last]);
  }
  return out;
}

/**
 * 범위 중 하나라도 `pages` 의 페이지를 포함하는가. 범위 길이가 아니라 `pages` 수만큼만 보므로
 * `[1, 1e9]` 같은 큰 범위에서도 바로 끝난다.
 */
export function rangesOverlapPages(
  ranges: readonly PageRange[],
  pages: ReadonlySet<number>,
): boolean {
  if (ranges.length === 0) return false;
  for (const page of pages) {
    if (ranges.some(([first, last]) => first <= page && page <= last)) {
      return true;
    }
  }
  return false;
}

/** 범위 목록을 입력 형식(`"1-3, 5"`)으로. 빈 목록은 빈 문자열. */
export function formatPageRanges(ranges: readonly PageRange[]): string {
  return ranges
    .map(([first, last]) => (first === last ? `${first}` : `${first}-${last}`))
    .join(", ");
}
