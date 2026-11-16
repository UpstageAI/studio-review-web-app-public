import type { StructureRejectReason } from "./types";

/**
 * 페이지를 `document` 에 놓을 때 문구로 알리는 거부 사유. 문서가 없거나 잠겼으면 `locked`, 끄는 페이지의
 * 그룹(`groupIds`) 중 하나라도 문서와 다르면 `group`, 둘 다 아니면 `null`(받을 수 있음 — 제자리 여부는
 * 따로 본다).
 */
export function pageDropRejectReason(
  document: { groupId: string; locked?: boolean } | undefined,
  groupIds: readonly string[],
): StructureRejectReason | null {
  if (!document || document.locked) return "locked";
  if (groupIds.some(groupId => groupId !== document.groupId)) return "group";
  return null;
}
