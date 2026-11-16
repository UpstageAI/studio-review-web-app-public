import type { StructureEditorCallbacks } from "./callbacks";
import type { StructureEditorLabels } from "./labels";
import type { StructureDocument } from "./types";

/** 메뉴 항목. `children` 이 있으면 하위 메뉴(비면 `empty` 문구). */
export type StructureMenuItem = {
  id: string;
  label: string;
  disabled?: boolean;
  onSelect?: () => void;
  children?: readonly { id: string; label: string; onSelect: () => void }[];
  empty?: string;
};

/** 페이지를 받을 수 있는 문서와 그 배치 순 위치(0-based). */
export interface StructureTargetDocument {
  index: number;
  document: StructureDocument;
}

/**
 * 문서 메뉴(⋯) 항목: 앞 문서와 합치기·앞으로(앞 문서가 같은 그룹·잠기지 않음)·뒤로(뒤 문서가 같은
 * 그룹·잠기지 않음)·위치 지정…(`onRequestDocumentPosition` 과 문구가 있을 때)·문서 제외 또는 복귀
 * (콜백과 문구가 있을 때). id 는 `merge`·`earlier`·`later`·`position`·`exclude`·`restore`. 항목마다
 * 콜백과 문구가 함께 있을 때만 넣는다(둘 다 넘기면 늘 같은 항목이 나온다).
 */
export function documentMenuItems({
  document,
  index,
  documents,
  labels,
  actions,
}: {
  document: StructureDocument;
  /** 문서 배치 순 위치(0-based). */
  index: number;
  /** 문서 전체(배치 순). 앞·뒤 문서와 같은 그룹인지 보는 데 쓴다. */
  documents: readonly StructureDocument[];
  labels: Partial<
    Pick<
      StructureEditorLabels,
      | "mergeWithPrevious"
      | "moveDocumentEarlier"
      | "moveDocumentLater"
      | "moveDocumentTo"
      | "documentExclusion"
    >
  >;
  actions: Partial<
    Pick<
      StructureEditorCallbacks,
      | "onMergeInto"
      | "onReorderDocument"
      | "onExcludeDocument"
      | "onRestoreDocument"
    >
  > & {
    onRequestDocumentPosition?: (documentId: string, index: number) => void;
  };
}): readonly StructureMenuItem[] {
  const previous = documents[index - 1];
  const next = documents[index + 1];
  const samePrevious =
    previous !== undefined &&
    previous.groupId === document.groupId &&
    !previous.locked;
  const sameNext =
    next !== undefined && next.groupId === document.groupId && !next.locked;
  const id = document.documentId;
  const items: StructureMenuItem[] = [];
  const merge = actions.onMergeInto;
  if (merge && labels.mergeWithPrevious !== undefined) {
    items.push({
      id: "merge",
      label: labels.mergeWithPrevious,
      disabled: !samePrevious,
      onSelect: () => {
        if (previous) merge(id, previous.documentId);
      },
    });
  }
  const reorder = actions.onReorderDocument;
  if (reorder && labels.moveDocumentEarlier !== undefined) {
    items.push({
      id: "earlier",
      label: labels.moveDocumentEarlier,
      disabled: !samePrevious,
      onSelect: () => reorder(id, index - 1),
    });
  }
  if (reorder && labels.moveDocumentLater !== undefined) {
    items.push({
      id: "later",
      label: labels.moveDocumentLater,
      disabled: !sameNext,
      onSelect: () => reorder(id, index + 1),
    });
  }
  const position = actions.onRequestDocumentPosition;
  if (position && labels.moveDocumentTo) {
    items.push({
      id: "position",
      label: labels.moveDocumentTo,
      onSelect: () => position(id, index),
    });
  }
  if (document.excluded) {
    const restore = actions.onRestoreDocument;
    if (restore && labels.documentExclusion) {
      items.push({
        id: "restore",
        label: labels.documentExclusion.restore,
        onSelect: () => restore(id),
      });
    }
  } else {
    const exclude = actions.onExcludeDocument;
    if (exclude && labels.documentExclusion) {
      items.push({
        id: "exclude",
        label: labels.documentExclusion.exclude,
        onSelect: () => exclude(id),
      });
    }
  }
  return items;
}

/**
 * 제외 자리 페이지의 메뉴 항목: 문서로 되돌리기 ▸(`targets` 각 문서의 끝에, 없으면 `noOtherDocument`)·
 * 새 문서로(콜백과 문구가 있을 때). id 는 `restore`·`new-document`. 되돌리기도 `onRestorePage` 와
 * 문구(`restorePage`·`documentOption`·`noOtherDocument`)가 함께 있을 때만 넣는다.
 */
export function excludedPageMenuItems({
  pageKey,
  targets,
  labels,
  actions,
}: {
  pageKey: string;
  /** 같은 그룹에서 페이지를 받을 수 있는(잠기지 않은) 문서, 배치 순. */
  targets: readonly StructureTargetDocument[];
  labels: Partial<
    Pick<
      StructureEditorLabels,
      | "restorePage"
      | "noOtherDocument"
      | "documentOption"
      | "restoreToNewDocument"
    >
  >;
  actions: Partial<
    Pick<StructureEditorCallbacks, "onRestorePage" | "onRestoreToNewDocument">
  >;
}): readonly StructureMenuItem[] {
  const items: StructureMenuItem[] = [];
  const restore = actions.onRestorePage;
  const option = labels.documentOption;
  if (
    restore &&
    option &&
    labels.restorePage !== undefined &&
    labels.noOtherDocument !== undefined
  ) {
    items.push({
      id: "restore",
      label: labels.restorePage,
      empty: labels.noOtherDocument,
      children: targets.map(({ index, document }) => ({
        id: document.documentId,
        label: option(index + 1, document.label),
        onSelect: () =>
          restore(pageKey, document.documentId, document.pages.length),
      })),
    });
  }
  const toNew = actions.onRestoreToNewDocument;
  if (toNew && labels.restoreToNewDocument) {
    items.push({
      id: "new-document",
      label: labels.restoreToNewDocument,
      onSelect: () => toNew(pageKey),
    });
  }
  return items;
}
