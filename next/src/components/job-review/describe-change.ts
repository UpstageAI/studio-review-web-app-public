import {
  formatPageRanges,
  type ChangeEntry,
  type JsonValue,
  type SourceRange,
} from "@/lib/review-model";
import { displayValue } from "./value-fields";

// 변경 항목(`ChangeEntry.description`) → 트레이 문구 재료. 문구 자체는 host 가 next-intl
// `review.tray.items.<key>` 로 만든다.

export type ChangeTextKey =
  | "setValue"
  | "setValueNoStep"
  | "replaceSubtree"
  | "replaceAll"
  | "insertItem"
  | "removeItem"
  | "moveItem"
  | "setKey"
  | "removeKey"
  | "setLabel"
  | "reorderPages"
  | "reorderDocuments"
  | "split"
  | "merge"
  | "movePages"
  | "excludePages"
  | "restorePages"
  | "restoreToNewDocument"
  | "setPageRanges"
  | "setPageRangesMoved"
  | "addDocument"
  | "addDocumentMoved"
  | "excludeDocument"
  | "restoreDocument"
  | "moveFile"
  | "moveFileNewGroup"
  | "replaceStructure"
  | "replaceStructureChanged"
  | "batchMovePages"
  | "batchExcludePages"
  | "batchNewDocument";

/** 목록으로 이어 붙일 문구 조각. host 가 `review.tray.fragments.<key>` 로 만든다. */
export type ChangeFragmentKey =
  | "movedFrom"
  | "movedFromRemoved"
  | "movedFromExcluded"
  | "structureLabels"
  | "structureRanges"
  | "structureAdded"
  | "structureRemoved"
  | "structureReordered"
  | "structureGroups"
  | "structureLabelChange"
  | "structureDocument";

export type ChangeFragment = {
  key: ChangeFragmentKey;
  values: Record<string, string | number>;
};

export type ChangeText = {
  key: ChangeTextKey;
  values: Record<string, string | number>;
  /**
   * 조각 목록 값. host 가 조각마다 문구를 만들어 locale 의 나열 형식으로 이은 뒤
   * 같은 이름의 값으로 넣는다(예: `moved` → "receipt 문서에서 1쪽").
   */
  lists?: Record<string, readonly ChangeFragment[]>;
};

export type ChangeTextPlaceholders = {
  /** 라벨 없는 문서 */
  untitled: string;
  /** 빈 문자열·값 없음 */
  empty: string;
  /** `null`(값을 비움) */
  nullValue: string;
  /** 값 자리 경로의 배열 위치 조각(1-based) — host 가 `fragments.arrayIndex` 로 만든다. */
  arrayIndex: (index: number) => string;
  /** 파일 표시 이름. 없으면 `file_ref` 그대로. */
  fileName?: (fileRef: string) => string;
};

/** 페이지 범위: 파일마다 "이름 1-3, 5" 를 "; " 로 잇는다. */
function sourcesText(
  sources: readonly SourceRange[] | undefined,
  fallback: JsonValue | undefined,
  placeholders: ChangeTextPlaceholders,
): string {
  if (!sources) return valueText(fallback, placeholders);
  if (sources.length === 0) return placeholders.empty;
  const name = placeholders.fileName ?? ((fileRef: string) => fileRef);
  return sources
    .map(
      source =>
        `${name(source.file_ref)} ${formatPageRanges(source.page_ranges)}`,
    )
    .join("; ");
}

/** 값 표시: 60 자에서 자르고, `null` 과 빈 값은 자리 문구. */
function valueText(
  value: JsonValue | undefined,
  placeholders: ChangeTextPlaceholders,
): string {
  if (value === null) return placeholders.nullValue;
  if (value === undefined || value === "") return placeholders.empty;
  return displayValue(value, 60);
}

/**
 * 값 항목의 필드 이름. 경로에 배열 위치가 있으면 "items › 1번째 › qty" 처럼 단계를 잇고,
 * 없으면 schema 제목(없으면 pointer).
 */
function fieldText(
  description: ChangeEntry["description"],
  placeholders: ChangeTextPlaceholders,
): string {
  if (description.fieldPath) {
    return description.fieldPath
      .map(segment =>
        segment.kind === "index"
          ? placeholders.arrayIndex(segment.index)
          : segment.title,
      )
      .join(" › ");
  }
  return description.fieldTitle || description.pointer || "";
}

