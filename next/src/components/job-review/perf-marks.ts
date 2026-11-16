/**
 * 검수 화면의 User Timing 마크. 앱은 마크를 읽지 않고, 측정 하네스(`mock/measure.mjs`)가
 * `performance.getEntriesByName` 으로 읽어 "선택 → 이미지가 그려짐" 같은 구간을 하네스 대기와
 * 떼어 잰다. 마크는 이름·페이지 번호·출처 문자열만 담는다. `performance.mark` 가 없거나 실패하면
 * 아무것도 하지 않는다(화면 동작에 영향 없음).
 */

/** 페이지 선택(`SELECT_PAGE` dispatch 직전). `detail: {page, source}`. */
export const MARK_SELECT_PAGE = "review:select-page";
/** 뷰어의 페이지 이미지가 로드된 다음 프레임. `detail: {page}`. */
export const MARK_PAGE_IMAGE_PAINTED = "review:page-image-painted";
/** 문서 목록에 처음 항목이 생긴 시점(화면당 한 번). */
export const MARK_DOCUMENT_LIST_READY = "review:document-list-ready";
/** 검수 문서를 읽어 `LOADED` 를 dispatch 하기 직전. */
export const MARK_LOADED = "review:loaded";
/**
 * 값 패널에서 하이라이트를 가리키거나(`HOVER_HIGHLIGHT`) 고르기(`SELECT_HIGHLIGHT`) 직전.
 * `detail: {kind}`. 가리킬 때마다 생겨 쌓이므로 하이라이트 마크 둘은 측정 중에만 남긴다
 * (`HIGHLIGHT_MARKS_FLAG`).
 */
export const MARK_HIGHLIGHT_INPUT = "review:highlight-input";
/** 가리킨·고른 하이라이트가 바뀐 렌더의 커밋이 끝난 시점(provider 의 layout effect). */
export const MARK_HIGHLIGHT_COMMITTED = "review:highlight-committed";

/**
 * 하이라이트 마크를 켜는 전역 플래그 이름. 측정 하네스가 페이지를 열기 전에
 * `window[HIGHLIGHT_MARKS_FLAG] = true` 를 둔다. 평소에는 없어서 마크를 남기지 않는다.
 */
export const HIGHLIGHT_MARKS_FLAG = "__reviewHighlightMarks";

/** 페이지 선택이 어디서 왔는지. */
export type SelectPageSource =
  | "keyboard"
  | "viewer"
  | "tabs"
  | "bar"
  | "toolbar"
  | "filmstrip"
  | "organizer";

/** 하이라이트 입력의 종류. */
export type HighlightInputKind = "hover" | "select";

export interface PerfMarkDetail {
  /** 1-based 페이지 번호. */
  page?: number;
  source?: SelectPageSource;
  kind?: HighlightInputKind;
}

function mark(name: string, detail?: PerfMarkDetail): void {
  if (
    typeof performance === "undefined" ||
    typeof performance.mark !== "function"
  ) {
    return;
  }
  try {
    if (detail) performance.mark(name, { detail });
    else performance.mark(name);
  } catch {
    // 마크는 측정용이라 실패해도 화면 동작을 바꾸지 않는다.
  }
}

/** `index` 는 0-based 페이지 위치. 마크에는 1-based 로 남긴다. */
export function markSelectPage(index: number, source: SelectPageSource): void {
  mark(MARK_SELECT_PAGE, { page: index + 1, source });
}

/** `page` 는 1-based. */
export function markPageImagePainted(page: number): void {
  mark(MARK_PAGE_IMAGE_PAINTED, { page });
}

export function markDocumentListReady(): void {
  mark(MARK_DOCUMENT_LIST_READY);
}

export function markLoaded(): void {
  mark(MARK_LOADED);
}

function highlightMarksEnabled(): boolean {
  return (globalThis as Record<string, unknown>)[HIGHLIGHT_MARKS_FLAG] === true;
}

export function markHighlightInput(kind: HighlightInputKind): void {
  if (!highlightMarksEnabled()) return;
  mark(MARK_HIGHLIGHT_INPUT, { kind });
}

export function markHighlightCommitted(): void {
  if (!highlightMarksEnabled()) return;
  mark(MARK_HIGHLIGHT_COMMITTED);
}
