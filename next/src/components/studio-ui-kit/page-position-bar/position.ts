export type PageMarkKind = "changed" | "issue" | "noImage";

export interface PageMark {
  /** 뷰어 위치(0-based). */
  index: number;
  kind: PageMarkKind;
}

/** 같은 종류의 연속 구간(양끝 포함, 0-based). */
export interface MarkSegment {
  kind: PageMarkKind;
  start: number;
  end: number;
}

/** 그리는 순서: 이미지 없음 → 검증 문제 → 바뀐 값(가장 위). */
export const MARK_KINDS: readonly PageMarkKind[] = [
  "noImage",
  "issue",
  "changed",
];

/** 키보드 한 번에 건너뛰는 기본 페이지 수(PageUp·PageDown). */
export const DEFAULT_PAGE_STEP = 10;

/** `[0, count - 1]` 로 자른다. 페이지가 없거나 숫자가 아니면 0. */
export function clampIndex(index: number, count: number): number {
  if (!Number.isFinite(index) || count <= 0) return 0;
  return Math.min(Math.max(Math.trunc(index), 0), count - 1);
}

/** 숫자 입력(1-based) → 뷰어 위치. 공백은 무시하고, 정수가 아니거나 범위 밖이면 `null`. */
export function parsePageInput(text: string, count: number): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const page = Number(trimmed);
  if (!Number.isSafeInteger(page) || page < 1 || page > count) return null;
  return page - 1;
}

/**
 * 뷰어 위치 → 트랙 위 비율(0..1). 트랙을 페이지 수만큼 칸으로 나눠 그 칸의 가운데를 돌려준다
 * (표식 칸과 같은 눈금). 페이지가 없으면 0.
 */
export function ratioOfIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return (clampIndex(index, count) + 0.5) / count;
}

/** 트랙 위 비율(0..1) → 뷰어 위치. 비율이 범위를 벗어나면 양끝으로 자른다. */
export function indexAtRatio(ratio: number, count: number): number {
  if (count <= 0 || !Number.isFinite(ratio)) return 0;
  const clamped = Math.min(Math.max(ratio, 0), 1);
  return clampIndex(Math.floor(clamped * count), count);
}

/**
 * 키보드 이동. 화살표는 한 쪽(오른쪽·아래 = 다음), PageUp·PageDown 은 `pageStep` 쪽, Home·End 는
 * 양끝. 모르는 키는 `null`(호출한 쪽이 기본 동작을 막지 않도록). 범위 밖이면 양끝으로 자른다.
 */
export function stepIndex(
  index: number,
  count: number,
  key: string,
  pageStep: number = DEFAULT_PAGE_STEP,
): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return clampIndex(index + 1, count);
    case "ArrowLeft":
    case "ArrowUp":
      return clampIndex(index - 1, count);
    case "PageDown":
      return clampIndex(index + pageStep, count);
    case "PageUp":
      return clampIndex(index - pageStep, count);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/**
 * 표식을 종류별로 모아 연속 위치를 한 구간으로 합친다(200 쪽 모두 이미지 없음 → 구간 1 개).
 * 범위 밖·정수 아닌 위치는 버리고, 결과는 `MARK_KINDS` 순 → 위치 순이다.
 */
export function mergeMarks(
  marks: readonly PageMark[],
  count: number,
): MarkSegment[] {
  const out: MarkSegment[] = [];
  for (const kind of MARK_KINDS) {
    const indexes = [
      ...new Set(
        marks
          .filter(
            mark =>
              mark.kind === kind &&
              Number.isInteger(mark.index) &&
              mark.index >= 0 &&
              mark.index < count,
          )
          .map(mark => mark.index),
      ),
    ].sort((a, b) => a - b);
    let current: MarkSegment | null = null;
    for (const index of indexes) {
      if (current && index === current.end + 1) {
        current.end = index;
      } else {
        current = { kind, start: index, end: index };
        out.push(current);
      }
    }
  }
  return out;
}
