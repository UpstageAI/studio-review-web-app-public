// 검수자가 이 Job 에서 열어 본 문서(문서 목록 키)를 브라우저에 기억하는 규칙(순수). Job 마다
// `localStorage` 한 키에 JSON 문자열 배열로 두고, 읽기, 쓰기는 저장소가 막혀 있어도 던지지 않는다
// (없으면 열어 본 문서 없음).

const KEY_PREFIX = "review-visited";

/** 한 Job 에 기억하는 문서 수 상한. 넘으면 오래 전에 연 것부터 버린다. */
export const VISITED_MAX = 2000;

export function visitedStorageKey(collectionId: string, jobId: string): string {
  return `${KEY_PREFIX}:${collectionId}:${jobId}`;
}

/** 저장소 값 → 열어 본 문서 키(연 순서). 없음, 깨진 JSON, 모르는 모양은 빈 목록. */
export function parseVisited(raw: string | null): string[] {
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out = new Set<string>();
  for (const item of parsed) {
    if (typeof item === "string" && item !== "") out.add(item);
  }
  return [...out];
}

/** 열어 본 문서 키(연 순서) → 저장소 값. 상한을 넘으면 뒤(최근)의 `VISITED_MAX` 개만 남긴다. */
export function serializeVisited(keys: readonly string[]): string {
  const unique = [...new Set(keys)];
  return JSON.stringify(
    unique.length > VISITED_MAX ? unique.slice(-VISITED_MAX) : unique,
  );
}

/** 목록 끝에 키를 더한 새 목록. 이미 있으면 같은 목록을 그대로 돌려준다. */
export function withVisited(
  keys: readonly string[],
  key: string,
): readonly string[] {
  return keys.includes(key) ? keys : [...keys, key];
}

export function readVisited(
  storage: Pick<Storage, "getItem"> | null,
  key: string,
): string[] {
  try {
    return parseVisited(storage?.getItem(key) ?? null);
  } catch {
    return [];
  }
}

export function writeVisited(
  storage: Pick<Storage, "setItem"> | null,
  key: string,
  keys: readonly string[],
): void {
  if (keys.length === 0) return;
  try {
    storage?.setItem(key, serializeVisited(keys));
  } catch {
    // 저장소가 가득 찼거나 막혀 있으면 기억하지 않는다(이번 화면에서는 그대로 보인다).
  }
}
