import type { StructureEditorCallbacks } from "./callbacks";
import type { StructureEditorLabels } from "./labels";

/** 짝 표가 다루는 view. */
export type StructureEditView = "filmstrip" | "pageGrid";

/** 조작부를 켜는 콜백(공통 콜백 + view props 의 선택 콜백). */
export type StructureEditPairCallback =
  | keyof StructureEditorCallbacks
  | "onRequestDocumentPosition"
  | "onFocusDocument"
  | "onDropPages"
  | "onSizeChange";

/** 조작부와 짝인 문구 키(공통 문구 + view 전용 문구). */
export type StructureEditPairLabel =
  | keyof StructureEditorLabels
  | "splitAfter"
  | "dragDocument"
  | "neighborhood"
  | "splitBefore"
  | "multiDrag"
  | "sizeToggle";

export interface StructureEditPair {
  /** 조작부 id(테스트가 view 별 찾는 방법을 이 id 로 묶는다). */
  id: string;
  /** 이 중 하나라도 있으면 조작부를 켠다. */
  callbacks: readonly StructureEditPairCallback[];
  /** view 별로 함께 넘겨야 하는 문구 키(모두 있어야 한다). 키가 없는 view 에는 이 조작부가 없다. */
  labels: Partial<Record<StructureEditView, readonly StructureEditPairLabel[]>>;
  /**
   * 메뉴 항목이면 그 ⋯ 버튼 이름 문구도 있어야 한다: `page` = `pageMenu`, `document` = `documentMenu`,
   * `unplaced` = `unplacedMenu`(없으면 `pageMenu`).
   */
  menu?: "page" | "document" | "unplaced";
}

const BOTH = <T>(keys: readonly T[]) => ({ filmstrip: keys, pageGrid: keys });

export const STRUCTURE_EDIT_PAIRS: readonly StructureEditPair[] = [
  // 썸네일(셀) 메뉴
  {
    id: "page-earlier",
    callbacks: ["onReorderPage"],
    labels: BOTH(["movePageEarlier"]),
    menu: "page",
  },
  {
    id: "page-later",
    callbacks: ["onReorderPage"],
    labels: BOTH(["movePageLater"]),
    menu: "page",
  },
  {
    id: "page-move",
    callbacks: ["onMovePage"],
    labels: BOTH(["moveToDocument", "documentOption", "noOtherDocument"]),
    menu: "page",
  },
  {
    id: "page-split",
    callbacks: ["onSplit"],
    labels: { pageGrid: ["splitBefore"] },
    menu: "page",
  },
  {
    id: "page-exclude",
    callbacks: ["onExcludePage"],
    labels: BOTH(["excludePage"]),
    menu: "page",
  },
  // ✂(필름스트립은 앞 페이지 뒤, 페이지 격자는 이 페이지 앞)
  {
    id: "split-button",
    callbacks: ["onSplit"],
    labels: { filmstrip: ["splitAfter"], pageGrid: ["splitBefore"] },
  },
  // 제외 페이지 메뉴
  {
    id: "excluded-restore",
    callbacks: ["onRestorePage"],
    labels: BOTH(["restorePage", "documentOption", "noOtherDocument"]),
    menu: "page",
  },
  {
    id: "excluded-new-document",
    callbacks: ["onRestoreToNewDocument"],
    labels: BOTH(["restoreToNewDocument"]),
    menu: "page",
  },
  // 빠진 페이지 메뉴
  {
    id: "unplaced-new-document",
    callbacks: ["onRestoreToNewDocument"],
    labels: BOTH(["restoreToNewDocument"]),
    menu: "unplaced",
  },
  // 라벨 select·입력(없으면 글자 라벨)
  {
    id: "label-field",
    callbacks: ["onLabelChange"],
    labels: BOTH(["label", "noLabel", "notInConfigOption"]),
  },
  // 문서(띠·머리) 메뉴
  {
    id: "document-merge",
    callbacks: ["onMergeInto"],
    labels: BOTH(["mergeWithPrevious"]),
    menu: "document",
  },
  {
    id: "document-earlier",
    callbacks: ["onReorderDocument"],
    labels: BOTH(["moveDocumentEarlier"]),
    menu: "document",
  },
  {
    id: "document-later",
    callbacks: ["onReorderDocument"],
    labels: BOTH(["moveDocumentLater"]),
    menu: "document",
  },
  {
    id: "document-position",
    callbacks: ["onRequestDocumentPosition"],
    labels: BOTH(["moveDocumentTo"]),
    menu: "document",
  },
  {
    id: "document-exclude",
    callbacks: ["onExcludeDocument"],
    labels: BOTH(["documentExclusion"]),
    menu: "document",
  },
  {
    id: "document-restore",
    callbacks: ["onRestoreDocument"],
    labels: BOTH(["documentExclusion"]),
    menu: "document",
  },
  // view 전용
  {
    id: "drag-document",
    callbacks: ["onReorderDocument", "onMergeInto"],
    labels: { filmstrip: ["dragDocument"] },
  },
  {
    id: "neighborhood-focus",
    callbacks: ["onFocusDocument"],
    labels: { filmstrip: ["neighborhood"] },
  },
  {
    id: "multi-drag",
    callbacks: ["onDropPages"],
    labels: { pageGrid: ["multiDrag"] },
  },
  {
    id: "size-toggle",
    callbacks: ["onSizeChange"],
    labels: { pageGrid: ["sizeToggle"] },
  },
];

/** 한 view 에 해당하는 짝(그 view 의 문구 키와 함께). */
export function structureEditPairsFor(view: StructureEditView) {
  return STRUCTURE_EDIT_PAIRS.flatMap(pair => {
    const labels = pair.labels[view];
    return labels ? [{ ...pair, labels }] : [];
  });
}
