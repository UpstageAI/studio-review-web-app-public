import {
  replaceStructure,
  resultsForDocument,
  summarizeStructureReplacement,
  type ChangeDraft,
  type ReviewJob,
} from "@/lib/review-model";

/** 구조를 바꿨을 때 문서 집합이 달라지는 방식. 라벨·순서만 바뀐 문서는 해당하지 않는다. */
export type StructureImpactStatus = "removed" | "added" | "pages";

export interface StructureImpactDocument {
  readonly documentId: string;
  /** 사라지는 문서는 지금 라벨, 새로 생기거나 범위가 바뀌는 문서는 바뀐 뒤 라벨. */
  readonly label: string | null;
  readonly status: StructureImpactStatus;
  /** 지금 이 문서에 연결된 결과. 새로 생기는 문서는 아직 연결이 없어 비어 있다. */
  readonly results: readonly {
    readonly occurrenceId: string;
    readonly stepId: string;
  }[];
}

export interface StructureImpact {
  readonly documents: readonly StructureImpactDocument[];
  /** 영향받는 결과 수(여러 문서에 걸린 결과는 한 번만 센다). */
  readonly resultCount: number;
}

/**
 * 구조 draft 를 지금 Job 에 넣으면 문서 집합이 어떻게 바뀌고 어떤 결과가 영향을 받는지.
 * 넣을 수 없는 draft(보기 집합 불일치 등)는 null. 문서 집합이 그대로면 `documents` 가 빈 배열.
 */
export function structureImpact(
  job: ReviewJob,
  draft: Extract<ChangeDraft, { readonly kind: "replace_structure" }>,
): StructureImpact | null {
  const replaced = replaceStructure(job, draft.fileGroups, draft.layouts);
  if (!replaced.ok) return null;
  const summary = summarizeStructureReplacement(job, replaced.job);
  const documents: StructureImpactDocument[] = [];
  const affected = new Set<string>();
  for (const change of summary.documents) {
    const status: StructureImpactStatus | null =
      change.status === "removed"
        ? "removed"
        : change.status === "added"
          ? "added"
          : change.pageSetChanged
            ? "pages"
            : null;
    if (!status) continue;
    const results =
      status === "added"
        ? []
        : resultsForDocument(job, change.documentId).map(result => ({
            occurrenceId: result.id,
            stepId: result.step_id,
          }));
    for (const result of results) affected.add(result.occurrenceId);
    documents.push({
      documentId: change.documentId,
      label: status === "removed" ? change.before : change.after,
      status,
      results,
    });
  }
  return { documents, resultCount: affected.size };
}
