import {
  ExactNumber,
  LOCKED_RESULT_STATES,
  canEditResult,
  contentLeaves,
  isIntegerNumber,
  isJsonObject,
  isValueEntry,
  jsonEquals,
  nodeAt,
  stringifyJson,
  toPointer,
  valueLockReason,
  type ChangeEntry,
  type DocumentChange,
  type JsonPath,
  type JsonValue,
  type Result,
  type ValueLockReason,
} from "@/lib/review-model";

// 래퍼 판정은 모델(변경 설명)도 쓰므로 모델에 두고, 기존 호출처를 위해 여기서도 내보낸다.
export {
  isHiddenWrapper,
  isSingleWrapped,
  schemaPath,
} from "@/lib/review-model";

/** `content` 안 `path` 의 값. 없으면 `undefined`. 모델 `nodeAt` 과 같은 함수다. */
export const valueAt = nodeAt;

// 값 모드 패널이 쓰는 함수. React·문구 없이 결과·경로·입력 문자열(과 포커스 이동)만 다룬다.

/**
 * 원본과 다른 leaf 의 pointer 집합. 원본에 없던 leaf(새 항목·필드)도 들어간다. 원본이 없으면 전부.
 * 행의 "바뀜" 표시(`valueAt` 원본과 `jsonEquals` 비교)와 같은 정의다.
 */
export function changedLeafPointers(
  content: JsonValue,
  baseContent: JsonValue | undefined,
): Set<string> {
  const out = new Set<string>();
  for (const leaf of contentLeaves(content)) {
    const base =
      baseContent === undefined ? undefined : valueAt(baseContent, leaf.path);
    if (!jsonEquals(base, leaf.value)) out.add(toPointer(leaf.path));
  }
  return out;
}

/**
 * 원본과 다른 컨테이너(객체·배열)의 pointer 집합. 루트(`""`)는 넣지 않는다. 항목을 모두 지운 배열이나
 * 빈 객체에 채운 키처럼 leaf 로는 드러나지 않는 변화도 잡는다. 원본이 없으면 전부.
 */
export function changedContainerPointers(
  content: JsonValue,
  baseContent: JsonValue | undefined,
): Set<string> {
  const out = new Set<string>();
  const walk = (value: JsonValue, path: string[]) => {
    const children: [string, JsonValue][] | null = Array.isArray(value)
      ? value.map((item, index) => [String(index), item])
      : isJsonObject(value)
        ? Object.entries(value)
        : null;
    if (children === null) return;
    const base =
      baseContent === undefined ? undefined : valueAt(baseContent, path);
    // 같으면 그 아래도 모두 같다.
    if (jsonEquals(base, value)) return;
    if (path.length > 0) out.add(toPointer(path));
    for (const [key, child] of children) walk(child, [...path, key]);
  };
  walk(content, []);
  return out;
}

/** 빈 값: `null`, 빈 문자열, 공백만 있는 문자열. 숫자, 불리언은 비어 있지 않다. */
export function isEmptyValue(value: JsonValue | undefined): boolean {
  return value === null || (typeof value === "string" && value.trim() === "");
}

/** 빈 leaf(`isEmptyValue`)의 pointer 집합. "빈 값만" 필터가 쓴다. */
export function emptyLeafPointers(content: JsonValue): Set<string> {
  const out = new Set<string>();
  for (const leaf of contentLeaves(content)) {
    if (isEmptyValue(leaf.value)) out.add(toPointer(leaf.path));
  }
  return out;
}

/**
 * 빈 컨테이너(항목이 없는 배열, 키가 없는 객체)의 pointer 집합. 루트(`""`)는 넣지 않는다. leaf 가
 * 없어 `emptyLeafPointers` 로는 드러나지 않는 "값이 하나도 없는 목록" 을 "빈 값만" 에서 보이게 한다.
 */
export function emptyContainerPointers(content: JsonValue): Set<string> {
  const out = new Set<string>();
  const walk = (value: JsonValue, path: string[]) => {
    const children: [string, JsonValue][] | null = Array.isArray(value)
      ? value.map((item, index) => [String(index), item])
      : isJsonObject(value)
        ? Object.entries(value)
        : null;
    if (children === null) return;
    if (children.length === 0 && path.length > 0) out.add(toPointer(path));
    for (const [key, child] of children) walk(child, [...path, key]);
  };
  walk(content, []);
  return out;
}

