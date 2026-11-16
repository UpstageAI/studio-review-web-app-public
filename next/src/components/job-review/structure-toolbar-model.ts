import {
  documentPages,
  type LocatedDocument,
  type PageRef,
} from "@/lib/review-model";
import { neighborDocument } from "./document-navigation";
import type { DocumentSelection } from "./job-review-state";

// 구성 모드 뷰어 툴바의 순수 규칙: 이웃 문서 요약, 페이지 범위, 숫자 입력 해석.

/** 경계 띠에 보이는 이웃 문서 요약. */
export type NeighborInfo = {
  stepId: string | null;
  documentId: string;
  /** 보이는 문서 목록 안 위치(0-based). 화면 번호는 `index + 1`. */
  index: number;
  label: string | null;
  /** 읽을 수 없는 페이지 범위면 0. */
  pageCount: number;
  /** 선택 문서와 같은 파일 그룹인가(페이지는 같은 그룹 사이에서만 옮길 수 있다). */
  sameGroup: boolean;
  firstPage: PageRef | null;
  lastPage: PageRef | null;
};

export type Neighbors = {
  previous: NeighborInfo | null;
  next: NeighborInfo | null;
  /** 선택 문서의 목록 안 위치(0-based). 목록에 없으면 -1. */
  position: number;
  total: number;
};

/**
 * 보이는 문서 목록에서 선택 문서의 앞·뒤 문서. 키보드 문서 이동(`neighborDocument`)과 같은
 * 이웃 정의를 쓴다.
 */
export function neighborsOf(
  documents: readonly LocatedDocument[],
  selected: DocumentSelection | null,
): Neighbors {
  const position = selected
    ? documents.findIndex(
        item =>
          item.stepId === selected.stepId &&
          item.document.document_id === selected.documentId,
      )
    : -1;
  const groupId = documents[position]?.document.group_id ?? null;
  const describe = (item: LocatedDocument | null): NeighborInfo | null => {
    if (!item) return null;
    const pages = documentPages(item.document);
    return {
      stepId: item.stepId,
      documentId: item.document.document_id,
      index: documents.indexOf(item),
      label: item.document.label,
      pageCount: pages.length,
      sameGroup: groupId !== null && item.document.group_id === groupId,
      firstPage: pages[0] ?? null,
      lastPage: pages[pages.length - 1] ?? null,
    };
  };
  return {
    previous: describe(neighborDocument(documents, selected, -1)),
    next: describe(neighborDocument(documents, selected, 1)),
    position,
    total: documents.length,
  };
}

/**
 * 문서 페이지 중 `from`‥`to`(1-based, 양끝 포함). 정수가 아니거나 범위를 벗어나거나 역순이면
 * `null`.
 */
export function pagesInRange(
  docPages: readonly PageRef[],
  from: number,
  to: number,
): PageRef[] | null {
  if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
  if (from < 1 || to > docPages.length || from > to) return null;
  return docPages.slice(from - 1, to);
}

/** 1 이상의 정수만 받는다(앞뒤 공백 허용). 아니면 `null`. */
export function parsePositiveInt(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= 1 && Number.isSafeInteger(value) ? value : null;
}