/** 값 항목의 대상 이름: "Step › 필드"(빈 쪽은 뺀다). 구분 기호만 쓰므로 번역하지 않는다. */
function targetText(stepName: string | undefined, field: string): string {
  return [stepName, field].filter(part => part).join(" › ");
}

/**
 * 페이지 범위 지정·새 문서가 다른 문서·제외 목록에서 가져온 페이지의 조각. 가져온 것이
 * 없으면 null.
 */
function movedFragments(
  entry: ChangeEntry,
  placeholders: ChangeTextPlaceholders,
): ChangeFragment[] | null {
  const {
    takenFrom = [],
    removedDocuments = [],
    fromExcluded = 0,
  } = entry.description;
  if (takenFrom.length === 0 && fromExcluded === 0) return null;
  const removed = new Set(removedDocuments.map(item => item.documentId));
  const fragments: ChangeFragment[] = takenFrom.map(take => ({
    key: removed.has(take.documentId) ? "movedFromRemoved" : "movedFrom",
    values: {
      document: take.label ?? placeholders.untitled,
      count: take.count,
    },
  }));
  if (fromExcluded > 0) {
    fragments.push({
      key: "movedFromExcluded",
      values: { count: fromExcluded },
    });
  }
  return fragments;
}

/** 구조 교체에서 예로 보일 바뀐 문서 수. 나머지는 "외 n개" 로 센다. */
const STRUCTURE_EXAMPLES = 3;

/** 구조 교체 항목의 문구. 바뀐 수가 모두 0 이면 개수만 적는다. */
function replaceStructureText(
  entry: ChangeEntry,
  placeholders: ChangeTextPlaceholders,
): ChangeText {
  const { description } = entry;
  const count = (key: string) => {
    const value = description.detail?.[key];
    return typeof value === "number" ? value : 0;
  };
  const values = {
    documents: count("documents"),
    excludedDocuments: count("excludedDocuments"),
    excludedPages: count("excludedPages"),
  };
  const counted: [ChangeFragmentKey, string][] = [
    ["structureLabels", "labelChanged"],
    ["structureRanges", "rangesChanged"],
    ["structureAdded", "added"],
    ["structureRemoved", "removed"],
    ["structureReordered", "reordered"],
  ];
  const summary: ChangeFragment[] = counted
    .filter(([, name]) => count(name) > 0)
    .map(([key, name]) => ({ key, values: { count: count(name) } }));
  if (count("groupsChanged") > 0) {
    summary.push({ key: "structureGroups", values: {} });
  }
  if (summary.length === 0) return { key: "replaceStructure", values };
  const changed = description.structureDocuments ?? [];
  const examples: ChangeFragment[] = changed
    .slice(0, STRUCTURE_EXAMPLES)
    .map((change): ChangeFragment =>
      change.labelChanged
        ? {
            key: "structureLabelChange",
            values: {
              before: change.before ?? placeholders.untitled,
              after: change.after ?? placeholders.untitled,
              position: change.position,
            },
          }
        : {
            key: "structureDocument",
            values: {
              document:
                (change.status === "removed" ? change.before : change.after) ??
                placeholders.untitled,
              position: change.position,
            },
          },
    );
  return {
    key: "replaceStructureChanged",
    values: {
      ...values,
      shown: examples.length,
      more: changed.length - examples.length,
    },
    lists: { summary, examples },
  };
}

function pagesText(entry: ChangeEntry): string {
  const pages = entry.description.pages ?? [];
  if (pages.length > 0) return pages.join(", ");
  return String(entry.description.pageRefs?.length ?? 0);
}

