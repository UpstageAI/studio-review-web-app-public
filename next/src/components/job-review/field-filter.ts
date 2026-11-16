// 값 패널 "필드" 고르기의 순수 규칙. 검수자가 맡은 필드만 보이도록 Step 결과의 맨 위 필드 중 일부를
// 고른다. 고른 값은 `localStorage` 한 키에 Step 별로 두고(`{ [stepId]: 보이는 키[] }`), 항목이 없으면
// 모든 필드가 보인다. 읽기는 저장소 값이 깨져 있어도 던지지 않는다(없으면 모두 보임).

import {
  fromPointer,
  isHiddenWrapper,
  isJsonObject,
  schemaAt,
  toPointer,
  type ContentLeaf,
  type JsonObject,
  type JsonPath,
  type JsonValue,
  type Result,
  type ReviewStep,
  type SchemaNode,
} from "@/lib/review-model";

/** 브라우저에 기억하는 키. 값은 `{ [stepId]: string[] }` JSON(배열은 보이는 맨 위 필드 키). */
export const REVIEW_FIELDS_KEY = "review-fields";

/** Step id → 보이는 맨 위 필드 키. Step 이 없으면 그 Step 의 필드는 모두 보인다. */
export type FieldChoices = Readonly<Record<string, readonly string[]>>;

export const NO_FIELD_CHOICES: FieldChoices = Object.freeze({});

/** 프로토타입이 없는 빈 기록(저장소에서 읽은 Step id 가 `__proto__` 여도 그대로 키가 된다). */
function emptyRecord(): Record<string, readonly string[]> {
  return Object.create(null) as Record<string, readonly string[]>;
}

/**
 * 저장소 값 → Step 별 보이는 키. 없음, 깨진 JSON, 객체가 아닌 값은 고른 것 없음. 배열이 아닌 Step 값은
 * 버리고, 배열 안의 문자열이 아닌 값과 중복은 뺀다.
 */
export function parseFieldChoices(raw: string | null): FieldChoices {
  if (raw === null) return NO_FIELD_CHOICES;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NO_FIELD_CHOICES;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NO_FIELD_CHOICES;
  }
  const out = emptyRecord();
  let count = 0;
  for (const [stepId, value] of Object.entries(parsed)) {
    if (!Array.isArray(value)) continue;
    out[stepId] = [
      ...new Set(
        value.filter((key: unknown): key is string => typeof key === "string"),
      ),
    ];
    count += 1;
  }
  return count > 0 ? out : NO_FIELD_CHOICES;
}

/** Step 하나의 보이는 키를 바꾼 새 값. `visible` 이 `null` 이면 그 Step 을 지운다(모두 보임). */
export function withStepFields(
  choices: FieldChoices,
  stepId: string,
  visible: readonly string[] | null,
): FieldChoices {
  const out = emptyRecord();
  for (const [id, keys] of Object.entries(choices)) {
    if (id !== stepId) out[id] = keys;
  }
  if (visible !== null) out[stepId] = [...visible];
  return out;
}

/** Step 이 있는지 보고 그 보이는 키를 꺼낸다. */
export function savedFieldsFor(
  choices: FieldChoices,
  stepId: string,
): readonly string[] | undefined {
  return Object.hasOwn(choices, stepId) ? choices[stepId] : undefined;
}

/** 결과 값의 맨 위 객체(항목 하나짜리 배열 래퍼는 벗긴다). 객체가 아니면 `null`. */
function topObject(
  schema: SchemaNode | null,
  content: JsonValue,
): JsonObject | null {
  const value =
    Array.isArray(content) && isHiddenWrapper(schema, content)
      ? (content[0] ?? null)
      : content;
  return isJsonObject(value) ? value : null;
}

/**
 * Step 결과의 맨 위 필드 키: schema 루트 `properties` 순서, 그 뒤에 schema 에 없지만 결과에 있는 키
 * (처음 나온 순서). 맨 위가 객체인 결과가 하나도 없으면(Validate 판정, 루트 배열 등) 빈 배열.
 */
export function stepFieldKeys(
  schema: SchemaNode | null | undefined,
  contents: Iterable<JsonValue>,
): string[] {
  const root = schema ?? null;
  const contentKeys = new Set<string>();
  let objects = 0;
  for (const content of contents) {
    const top = topObject(root, content);
    if (!top) continue;
    objects += 1;
    for (const key of Object.keys(top)) contentKeys.add(key);
  }
  if (objects === 0) return [];
  const properties = schemaAt(root, [])?.node.properties;
  const schemaKeys = isJsonObject(properties) ? Object.keys(properties) : [];
  return [...new Set([...schemaKeys, ...contentKeys])];
}

/**
 * 저장된 키 → 지금 보일 키(`available` 순서). 저장이 없거나, 남은 키가 없거나(없어진 키만 남아 모든
 * 필드를 숨기게 되는 경우), 모든 필드가 남으면 `null`(모두 보임).
 */
