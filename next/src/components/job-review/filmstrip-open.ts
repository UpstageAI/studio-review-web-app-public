// 구성 탭 필름스트립(페이지 썸네일 띠)을 펼쳐 둘지의 순수 규칙. 브라우저 기억은 `localStorage` 한 키로,
// 읽기·쓰기는 저장소가 막혀 있어도 던지지 않는다(없으면 null — 호출자가 Job 으로 정한다).

/** 브라우저에 기억하는 키. 값은 `"open"` 또는 `"closed"`. */
export const FILMSTRIP_OPEN_KEY = "review-filmstrip";

/** 저장소 값 → 펼침 여부. `"open"` 은 펼침, `"closed"` 는 접힘, 그 밖(없음·모르는 값)은 기억 없음(null). */
export function parseFilmstripOpen(raw: string | null): boolean | null {
  if (raw === "open") return true;
  if (raw === "closed") return false;
  return null;
}

export function readFilmstripOpen(
  storage: Pick<Storage, "getItem"> | null,
): boolean | null {
  try {
    return parseFilmstripOpen(storage?.getItem(FILMSTRIP_OPEN_KEY) ?? null);
  } catch {
    return null;
  }
}

export function writeFilmstripOpen(
  storage: Pick<Storage, "setItem"> | null,
  open: boolean,
): void {
  try {
    storage?.setItem(FILMSTRIP_OPEN_KEY, open ? "open" : "closed");
  } catch {
    // 저장소가 가득 찼거나 막혀 있으면 기억하지 않는다.
  }
}