/** 항목 하나의 문구 키와 값. */
export function describeEntry(
  entry: ChangeEntry,
  placeholders: ChangeTextPlaceholders,
): ChangeText {
  const { description } = entry;
  const document = description.documentLabel ?? placeholders.untitled;
  const other = description.otherDocumentLabel ?? placeholders.untitled;
  const field = fieldText(description, placeholders);
  const target = targetText(description.stepName, field);
  switch (entry.kind) {
    case "replace_subtree":
      return entry.path.length === 0
        ? {
            key: "replaceAll",
            values: { step: description.stepName ?? entry.resultId },
          }
        : {
            key: "replaceSubtree",
            values: {
              target,
              before: valueText(description.before, placeholders),
              after: valueText(description.after, placeholders),
            },
          };
    case "insert_item":
      return {
        key: "insertItem",
        values: { target, index: description.index ?? entry.index + 1 },
      };
    case "remove_item":
      return {
        key: "removeItem",
        values: {
          target,
          index: description.index ?? entry.index + 1,
          before: valueText(description.before, placeholders),
        },
      };
    case "move_item":
      return {
        key: "moveItem",
        values: {
          target,
          from: description.from ?? entry.from + 1,
          to: description.to ?? entry.to + 1,
        },
      };
    case "set_key":
      return { key: "setKey", values: { target } };
    case "remove_key":
      return {
        key: "removeKey",
        values: { target, before: valueText(description.before, placeholders) },
      };
    case "set_value": {
      const before = valueText(description.before, placeholders);
      const after = valueText(description.after, placeholders);
      // 결과 루트 값(경로 없음, schema 제목 없음)은 Step 이름을 필드 자리에 쓴다.
      if (field === "") {
        return {
          key: "setValueNoStep",
          values: {
            field: description.stepName ?? entry.resultId,
            before,
            after,
          },
        };
      }
      const values = { field, before, after };
      return description.stepName
        ? { key: "setValue", values: { ...values, step: description.stepName } }
        : { key: "setValueNoStep", values };
    }
    case "set_label":
      return {
        key: "setLabel",
        values: {
          before: valueText(description.before, placeholders),
          after: valueText(description.after, placeholders),
        },
      };
    case "reorder_pages":
      return {
        key: "reorderPages",
        values: {
          pages: pagesText(entry),
          to: typeof description.after === "number" ? description.after : 0,
        },
      };
    case "reorder_documents":
      return {
        key: "reorderDocuments",
        values: {
          document,
          before:
            typeof description.before === "number" ? description.before : "?",
          after: typeof description.after === "number" ? description.after : 0,
        },
      };
    case "split_document":
      return { key: "split", values: { document, page: pagesText(entry) } };
    case "merge_documents":
      return { key: "merge", values: { document, other } };
    case "move_pages":
      // 같은 문서 안에서 모은 페이지(끌어 놓기)는 자리 이동으로 읽는다. 자리는 뺀 뒤 기준 1-based.
      return "documentId" in entry.to &&
        entry.to.documentId === entry.fromDocumentId
        ? {
            key: "reorderPages",
            values: { pages: pagesText(entry), to: entry.to.index + 1 },
          }
        : { key: "movePages", values: { pages: pagesText(entry), other } };
    case "exclude_pages":
      return { key: "excludePages", values: { pages: pagesText(entry) } };
    case "restore_pages":
      return "documentId" in entry.to
        ? {
            key: "restorePages",
            values: { count: entry.pages.length, document },
          }
        : {
            key: "restoreToNewDocument",
            values: { count: entry.pages.length },
          };
    case "set_page_ranges": {
      const moved = movedFragments(entry, placeholders);
      return {
        key: moved ? "setPageRangesMoved" : "setPageRanges",
        ...(moved ? { lists: { moved } } : {}),
        values: {
          before: sourcesText(
            description.beforeSourceFiles,
            description.before,
            placeholders,
          ),
          after: sourcesText(
            description.sourceFiles,
            description.after,
            placeholders,
          ),
        },
      };
    }
    case "add_document": {
      const moved = movedFragments(entry, placeholders);
      return {
        key: moved ? "addDocumentMoved" : "addDocument",
        ...(moved ? { lists: { moved } } : {}),
        values: {
          document,
          ranges: sourcesText(
            description.sourceFiles,
            description.after,
            placeholders,
          ),
        },
      };
    }
    case "exclude_document":
      return { key: "excludeDocument", values: { document } };
    case "restore_document":
      return { key: "restoreDocument", values: { document } };
    case "move_file": {
      const name = placeholders.fileName ?? ((fileRef: string) => fileRef);
      const file = name(entry.fileRef);
      const group = description.detail?.group;
      return "groupId" in entry.to
        ? {
            key: "moveFile",
            values: { file, group: typeof group === "number" ? group : "?" },
          }
        : { key: "moveFileNewGroup", values: { file } };
    }
    case "replace_structure":
      return replaceStructureText(entry, placeholders);
    default: {
      const unreachable: never = entry;
      return unreachable;
    }
  }
}

