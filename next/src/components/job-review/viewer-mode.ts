// 뷰어 모드(연속 스크롤 · 한 장씩)의 순수 규칙. 브라우저 기억은 `localStorage` 한 키로, 읽기·쓰기는
// 저장소가 막혀 있어도 던지지 않는다(없으면 기본값 연속 스크롤).

export type ViewerMode = "continuous" | "paged";

/** 브라우저에 기억하는 키. 값은 `"continuous"` 또는 `"paged"`. */
export const VIEWER_MODE_KEY = "review-viewer-mode";

/** 저장소 값 → 모드. `"paged"` 만 한 장씩이고 그 밖(없음·모르는 값)은 연속 스크롤. */
export function parseViewerMode(raw: string | null): ViewerMode {
  return raw === "paged" ? "paged" : "continuous";
}

export function readViewerMode(
  storage: Pick<Storage, "getItem"> | null,
): ViewerMode {
  try {
    return parseViewerMode(storage?.getItem(VIEWER_MODE_KEY) ?? null);
  } catch {
    return "continuous";
  }
}

export function writeViewerMode(
  storage: Pick<Storage, "setItem"> | null,
  mode: ViewerMode,
): void {
  try {
    storage?.setItem(VIEWER_MODE_KEY, mode);
  } catch {
    // 저장소가 가득 찼거나 막혀 있으면 기억하지 않는다.
  }
}
