import type { PageMark } from "@/components/studio-ui-kit/page-position-bar";
import {
  isValueEntry,
  toPointer,
  viewerIndex,
  type ChangeDraft,
  type PageRef,
  type PairedHighlight,
  type ValidationIssue,
} from "@/lib/review-model";

// 위치 바에 표시할 페이지(순수): 값을 고친 페이지, 검증 문제가 있는 페이지, 이미지가 아직 없는 페이지.

/** `child` 가 `parent` 와 같거나 그 아래 pointer 인가(`""` 는 전체). */
function sameOrChild(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}/`);
}

/** 결과 `resultId` 의 `pointer`(또는 그 아래) 값 하이라이트가 가리키는 뷰어 위치. */
function pointerIndexes(
  highlights: readonly PairedHighlight[],
  resultId: string,
  pointer: string,
): number[] {
  const prefix = `${resultId}#`;
  const out: number[] = [];
  for (const highlight of highlights) {
    if (!highlight.id.startsWith(prefix)) continue;
    if (!sameOrChild(pointer, highlight.pointer)) continue;
    out.push(highlight.viewerIndex);
  }
  return out;
}

/**
 * 값 변경 항목이 가리키는 페이지. 항목의 `path`(또는 그 아래)에 좌표가 있는 하이라이트의 위치다.
 * 결과 id 는 `${resultId}#` 접두사로 정확히 비교한다(`r1` 이 `r10` 과 섞이지 않게).
 */
export function changedPageIndexes(
  entries: readonly ChangeDraft[],
  highlights: readonly PairedHighlight[],
): number[] {
  const out = new Set<number>();
  for (const entry of entries) {
    if (!isValueEntry(entry)) continue;
    for (const index of pointerIndexes(
      highlights,
      entry.resultId,
      toPointer(entry.path),
    )) {
      out.add(index);
    }
  }
  return [...out];
}

/**
 * 검증 문제가 가리키는 페이지. 페이지 문제는 이 문서에 해당할 때 그 페이지, 값 문제는 그 필드의
 * 하이라이트 위치. 문서 전체·업로드·Job 문제는 페이지가 없다.
 */
export function issuePageIndexes(
  issues: readonly ValidationIssue[],
  docPages: readonly PageRef[],
  documentId: string | null,
  highlights: readonly PairedHighlight[],
): number[] {
  const out = new Set<number>();
  for (const issue of issues) {
    const { where } = issue;
    if (where.kind === "page") {
      if (documentId === null || !where.documentIds.includes(documentId)) {
        continue;
      }
      const index = viewerIndex(docPages, where.page);
      if (index >= 0) out.add(index);
    } else if (where.kind === "field") {
      for (const index of pointerIndexes(
        highlights,
        where.resultId,
        where.pointer,
      )) {
        out.add(index);
      }
    }
  }
  return [...out];
}

/** 이미지 URL 이 아직 없는(빈 문자열) 페이지. */
export function missingImageIndexes(imageUrls: readonly string[]): number[] {
  const out: number[] = [];
  imageUrls.forEach((url, index) => {
    if (url === "") out.push(index);
  });
  return out;
}

export function pageMarksFor({
  entries,
  highlights,
  issues,
  docPages,
  documentId,
  imageUrls,
}: {
  entries: readonly ChangeDraft[];
  highlights: readonly PairedHighlight[];
  issues: readonly ValidationIssue[];
  docPages: readonly PageRef[];
  documentId: string | null;
  imageUrls: readonly string[];
}): PageMark[] {
  const marks: PageMark[] = [];
  for (const index of changedPageIndexes(entries, highlights)) {
    marks.push({ index, kind: "changed" });
  }
  for (const index of issuePageIndexes(
    issues,
    docPages,
    documentId,
    highlights,
  )) {
    marks.push({ index, kind: "issue" });
  }
  for (const index of missingImageIndexes(imageUrls)) {
    marks.push({ index, kind: "noImage" });
  }
  return marks;
}
