import type { HighlightValueWithId } from "../../../shared/types/highlight";

/**
 * Keeps separately rendered highlights distinct even when the source document
 * reuses an element ID for more than one bounding box.
 */
export function highlightRenderKey(
  highlight: Pick<HighlightValueWithId, "id">,
  index: number,
  isActive: boolean,
  highlightSequence: number,
): string {
  return `${highlight.id}:${index}:${isActive ? highlightSequence : 0}`;
}
