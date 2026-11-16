// 주소창 쿼리 `?doc=<문서 id>&page=<1-based 쪽>` 과 화면 선택 사이의 순수 변환. 다른 파라미터는
// 그대로 둔다. 읽기·쓰기 시점(`window`)은 `use-url-selection.ts` 와 provider 가 맡는다.

export const DOC_PARAM = "doc";
export const PAGE_PARAM = "page";

export type UrlSelection = {
  documentId: string | null;
  /** 뷰어 위치(0-based). 쿼리의 `page` 는 1-based. */
  pageIndex: number | null;
};

/** `?doc=…&page=…` 를 읽는다. `page` 는 1 이상의 정수만 인정하고 그 밖은 `null`. */
export function readUrlSelection(search: string): UrlSelection {
  const params = new URLSearchParams(search);
  const doc = params.get(DOC_PARAM);
  const page = params.get(PAGE_PARAM);
  const pageNumber =
    page !== null && /^[1-9]\d*$/.test(page) ? Number(page) : null;
  return {
    documentId: doc ? doc : null,
    pageIndex:
      pageNumber !== null && Number.isSafeInteger(pageNumber)
        ? pageNumber - 1
        : null,
  };
}

/**
 * 선택을 쿼리에 적는다(없으면 두 파라미터를 지운다). 다른 파라미터는 보존하고, 결과는 빈 문자열
 * 또는 `?` 로 시작하는 문자열이다.
 */
export function withUrlSelection(
  search: string,
  selection: { documentId: string; pageIndex: number } | null,
): string {
  const params = new URLSearchParams(search);
  if (selection) {
    params.set(DOC_PARAM, selection.documentId);
    params.set(PAGE_PARAM, String(Math.max(selection.pageIndex, 0) + 1));
  } else {
    params.delete(DOC_PARAM);
    params.delete(PAGE_PARAM);
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}
