// 값 패널 표시 토글(설명 보기 · 규칙 보기)의 순수 규칙. 브라우저 기억은 `localStorage` 한 키에
// JSON 으로 두고, 읽기·쓰기는 저장소가 막혀 있어도 던지지 않는다(없으면 둘 다 꺼짐).

export type ValueDisplay = {
  /** 값 행 아래에 schema 설명(description)을 보인다. */
  readonly description: boolean;
  /** Validate 판정 아래에 Config 규칙(조건)을 보인다. 원본 판정 근거는 이와 무관하게 늘 보인다. */
  readonly rules: boolean;
};

/** 브라우저에 기억하는 키. 값은 `{"description":boolean,"rules":boolean}` JSON. */
export const VALUE_DISPLAY_KEY = "review-value-display";

export const DEFAULT_VALUE_DISPLAY: ValueDisplay = Object.freeze({
  description: false,
  rules: false,
});

/** 저장소 값 → 표시 토글. 없음·깨진 JSON·모르는 모양은 둘 다 꺼짐. 둘 다 꺼진 값은 공유 상수로 돌려준다. */
export function parseValueDisplay(raw: string | null): ValueDisplay {
  if (raw === null) return DEFAULT_VALUE_DISPLAY;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_VALUE_DISPLAY;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return DEFAULT_VALUE_DISPLAY;
  }
  const record = parsed as Record<string, unknown>;
  const display: ValueDisplay = {
    description: record.description === true,
    rules: record.rules === true,
  };
  return display.description || display.rules ? display : DEFAULT_VALUE_DISPLAY;
}

export function readValueDisplay(
  storage: Pick<Storage, "getItem"> | null,
): ValueDisplay {
  try {
    return parseValueDisplay(storage?.getItem(VALUE_DISPLAY_KEY) ?? null);
  } catch {
    return DEFAULT_VALUE_DISPLAY;
  }
}

export function writeValueDisplay(
  storage: Pick<Storage, "setItem"> | null,
  display: ValueDisplay,
): void {
  try {
    storage?.setItem(
      VALUE_DISPLAY_KEY,
      JSON.stringify({
        description: display.description,
        rules: display.rules,
      }),
    );
  } catch {
    // 저장소가 가득 찼거나 막혀 있으면 기억하지 않는다.
  }
}
