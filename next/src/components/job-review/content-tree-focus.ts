import type { JsonPath } from "@/lib/review-model";
import type { Parent } from "./content-tree-context";

/**
 * 노드 메뉴로 배열 항목·객체 필드를 지운 뒤 포커스를 줄 경로(지운 뒤 기준): 다음 이웃 → 없으면 이전
 * 이웃 → 없으면 부모. `isShown` 이 거짓인 이웃(필터·"필드" 메뉴로 숨긴 것)은 건너뛴다.
 * 배열은 뒤 항목이 한 칸씩 당겨지므로 다음 이웃의 경로는 지운 자리 번호다.
 */
export function removalFocusPath(
  parent: Parent,
  isShown: (path: JsonPath) => boolean = () => true,
): JsonPath {
  if (parent.kind === "array") {
    const { path, index, length } = parent;
    for (let at = index + 1; at < length; at += 1) {
      if (isShown([...path, String(at)])) return [...path, String(at - 1)];
    }
    for (let at = index - 1; at >= 0; at -= 1) {
      if (isShown([...path, String(at)])) return [...path, String(at)];
    }
    return path;
  }
  const { path, key, siblings } = parent;
  const position = siblings.indexOf(key);
  if (position < 0) return path;
  const shown = (sibling: string) => isShown([...path, sibling]);
  const neighbor =
    siblings.slice(position + 1).find(shown) ??
    siblings.slice(0, position).findLast(shown);
  return neighbor === undefined ? path : [...path, neighbor];
}
