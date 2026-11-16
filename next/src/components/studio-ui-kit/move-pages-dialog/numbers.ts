export function parsePositiveInt(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= 1 && Number.isSafeInteger(value) ? value : null;
}

/** `from‥to`(1-based, 양끝 포함)가 `pageCount` 장 안의 올바른 범위인지. 정수 아님·역순·경계 밖은 `false`. */
export function isRangeWithin(
  pageCount: number,
  from: number,
  to: number,
): boolean {
  if (!Number.isInteger(from) || !Number.isInteger(to)) return false;
  return from >= 1 && to <= pageCount && from <= to;
}
