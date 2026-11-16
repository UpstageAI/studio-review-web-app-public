// 객체 배열을 표(행 = 항목, 열 = 필드)로 보일지와 그 열을 정하는 순수 규칙. React, 문구 없이 값만 본다.

import {
  LONG_TEXT_LENGTH,
  isJsonObject,
  type JsonValue,
} from "@/lib/review-model";

/** 표로 보일 수 있는 열 수 상한. 넘으면 항목마다 필드를 쌓는 모양으로 그린다. */
export const TABLE_MAX_COLUMNS = 8;

/** 표 칸에 넣을 수 있는 값: 문자열, 숫자, 불리언, null. 아주 긴 문자열(읽기 전용 요약)은 뺀다. */
function isCellValue(value: JsonValue): boolean {
  if (Array.isArray(value) || isJsonObject(value)) return false;
  return !(typeof value === "string" && value.length > LONG_TEXT_LENGTH);
}

/**
 * 배열 `items` 를 표로 보일 때의 열 키. 항목이 하나 이상이고 모두 평평한 객체(값이 `isCellValue`)이며
 * 열이 1 개 이상 `max` 개 이하일 때만, 아니면 `null`. 열은 어느 항목에든 있는 키 전부이고, 순서는
 * `preferred`(schema `properties` 순서) 중 항목에 있는 키를 먼저, 나머지는 처음 나온 순서다. 어떤
 * 항목에 없는 키는 그 칸을 비워 두고 host 가 "추가" 를 둔다.
 */
export function tableColumns(
  items: readonly JsonValue[],
  preferred: readonly string[] = [],
  max = TABLE_MAX_COLUMNS,
): string[] | null {
  if (items.length === 0) return null;
  const seen = new Set<string>();
  const order: string[] = [];
  for (const item of items) {
    if (!isJsonObject(item)) return null;
    for (const key of Object.keys(item)) {
      if (!isCellValue(item[key] ?? null)) return null;
      if (!seen.has(key)) {
        seen.add(key);
        order.push(key);
        if (order.length > max) return null;
      }
    }
  }
  if (order.length === 0) return null;
  const first = preferred.filter(key => seen.has(key));
  const firstSet = new Set(first);
  return [...first, ...order.filter(key => !firstSet.has(key))];
}

/** schema 노드의 `properties` 키 순서. 없으면 빈 배열. */
export function propertyOrder(node: JsonValue | undefined): string[] {
  if (!isJsonObject(node)) return [];
  const properties = node.properties;
  return isJsonObject(properties) ? Object.keys(properties) : [];
}
