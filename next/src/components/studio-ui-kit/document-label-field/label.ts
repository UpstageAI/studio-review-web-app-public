export function normalizeLabel(label: string | null): string | null {
  return label !== null && label.trim() !== "" ? label : null;
}

/**
 * 라벨 입력을 확정할 때 보낼 값. 손대지 않은 입력이거나 앞뒤 공백을 뺀 값이 지금 라벨과 같으면
 * `null`(보내지 않음), 아니면 `{ value }` — 앞뒤 공백을 빼고, 비면 라벨 없음(`null`).
 */
export function labelCommit(
  draft: string,
  label: string | null,
): { value: string | null } | null {
  if (draft === (label ?? "")) return null;
  const trimmed = draft.trim();
  const value = trimmed === "" ? null : trimmed;
  return value === normalizeLabel(label) ? null : { value };
}
