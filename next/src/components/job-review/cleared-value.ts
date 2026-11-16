import {
  isValueEntry,
  type ChangeEntry,
  type JsonPath,
  type JsonValue,
} from "@/lib/review-model";
import { valueAt } from "./value-fields";

/**
 * 입력칸에서 확정한 값을 고친다. 처음에 값이 없던(`null`) 필드를 입력칸에서 비우면 빈 글자(`""`)가
 * 확정되는데, 검수자에게는 "원래대로" 이므로 처음 값 `null` 로 바꾼다. 서버는 `null` 과 `""` 를 다른
 * 값으로 보아 `""` 를 정정으로 기록하고 근거 정보를 비우기 때문이다. JSON 가져오기 같은 다른 경로는
 * 이 규칙을 거치지 않아 빈 글자를 그대로 넣을 수 있다.
 */
export function clearedValue(
  next: JsonValue,
  original: JsonValue | undefined,
): JsonValue {
  return next === "" && original === null ? null : next;
}

function startsWith(path: JsonPath, prefix: JsonPath): boolean {
  return (
    prefix.length <= path.length &&
    prefix.every((segment, index) => path[index] === segment)
  );
}

/**
 * 지금 경로가 처음(불러온) 결과의 어느 경로였는지 찾는다. 배열 항목을 넣고 빼고 옮기면 같은 위치
 * 경로가 다른 항목을 가리키므로, 그 결과의 변경 항목을 뒤에서부터 거꾸로 되짚어 번호를 되돌린다.
 * 새로 넣은 항목이나 키, 통째로 바꾼 묶음 아래처럼 처음 값이 없으면 `null`.
 */
export function originalPathOf(
  entries: readonly ChangeEntry[],
  resultId: string,
  path: JsonPath,
): JsonPath | null {
  let current = [...path];
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (!isValueEntry(entry) || entry.resultId !== resultId) continue;
    const at = entry.path.length;
    switch (entry.kind) {
      case "set_value":
      case "replace_subtree":
        // 값 하나를 바꾼 것은 위치를 바꾸지 않는다. 지금 경로를 품은 묶음을 통째로 바꿨으면 처음 값이 없다.
        if (current.length > at && startsWith(current, entry.path)) return null;
        break;
      case "set_key":
        if (startsWith(current, [...entry.path, entry.key])) return null;
        break;
      case "remove_key":
        break;
      case "insert_item":
      case "remove_item":
      case "move_item": {
        if (current.length <= at || !startsWith(current, entry.path)) break;
        const index = Number(current[at]);
        if (!Number.isInteger(index)) break;
        let before: number;
        if (entry.kind === "insert_item") {
          if (index === entry.index) return null;
          before = index > entry.index ? index - 1 : index;
        } else if (entry.kind === "remove_item") {
          before = index >= entry.index ? index + 1 : index;
        } else if (index === entry.to) {
          before = entry.from;
        } else {
          // `to` 는 `from` 을 뺀 뒤 기준: 넣기를 되돌리고, 빼기를 되돌린다.
          const removed = index > entry.to ? index - 1 : index;
          before = removed >= entry.from ? removed + 1 : removed;
        }
        current = [
          ...current.slice(0, at),
          String(before),
          ...current.slice(at + 1),
        ];
        break;
      }
    }
  }
  return current;
}

/** 지금 경로의 처음 값. 처음에 없던 자리면 `undefined`(비워도 `null` 로 바꾸지 않는다). */
export function originalValueAt(
  entries: readonly ChangeEntry[],
  baseContent: JsonValue | undefined,
  resultId: string,
  path: JsonPath,
): JsonValue | undefined {
  if (baseContent === undefined) return undefined;
  const original = originalPathOf(entries, resultId, path);
  return original === null ? undefined : valueAt(baseContent, original);
}
