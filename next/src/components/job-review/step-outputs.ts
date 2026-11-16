import type {
  InstructCitation,
  InstructOutput,
} from "@/lib/review-api/instruct";
import type { ParseElementItem } from "@/lib/review-api/job-response";
import { parseElementKey } from "@/lib/review-api/parse-highlights";
import {
  documentPages,
  localToMerged,
  mergedToLocal,
  rangesOverlapPages,
  viewerIndex,
  type Coordinate,
  type HighlightLike,
  type LocatedDocument,
  type PageRef,
  type PageSpace,
} from "@/lib/review-model";
import { instructHighlightId, parseHighlightId } from "./job-review-state";

// Parse·Instruct Step 탭이 쓰는 파생값. Job 응답(병합 페이지 기준)을
// 선택 문서의 뷰어 페이지로 옮긴다.

/** Instruct 인용 하이라이트 색. */
export const INSTRUCT_CITATION_COLOR = "var(--chart-2)";

/** Parse 탭 목록 항목(Studio UI Kit `DocumentElementListItem` 모양 + 그림 요소의 이미지). */
export type ParseListItem = {
  /** 뷰어 Parse 하이라이트와 같은 `parse:{file_ref}:p{파일 로컬 page}-{elementId}`. */
  id: string;
  /** 뷰어 페이지(1-based). */
  page: number;
  text: string;
  type?: string;
  /** 그림 요소의 이미지 data URL. 없으면 `null`. */
  image: string | null;
  /** 표 요소의 `content.html` 원문(표로 그릴 근거). 없으면 `null`. */
  tableHtml: string | null;
};

/**
 * 선택 문서의 뷰어 페이지 순서대로 그 페이지의 Parse 요소를 나열한다. 공간을 모르면(`null`)
 * 빈 목록. 같은 페이지가 문서에 두 번 들어 있으면 처음 자리만 쓴다(id 가 겹치지 않게).
 * 요소는 병합 page 로 찾고, id 는 그 자리의 (파일, 로컬 page) 로 만든다.
 */
export function parseItemsFor(
  docPages: readonly PageRef[],
  elements: readonly ParseElementItem[],
  space: PageSpace | null,
): ParseListItem[] {
  if (!space || elements.length === 0) return [];
  const byPage = new Map<number, ParseElementItem[]>();
  for (const element of elements) {
    const list = byPage.get(element.page);
    if (list) list.push(element);
    else byPage.set(element.page, [element]);
  }
  const seen = new Set<number>();
  const out: ParseListItem[] = [];
  docPages.forEach((ref, index) => {
    const merged = localToMerged(space, ref);
    if (merged === null || seen.has(merged)) return;
    seen.add(merged);
    for (const element of byPage.get(merged) ?? []) {
      out.push({
        id: parseHighlightId(
          ref.file_ref,
          parseElementKey(ref.page, element.elementId),
        ),
        page: index + 1,
        text: element.text,
        ...(element.category ? { type: element.category } : {}),
        image: element.image,
        tableHtml: element.tableHtml,
      });
    }
  });
  return out;
}

export type InstructView = {
  stepId: string;
  outputs: readonly InstructOutput[];
  /**
   * `true` 면 선택 문서 범위의 출력만 골랐다. `false` 면 전부를 보인다 — 공간을 모르거나
   * 이 문서 범위와 겹치는 출력이 없을 때(`unmatched`).
   */
  filtered: boolean;
  unmatched: boolean;
};

/**
 * Instruct Step 하나의 출력 중 선택 문서의 병합 페이지와 겹치는 것. 페이지 범위가 없는 출력은
 * 문서 전체에 대한 것으로 보고 함께 보인다. 겹치는 것이 없으면 전부.
 */
export function instructForDocument(
  outputs: readonly InstructOutput[],
  stepId: string,
  docPages: readonly PageRef[],
  space: PageSpace | null,
): InstructView {
  const ofStep = outputs.filter(output => output.stepId === stepId);
  if (!space) {
    return { stepId, outputs: ofStep, filtered: false, unmatched: false };
  }
  const pages = new Set<number>();
  for (const ref of docPages) {
    const merged = localToMerged(space, ref);
    if (merged !== null) pages.add(merged);
  }
  const matched = ofStep.filter(
    output =>
      output.pageRanges.length === 0 ||
      rangesOverlapPages(output.pageRanges, pages),
  );
  if (matched.length === 0) {
    return {
      stepId,
      outputs: ofStep,
      filtered: false,
      unmatched: ofStep.length > 0,
    };
  }
  return { stepId, outputs: matched, filtered: true, unmatched: false };
}

/** 인용이 가리키는 위치(병합 페이지·좌표). */
export type CitationLocation = {
  ref: PageRef;
  coordinates: Coordinate[];
};

/**
 * 인용 → 문서 위치. 좌표·페이지가 없고 Parse 인용이면 같은 id 의 Parse 요소 위치로 대신한다.
 * 공간을 모르거나 위치를 찾지 못하면 `null`.
 */
export function resolveCitation(
  citation: InstructCitation,
  space: PageSpace | null,
  parseElements: readonly ParseElementItem[],
): CitationLocation | null {
  if (!space) return null;
  let page = citation.page;
  let coordinates = citation.coordinates;
  if (
    (coordinates === null || page === null) &&
    citation.sourceType === "parse" &&
    citation.sourceRef !== null
  ) {
    const ref = citation.sourceRef;
    const element = parseElements.find(
      item => item.id === `p${item.page}-${ref}`,
    );
    if (element) {
      page = element.page;
      coordinates = element.coordinates;
    }
  }
  if (page === null || coordinates === null) return null;
  const ref = mergedToLocal(space, page);
  return ref ? { ref, coordinates } : null;
}

/** 인용 칩을 눌렀을 때 고를 문서와 뷰어 위치. 선택 문서에 있으면 그 문서를 먼저 쓴다. */
export type CitationTarget = {
  document: LocatedDocument | null;
  pageIndex: number;
};

export function citationTarget(
  location: CitationLocation,
  docPages: readonly PageRef[],
  documents: readonly LocatedDocument[],
): CitationTarget | null {
  const here = viewerIndex(docPages, location.ref);
  if (here >= 0) return { document: null, pageIndex: here };
  for (const item of documents) {
    const index = viewerIndex(documentPages(item.document), location.ref);
    if (index >= 0) return { document: item, pageIndex: index };
  }
  return null;
}

/** 보이는 Instruct 출력의 인용 중 선택 문서 안에 있는 것 → 뷰어 하이라이트. */
export function instructHighlights(
  view: InstructView | null,
  docPages: readonly PageRef[],
  space: PageSpace | null,
  parseElements: readonly ParseElementItem[],
): HighlightLike[] {
  if (!view || !space) return [];
  const out: HighlightLike[] = [];
  const seen = new Set<string>();
  for (const output of view.outputs) {
    for (const citation of output.citations) {
      const id = instructHighlightId(view.stepId, output.index, citation.index);
      if (seen.has(id)) continue;
      const location = resolveCitation(citation, space, parseElements);
      if (!location) continue;
      const index = viewerIndex(docPages, location.ref);
      if (index < 0) continue;
      seen.add(id);
      out.push({
        id,
        _value: `†${citation.index}`,
        page: index + 1,
        coordinates: location.coordinates,
        color: INSTRUCT_CITATION_COLOR,
      });
    }
  }
  return out;
}
