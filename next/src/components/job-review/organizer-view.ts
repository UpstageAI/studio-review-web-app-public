// 구성 탭 "페이지 정리 화면"(문서별 썸네일 격자 + 옆 뷰어)을 열어 둘지와 썸네일 크기의 순수 규칙.
// 브라우저 기억은 `localStorage` 두 키로, 읽기·쓰기는 저장소가 막혀 있어도 던지지 않는다(없으면
// 닫힘·S). URL 에는 반영하지 않는다.
import type { PageGridSize } from "@/components/studio-ui-kit/structure-editor";

/** 열림 여부를 기억하는 키. 값은 `"open"` 또는 `"closed"`. */
export const ORGANIZER_OPEN_KEY = "review-organizer";
/** 썸네일 크기를 기억하는 키. 값은 `"s"` 또는 `"m"`. */
export const ORGANIZER_SIZE_KEY = "review-organizer-size";

export interface OrganizerView {
  open: boolean;
  size: PageGridSize;
}

/** 저장소 값 → 열림 여부. `"open"` 만 열림이고 그 밖(없음·모르는 값)은 닫힘. */
export function parseOrganizerOpen(raw: string | null): boolean {
  return raw === "open";
}

/** 저장소 값 → 썸네일 크기. `"m"` 만 M 이고 그 밖(없음·모르는 값)은 S. */
export function parseOrganizerSize(raw: string | null): PageGridSize {
  return raw === "m" ? "m" : "s";
}

export function readOrganizerView(
  storage: Pick<Storage, "getItem"> | null,
): OrganizerView {
  try {
    return {
      open: parseOrganizerOpen(storage?.getItem(ORGANIZER_OPEN_KEY) ?? null),
      size: parseOrganizerSize(storage?.getItem(ORGANIZER_SIZE_KEY) ?? null),
    };
  } catch {
    return { open: false, size: "s" };
  }
}

export function writeOrganizerOpen(
  storage: Pick<Storage, "setItem"> | null,
  open: boolean,
): void {
  try {
    storage?.setItem(ORGANIZER_OPEN_KEY, open ? "open" : "closed");
  } catch {
    // 저장소가 가득 찼거나 막혀 있으면 기억하지 않는다.
  }
}

export function writeOrganizerSize(
  storage: Pick<Storage, "setItem"> | null,
  size: PageGridSize,
): void {
  try {
    storage?.setItem(ORGANIZER_SIZE_KEY, size);
  } catch {
    // 저장소가 가득 찼거나 막혀 있으면 기억하지 않는다.
  }
}

/**
 * 뷰어 위에 필름스트립 띠를 그릴지. 구성 탭이 아니면 늘 그리고, 구성 탭에서는 띠를 펼쳤고 정리
 * 화면이 닫혀 있을 때만 그린다. 정리 화면이 열린 동안 띠의 펼침 기억값은 건드리지 않는다.
 */
export function showsFilmstripBand(
  mode: string,
  filmstripOpen: boolean,
  organizerOpen: boolean,
): boolean {
  return mode !== "structure" || (filmstripOpen && !organizerOpen);
}

/** 작업 패널 자리에 정리 화면을 그릴지. 구성 탭에서 열어 두었을 때만. */
export function showsOrganizer(mode: string, organizerOpen: boolean): boolean {
  return mode === "structure" && organizerOpen;
}
