import type { LocatedDocument } from "@/lib/review-model";
import { documentKey, type DocumentSelection } from "./job-review-state";

// 뷰어 열의 키보드 이동 규칙(순수). 어느 키가 어느 이동인지와 이웃 문서 찾기만 맡고, dispatch 는
// 화면이 한다.

export type ViewerKey = {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
};

export type ViewerKeyCommand =
  { kind: "page"; index: number } | { kind: "document"; delta: -1 | 1 };

/**
 * 뷰어 열이 듣는 단축키(`aria-keyshortcuts` 값, 공백으로 구분). `viewerKeyCommand` 가 처리하는
 * 키와 같아야 한다.
 */
export const VIEWER_KEYSHORTCUTS =
  "PageUp PageDown Home End Alt+ArrowUp Alt+ArrowDown";

/**
 * PageUp·PageDown 은 앞·뒤 쪽, Home·End 는 첫·끝 쪽, Alt+↑·↓ 는 앞·뒤 문서. 이미 그 자리이거나
 * 범위 밖이면 `null`. Ctrl·Meta·Shift 조합은 브라우저·OS 단축키에 맡기므로 `null`.
 */
export function viewerKeyCommand(
  key: ViewerKey,
  pageIndex: number,
  pageCount: number,
): ViewerKeyCommand | null {
  if (key.ctrlKey || key.metaKey || key.shiftKey) return null;
  if (key.altKey) {
    if (key.key === "ArrowDown") return { kind: "document", delta: 1 };
    if (key.key === "ArrowUp") return { kind: "document", delta: -1 };
    return null;
  }
  if (pageCount <= 0) return null;
  const last = pageCount - 1;
  switch (key.key) {
    case "PageDown":
      return pageIndex < last ? { kind: "page", index: pageIndex + 1 } : null;
    case "PageUp":
      return pageIndex > 0 ? { kind: "page", index: pageIndex - 1 } : null;
    case "Home":
      return pageIndex !== 0 ? { kind: "page", index: 0 } : null;
    case "End":
      return pageIndex !== last ? { kind: "page", index: last } : null;
    default:
      return null;
  }
}

/** 보이는 문서 목록에서 현재 문서의 앞(`-1`)·뒤(`+1`) 문서. 현재 문서가 목록에 없거나 끝이면 `null`. */
export function neighborDocument(
  documents: readonly LocatedDocument[],
  current: DocumentSelection | null,
  delta: -1 | 1,
): LocatedDocument | null {
  if (!current) return null;
  const key = documentKey(current);
  const at = documents.findIndex(
    item =>
      documentKey({
        stepId: item.stepId,
        documentId: item.document.document_id,
      }) === key,
  );
  if (at < 0) return null;
  return documents[at + delta] ?? null;
}

/**
 * 글자를 입력하는 요소(input·textarea·select·contentEditable)인가. 그 안의 키는 뷰어 이동으로
 * 가로채지 않는다.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as {
    tagName?: unknown;
    isContentEditable?: unknown;
  } | null;
  if (!element || typeof element.tagName !== "string") return false;
  const tag = element.tagName.toUpperCase();
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    element.isContentEditable === true
  );
}