/**
 * 일괄 편집 묶음(같은 `batchId` 의 항목들) 하나의 문구 키와 값. 전부 제외면 `batchExcludePages`,
 * 첫 항목이 새 문서를 만들면 `batchNewDocument`, 그 밖은 `batchMovePages`. `count` 는 모든 항목의
 * 페이지 수 합, `documents` 는 항목(원본 문서) 수, `sources` 는 원본마다 "라벨 페이지" 를 "; " 로
 * 이은 것, `other` 는 첫 항목의 상대 문서(옮긴 대상, 새 문서면 첫 원본) 라벨.
 */
export function describeBatch(
  entries: readonly ChangeEntry[],
  placeholders: ChangeTextPlaceholders,
): ChangeText {
  const first = entries[0];
  let count = 0;
  for (const entry of entries) {
    if (entry.kind === "move_pages" || entry.kind === "exclude_pages") {
      count += entry.pages.length;
    }
  }
  const sources = entries
    .map(
      entry =>
        `${entry.description.documentLabel ?? placeholders.untitled} ${pagesText(entry)}`,
    )
    .join("; ");
  const base = { count, documents: entries.length, sources };
  if (entries.every(entry => entry.kind === "exclude_pages")) {
    return { key: "batchExcludePages", values: base };
  }
  const values = {
    ...base,
    other: first?.description.otherDocumentLabel ?? placeholders.untitled,
  };
  if (first?.kind === "move_pages" && "newDocumentId" in first.to) {
    return { key: "batchNewDocument", values };
  }
  return { key: "batchMovePages", values };
}

/** 트레이 항목의 출처 줄 문구 키와 값(`review.tray.<key>`). 이력에서 불러온 항목이 아니면 `null`. */
export type OriginNote =
  | { key: "origin.revision"; values: { version: number } }
  | { key: "origin.original" };

export function originNoteOf(entry: ChangeEntry): OriginNote | null {
  const origin =
    entry.kind === "replace_subtree" || entry.kind === "replace_structure"
      ? entry.origin
      : undefined;
  if (!origin) return null;
  return origin.kind === "original"
    ? { key: "origin.original" }
    : { key: "origin.revision", values: { version: origin.version } };
}

/** 트레이의 한 줄: 항목 하나, 또는 일괄 편집 묶음 하나(항목 2 개 이상). */
export type ChangeUnit =
  | { kind: "entry"; entry: ChangeEntry }
  | { kind: "batch"; batchId: string; entries: ChangeEntry[] };

export type ChangeGroup = {
  /** 주 대상 문서 id(없으면 빈 문자열). */
  documentId: string;
  documentLabel: string | null;
  units: ChangeUnit[];
};

function batchIdOf(entry: ChangeEntry): string | undefined {
  return entry.kind === "move_pages" || entry.kind === "exclude_pages"
    ? entry.batchId
    : undefined;
}

/**
 * 항목을 주 대상 문서별로 묶는다(처음 나온 순서 유지). 같은 `batchId` 의 항목은 처음 나온 항목의
 * 문서 묶음 안에서 한 줄(batch unit)이 되고, 항목이 하나뿐인 묶음은 보통 항목과 같게 보인다.
 */
export function groupEntries(entries: readonly ChangeEntry[]): ChangeGroup[] {
  const groups: ChangeGroup[] = [];
  const byId = new Map<string, ChangeGroup>();
  const batches = new Map<string, Extract<ChangeUnit, { kind: "batch" }>>();
  for (const entry of entries) {
    const batchId = batchIdOf(entry);
    const batch = batchId === undefined ? undefined : batches.get(batchId);
    if (batch) {
      batch.entries.push(entry);
      continue;
    }
    const documentId = entry.description.documentIds[0] ?? "";
    let group = byId.get(documentId);
    if (!group) {
      group = {
        documentId,
        documentLabel: entry.description.documentLabel,
        units: [],
      };
      byId.set(documentId, group);
      groups.push(group);
    }
    if (batchId === undefined) {
      group.units.push({ kind: "entry", entry });
    } else {
      const unit = { kind: "batch" as const, batchId, entries: [entry] };
      batches.set(batchId, unit);
      group.units.push(unit);
    }
  }
  for (const group of groups) {
    group.units = group.units.map(unit =>
      unit.kind === "batch" && unit.entries.length === 1
        ? { kind: "entry", entry: unit.entries[0]! }
        : unit,
    );
  }
  return groups;
}
