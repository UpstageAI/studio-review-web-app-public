import type { StructureClickModifiers } from "./types";

/**
 * 필름스트립·페이지 격자가 함께 받는 편집 콜백. 편집 결과는 이 콜백으로만 알리고 두 view 는 상태를
 * 갖지 않는다. 페이지는 같은 파일 그룹 문서 사이에서만 오간다. 두 view 의 props 에서는 모두 선택이다
 * — 넘긴 콜백(과 그 짝 문구)의 조작부만 그린다(짝은 `pairs.ts`).
 */
export interface StructureEditorCallbacks {
  /** 같은 문서 안 순서. `toIndex` 는 그 페이지를 뺀 뒤 기준(0-based). */
  onReorderPage: (documentId: string, pageKey: string, toIndex: number) => void;
  /** 다른 문서로 옮기기. `toIndex` 는 대상 문서 기준(0-based). */
  onMovePage: (
    fromDocumentId: string,
    pageKey: string,
    toDocumentId: string,
    toIndex: number,
  ) => void;
  /** `afterPageKey` 뒤에서 잘라 뒤쪽 페이지를 새 문서로. */
  onSplit: (documentId: string, afterPageKey: string) => void;
  /** `fromDocumentId` 의 페이지를 `intoDocumentId` 끝에 붙이고 `from` 을 없앤다. */
  onMergeInto: (fromDocumentId: string, intoDocumentId: string) => void;
  /** 문서 순서. `toIndex` 는 그 문서를 뺀 뒤 기준(0-based). */
  onReorderDocument: (documentId: string, toIndex: number) => void;
  onExcludePage: (documentId: string, pageKey: string) => void;
  /** 제외한 페이지를 같은 그룹 문서의 `toIndex`(0-based)에 되돌린다. */
  onRestorePage: (
    pageKey: string,
    toDocumentId: string,
    toIndex: number,
  ) => void;
  onLabelChange: (documentId: string, label: string | null) => void;
  /** 문서를 제외한다(문서 자리는 남는다). */
  onExcludeDocument?: (documentId: string) => void;
  /** 제외한 문서를 되돌린다. */
  onRestoreDocument?: (documentId: string) => void;
  /** 제외·빠진 페이지 자리의 페이지로 새 문서를 만든다. */
  onRestoreToNewDocument?: (pageKey: string) => void;
  /**
   * 썸네일 클릭. 제외 자리 페이지는 `documentId: null`. `index` 는 문서(또는 제외 자리) 안 위치.
   * `modifiers` 는 클릭 때 누른 보조 키다(두 view 모두 넘긴다). 여러 장 선택은 페이지 격자에서만
   * 쓰므로 필름스트립 쪽 핸들러는 읽지 않아도 된다.
   */
  onThumbnailClick: (
    documentId: string | null,
    pageKey: string,
    index: number,
    modifiers: StructureClickModifiers,
  ) => void;
}
