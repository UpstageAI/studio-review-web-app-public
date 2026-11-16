// 값 패널이 큰 배열을 묶음 단위로 늘려 그릴 때의 순수 계산. 어느 항목까지 보여야 하는지(선택·오류
// pointer 가 가리키는 항목 — 오류는 첫 항목)와 그에 맞춘 한도를 구한다.

export { ARRAY_BATCH } from "./large-job";

const INDEX_TOKEN = /^(0|[1-9]\d*)$/;

/**
 * `pointer` 가 배열 `parentPointer` 의 항목(또는 그 아래)이면 그 항목 index, 아니면 `null`.
 * 루트 배열은 `""`. 토큰은 RFC 6901 이스케이프라 `/` 로만 나눈다.
 */
export function itemIndexUnder(
  parentPointer: string,
  pointer: string | null,
): number | null {
  if (pointer === null) return null;
  const prefix = `${parentPointer}/`;
  if (!pointer.startsWith(prefix)) return null;
  const rest = pointer.slice(prefix.length);
  const end = rest.indexOf("/");
  const token = end === -1 ? rest : rest.slice(0, end);
  return INDEX_TOKEN.test(token) ? Number(token) : null;
}

/**
 * 지금 한도 `current` 로 `needed`(0-based 위치, `null` 이면 없음)가 안 보이면 `batch` 단위로 늘린 한도.
 * 보이면 그대로.
 */
export function batchLimitFor(
  current: number,
  needed: number | null,
  batch: number,
): number {
  if (needed === null || needed < current) return current;
  const step = Math.max(1, batch);
  return current + Math.ceil((needed + 1 - current) / step) * step;
}

/**
 * `pointers` 중 배열 `parentPointer` 의 항목(또는 그 아래)을 가리키는 것 가운데 항목 index 가 가장
 * 작은 것(같으면 앞 것). 없으면 `null`. 오류가 여럿이어도 첫 오류 항목까지만 펼치는 데 쓴다.
 */
export function firstItemUnder(
  parentPointer: string,
  pointers: readonly string[],
): { index: number; pointer: string } | null {
  let best: { index: number; pointer: string } | null = null;
  for (const pointer of pointers) {
    const index = itemIndexUnder(parentPointer, pointer);
    if (index !== null && (best === null || index < best.index)) {
      best = { index, pointer };
    }
  }
  return best;
}

/**
 * 배열 `pointer` 를 자동으로 펼칠 이유를 나타내는 key. 그 배열 항목(또는 그 아래)을 가리키는 선택
 * pointer 와 첫 오류 pointer(`firstItemUnder`)를 이어 붙이고, 둘 다 배열 밖이면 `null`. 같은 이유면
 * 같은 key, 선택·첫 오류 pointer 가 바뀌면(같은 항목의 다른 필드라도) 다른 key 다.
 */
export function autoOpenKey(
  pointer: string,
  selectedPointer: string | null,
  errorPointers: readonly string[],
): string | null {
  const selected =
    itemIndexUnder(pointer, selectedPointer) === null ? null : selectedPointer;
  const error = firstItemUnder(pointer, errorPointers)?.pointer ?? null;
  if (selected === null && error === null) return null;
  return `${selected ?? ""}\u0000${error ?? ""}`;
}

/**
 * 직전에 자동으로 펼친 이유 `previousKey` 뒤에 지금 이유 `key` 로 다시 펼칠지. 새로 필요해졌거나
 * 이유가 바뀐 때만 참이라, 같은 이유로 펼친 묶음을 사용자가 접으면 접힌 채 남는다.
 */
export function shouldAutoOpen(
  previousKey: string | null,
  key: string | null,
): boolean {
  return key !== null && key !== previousKey;
}