export function visibleFieldList(
  available: readonly string[],
  saved: readonly string[] | undefined,
): string[] | null {
  if (saved === undefined) return null;
  const wanted = new Set(saved);
  const visible = available.filter(key => wanted.has(key));
  return visible.length === 0 || visible.length === available.length
    ? null
    : visible;
}

/**
 * 필드 하나를 켜거나 끈 뒤 저장할 보이는 키(`available` 순서). 모두 보이게 되면 `null`. 마지막 남은
 * 필드는 끄지 않는다(모든 필드를 숨기지 않는다).
 */
export function toggleField(
  available: readonly string[],
  visible: readonly string[] | null,
  key: string,
  on: boolean,
): string[] | null {
  const current = new Set(visible ?? available);
  if (on) current.add(key);
  else current.delete(key);
  const next = available.filter(item => current.has(item));
  if (next.length === available.length) return null;
  if (next.length === 0) return visible === null ? null : [...visible];
  return next;
}

/** 경로가 속한 맨 위 필드 키. 루트(와 래퍼 항목 자신)면 `null`. */
export function topFieldKey(path: JsonPath, wrapped: boolean): string | null {
  if (wrapped) return path[0] === "0" ? (path[1] ?? null) : null;
  return path[0] ?? null;
}

/** 이 경로를 그릴지: 고른 필드가 없거나(`null`) 루트이거나 그 맨 위 필드가 보이는 키다. */
export function isFieldPathShown(
  shown: ReadonlySet<string> | null,
  path: JsonPath,
  wrapped: boolean,
): boolean {
  if (shown === null) return true;
  const key = topFieldKey(path, wrapped);
  return key === null || shown.has(key);
}

/**
 * 숨긴 필드라도 저장을 막는 오류(`severity: "error"`)가 있으면 그 필드를 보이게 키를 더한다. 경고는
 * 저장을 막지 않으므로 더하지 않는다. 더할 것이 없으면 같은 집합을 돌려준다.
 */
export function withErrorFields(
  shown: ReadonlySet<string> | null,
  errors: ReadonlyMap<string, { readonly severity: "error" | "warning" }>,
  wrapped: boolean,
): ReadonlySet<string> | null {
  if (shown === null) return null;
  let out: Set<string> | null = null;
  for (const [pointer, error] of errors) {
    if (error.severity !== "error") continue;
    const path = fromPointer(pointer);
    const key = path ? topFieldKey(path, wrapped) : null;
    if (key === null || shown.has(key) || out?.has(key)) continue;
    out ??= new Set(shown);
    out.add(key);
  }
  return out ?? shown;
}

/** 보이는 필드 안의 leaf pointer(값 필터와 "n개 숨김" 이 이 안에서만 센다). */
export function leafPointersInFields(
  leaves: readonly ContentLeaf[],
  shown: ReadonlySet<string> | null,
  wrapped: boolean,
): string[] {
  const out: string[] = [];
  for (const leaf of leaves) {
    if (isFieldPathShown(shown, leaf.path, wrapped))
      out.push(toPointer(leaf.path));
  }
  return out;
}

/**
 * 뷰어에 그릴 추출값 하이라이트를 고르는 함수: 숨긴 필드의 값(`${resultId}#${pointer}`)은 뺀다.
 * 결과를 모르거나 pointer 가 없는 하이라이트(Parse 요소, 인용)는 그대로 둔다. 고른 필드가 있는 Step 이
 * 하나도 없으면 `null`(거르지 않음).
 */
export function fieldHighlightFilter(
  results: readonly Result[],
  steps: Readonly<Record<string, ReviewStep>> | undefined,
  choices: FieldChoices,
): ((highlight: { readonly id: string }) => boolean) | null {
  if (Object.keys(choices).length === 0) return null;
  const byStep = new Map<string, Result[]>();
  for (const result of results) {
    if (!Object.hasOwn(choices, result.step_id)) continue;
    const list = byStep.get(result.step_id);
    if (list) list.push(result);
    else byStep.set(result.step_id, [result]);
  }
  const byResult = new Map<
    string,
    { shown: ReadonlySet<string>; wrapped: boolean }
  >();
  for (const [stepId, inStep] of byStep) {
    const schema =
      (steps && Object.hasOwn(steps, stepId) ? steps[stepId]?.schema : null) ??
      null;
    const visible = visibleFieldList(
      stepFieldKeys(
        schema,
        inStep.map(result => result.content),
      ),
      savedFieldsFor(choices, stepId),
    );
    if (visible === null) continue;
    const shown = new Set(visible);
    for (const result of inStep) {
      byResult.set(result.id, {
        shown,
        wrapped: isHiddenWrapper(schema, result.content),
      });
    }
  }
  if (byResult.size === 0) return null;
  return highlight => {
    const pointer = (highlight as { readonly pointer?: unknown }).pointer;
    if (typeof pointer !== "string") return true;
    const { id } = highlight;
    if (!id.endsWith(`#${pointer}`)) return true;
    const entry = byResult.get(id.slice(0, id.length - pointer.length - 1));
    if (!entry) return true;
    const path = fromPointer(pointer);
    return path === null || isFieldPathShown(entry.shown, path, entry.wrapped);
  };
}
