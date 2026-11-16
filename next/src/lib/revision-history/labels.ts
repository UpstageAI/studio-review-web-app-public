import {
  fieldTitle,
  isHiddenWrapper,
  isIndexToken,
  isJsonObject,
  schemaAt,
  schemaPath,
  type JsonPath,
  type JsonValue,
  type ReviewStep,
} from "@/lib/review-model";

/**
 * 값 비교 행의 항목 이름(단계별). 서버 저장 형식의 래퍼(`[{…}]`)면 앞 `"0"` 은 숨기고, 객체
 * 키는 Step schema 의 `title`(없으면 키), 배열 위치는 `#1` 부터 센다. `content` 는 `path` 가
 * 가리키는 쪽 값(삭제 행이면 변경 전 값)이고, 위치 판단은 그 값의 실제 배열 여부를 따른다
 * (값에서 경로가 끊기면 숫자 토큰을 위치로 본다).
 */
export function fieldLabel(
  step: ReviewStep | null | undefined,
  content: JsonValue,
  path: JsonPath,
): readonly string[] {
  const schema = step?.schema;
  const wrapped = isHiddenWrapper(schema, content);
  const start = wrapped && path[0] === "0" ? 1 : 0;
  let value: JsonValue | undefined = content;
  const out: string[] = [];
  path.forEach((token, index) => {
    const inArray =
      value === undefined ? isIndexToken(token) : Array.isArray(value);
    const next: JsonValue | undefined = Array.isArray(value)
      ? isIndexToken(token)
        ? value[Number(token)]
        : undefined
      : isJsonObject(value) && Object.hasOwn(value, token)
        ? value[token]
        : undefined;
    value = next;
    if (index < start) return;
    if (inArray) {
      out.push(`#${Number(token) + 1}`);
      return;
    }
    const prefix = path.slice(0, index + 1);
    const node = schemaAt(schema, schemaPath(wrapped, prefix))?.node ?? null;
    out.push(fieldTitle(node, prefix));
  });
  return out;
}
