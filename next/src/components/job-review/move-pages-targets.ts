import type { MovePagesTarget } from "@/components/studio-ui-kit/move-pages-dialog";

/** "다른 문서로 옮기기" 대화상자의 대상 문서 하나. `index` 는 후보 목록 안 위치(0-based). */
export type { MovePagesTarget };

/** 대상 후보. 호출처가 보이는 문서 목록(또는 필름스트립 띠)을 순서대로 넘긴다. */
export type MovePagesCandidate = {
  documentId: string;
  groupId: string;
  label: string | null;
  pageCount: number;
  /** 잠긴 문서는 대상이 아니다. */
  locked?: boolean;
};

/**
 * 페이지를 옮길 수 있는 문서: 원본과 같은 그룹이고 잠기지 않았으며 `excludeDocumentId` 가 아닌 후보.
 * 원본이 한 문서일 때 호출처가 그 문서를 `excludeDocumentId` 로 넘긴다(여러 문서면 `null` — 원본
 * 문서도 대상이 될 수 있다). `index` 는 걸러내기 전 후보 목록 안 위치이고 순서는 입력 순서 그대로다.
 * 고른 것이 없거나 그룹이 섞인 경우의 빈 목록 판정은 호출처에 둔다.
 */
export function movePagesTargets(
  candidates: readonly MovePagesCandidate[],
  {
    groupId,
    excludeDocumentId,
  }: { groupId: string; excludeDocumentId: string | null },
): MovePagesTarget[] {
  return candidates.flatMap((candidate, index) =>
    candidate.groupId === groupId &&
    !candidate.locked &&
    candidate.documentId !== excludeDocumentId
      ? [
          {
            documentId: candidate.documentId,
            index,
            label: candidate.label,
            pageCount: candidate.pageCount,
          },
        ]
      : [],
  );
}