/**
 * 배열 항목 `at` 에 `template` 을 넣었을 때 그 항목의 첫 leaf pointer. leaf 가 없으면(빈 객체·배열)
 * 항목 pointer.
 */
export function firstLeafPointer(at: JsonPath, template: JsonValue): string {
  const leaf = contentLeaves(template)[0];
  return toPointer(leaf ? [...at, ...leaf.path] : at);
}

/** 값 표시 문자열. 문자열은 그대로, 나머지는 JSON 표기(숫자 원문 보존). 길면 자른다. */
export function displayValue(value: JsonValue | undefined, max = 60): string {
  if (value === undefined) return "";
  const text = typeof value === "string" ? value : stringifyJson(value);
  // 수 MiB 문자열 전체를 코드 포인트로 나누지 않도록 앞부분만 본다(코드 포인트는 UTF-16 2 개 이하).
  const chars = Array.from(text.slice(0, max * 2 + 2));
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : text;
}

/**
 * 한 필드(결과·경로)의 값을 바꾼 항목 id(`set_value`·`replace_subtree`). 행 되돌리기는 이것만
 * 뺀다. 그 행을 만든 배열 항목·키 추가는 넣지 않는다(항목 메뉴나 트레이에서 되돌린다).
 */
export function fieldEntryIds(
  entries: readonly ChangeEntry[],
  resultId: string,
  path: JsonPath,
): string[] {
  const pointer = toPointer(path);
  return entries
    .filter(
      entry =>
        isValueEntry(entry) &&
        (entry.kind === "set_value" || entry.kind === "replace_subtree") &&
        entry.resultId === resultId &&
        toPointer(entry.path) === pointer,
    )
    .map(entry => entry.id);
}

const NUMBER_TOKEN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

export type CoerceResult =
  | { ok: true; value: number | ExactNumber }
  | { ok: false; reason: "invalid_number" | "not_integer" };

/**
 * 숫자 입력 문자열 → JSON 숫자. JS `Number` 로 왕복되는 표기는 `number`, 아니면(큰 정수·
 * 고정밀 소수·지수) 원문을 지키는 `ExactNumber`. 정수 schema 면 소수부가 있는 값을 거부한다.
 */
export function coerceNumber(text: string, integer: boolean): CoerceResult {
  const raw = text.trim();
  if (!NUMBER_TOKEN.test(raw)) return { ok: false, reason: "invalid_number" };
  const parsed = Number(raw);
  const value =
    Number.isFinite(parsed) && String(parsed) === raw
      ? parsed
      : new ExactNumber(raw);
  if (integer && !isIntegerNumber(value)) {
    return { ok: false, reason: "not_integer" };
  }
  return { ok: true, value };
}

/**
 * 값 입력을 막는 이유. 서버가 편집 가능 상태 목록(`editable_states`)을 주면 그것으로 상태를
 * 판단하고, 아니면 모델 기본(`present`·`stale`). 연결 문서의 페이지 집합이 바뀌었으면
 * `structure_changed`.
 */
export function lockReasonFor(
  result: Result,
  changes: readonly DocumentChange[],
  editableStates?: readonly string[] | null,
): ValueLockReason | null {
  if (editableStates && editableStates.length > 0) {
    if (!editableStates.includes(result.state)) {
      return (
        LOCKED_RESULT_STATES.find(reason => reason === result.state) ??
        "unsupported_state"
      );
    }
    // 상태는 통과했으니 구조 변화만 본다.
    return valueLockReason(
      canEditResult(result) ? result : { ...result, state: "present" },
      changes,
    );
  }
  return valueLockReason(result, changes);
}

/** 텍스트 안 위치(UTF-16) → 1-based 줄·열. */
export function lineColumn(
  text: string,
  offset: number,
): { line: number; column: number } {
  let line = 1;
  let column = 1;
  const end = Math.min(Math.max(offset, 0), text.length);
  for (let i = 0; i < end; i++) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
      column = 1;
    } else column += 1;
  }
  return { line, column };
}

/** 값 패널 안 다음 입력으로 포커스를 옮긴다(Enter 로 커밋한 뒤). */
export function focusNextField(from: HTMLElement): void {
  const panel = from.closest("[data-value-panel]");
  if (!panel) return;
  const fields = [
    ...panel.querySelectorAll<HTMLElement>("[data-field-input]"),
  ].filter(field => !field.hasAttribute("disabled") && field.tabIndex !== -1);
  const index = fields.findIndex(
    field => field === from || field.contains(from),
  );
  fields[index + 1]?.focus();
}
