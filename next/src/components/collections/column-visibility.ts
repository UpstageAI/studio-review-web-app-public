// Collection 목록에서 숨길 수 있는 열과 숨김 선택의 저장 형식. 선택은 사용자 선호라 브라우저 저장소에 둔다.

/** 숨길 수 있는 열(메뉴 순서). 이름 열은 항상 보인다. */
export const HIDEABLE_COLUMNS = [
  "source",
  "workflow",
  "jobs",
  "review",
  "updated",
  "lastResult",
] as const;

export type HideableColumn = (typeof HIDEABLE_COLUMNS)[number];
export type ListColumn = "name" | HideableColumn;

/** 저장된 선택이 없을 때 숨기는 열. */
export const DEFAULT_HIDDEN: readonly HideableColumn[] = [
  "workflow",
  "lastResult",
];

export const COLUMNS_STORAGE_KEY = "collections-list-hidden-columns";

/** 저장소 접근에 필요한 최소 모양(`localStorage` 와 호환). */
export type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function isHideableColumn(value: unknown): value is HideableColumn {
  return (
    typeof value === "string" &&
    (HIDEABLE_COLUMNS as readonly string[]).includes(value)
  );
}

function defaultHidden(): ReadonlySet<HideableColumn> {
  return new Set(DEFAULT_HIDDEN);
}

/**
 * 숨긴 열 이름의 JSON 배열을 읽는다. 값이 없거나 JSON 배열이 아니면 기본값, 모르는 이름은 버린다.
 * 빈 배열은 "모두 보임" 이라는 선택이므로 그대로 빈 집합이다.
 */
export function parseHiddenColumns(
  raw: string | null,
): ReadonlySet<HideableColumn> {
  if (raw === null) return defaultHidden();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return defaultHidden();
  }
  if (!Array.isArray(value)) return defaultHidden();
  return new Set(value.filter(isHideableColumn));
}

/** 숨긴 열을 메뉴 순서의 JSON 배열 문자열로 만든다. */
export function serializeHiddenColumns(
  hidden: ReadonlySet<HideableColumn>,
): string {
  return JSON.stringify(HIDEABLE_COLUMNS.filter(column => hidden.has(column)));
}

/** 저장소에서 숨긴 열을 읽는다. 저장소가 없거나 읽지 못하면 기본값. */
export function readHiddenColumns(
  storage: StorageLike | null,
): ReadonlySet<HideableColumn> {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(COLUMNS_STORAGE_KEY) ?? null;
  } catch {
    raw = null;
  }
  return parseHiddenColumns(raw);
}

/** 숨긴 열을 저장소에 쓴다. 저장소가 없거나 막혀 있으면 기억하지 않는다. */
export function writeHiddenColumns(
  storage: StorageLike | null,
  hidden: ReadonlySet<HideableColumn>,
): void {
  try {
    storage?.setItem(COLUMNS_STORAGE_KEY, serializeHiddenColumns(hidden));
  } catch {
    // 저장소가 가득 찼거나 막혀 있으면 이번 선택만 화면에 남는다.
  }
}

/** `column` 의 숨김 여부를 뒤집은 새 집합. */
export function toggleHiddenColumn(
  hidden: ReadonlySet<HideableColumn>,
  column: HideableColumn,
): ReadonlySet<HideableColumn> {
  const next = new Set(hidden);
  if (next.has(column)) next.delete(column);
  else next.add(column);
  return next;
}
