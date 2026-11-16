import type { DocumentListFlag } from "@/components/studio-ui-kit/document-list";
import {
  contentLeaves,
  isValidateStepType,
  isVerdictValue,
  linkedDocumentIds,
  results,
  type Result,
  type ResultCheck,
  type ReviewJob,
  type ReviewStep,
} from "@/lib/review-model";

// Validate Step 판정(green, yellow, red)을 문서별로 모으는 규칙(순수). 판정은 지금 편집본의 값이라
// 검수자가 판정을 고치면 고친 값을 따른다.

export type DocumentVerdict = "green" | "yellow" | "red";

type Steps = Readonly<Record<string, Pick<ReviewStep, "type" | "name">>>;

const RANK: Readonly<Record<DocumentVerdict, number>> = {
  green: 0,
  yellow: 1,
  red: 2,
};

function stepOf(
  steps: Steps | undefined,
  stepId: string,
): Pick<ReviewStep, "type" | "name"> | undefined {
  return steps && Object.hasOwn(steps, stepId) ? steps[stepId] : undefined;
}

/**
 * Validate Step 결과의 판정. 결과 `content` 의 leaf 가 하나뿐이고 그 값이 세 판정 중 하나일 때만(값
 * 패널이 판정 세그먼트를 그리는 조건과 같다). 그 밖은 `null`.
 */
export function resultVerdict(
  result: Result,
  steps: Steps | undefined,
): DocumentVerdict | null {
  if (!isValidateStepType(stepOf(steps, result.step_id)?.type)) return null;
  const leaves = contentLeaves(result.content);
  if (leaves.length !== 1) return null;
  const value = leaves[0]?.value;
  return isVerdictValue(value) ? value : null;
}

/** 둘 중 더 나쁜 판정. */
export function worseVerdict(
  a: DocumentVerdict | undefined,
  b: DocumentVerdict,
): DocumentVerdict {
  return a !== undefined && RANK[a] >= RANK[b] ? a : b;
}

/**
 * 문서 id → 그 문서에 연결된 Validate 결과 판정 중 가장 나쁜 값. 판정 결과가 없는 문서는 빠진다.
 */
export function documentVerdicts(
  job: ReviewJob | null,
  steps: Steps | undefined,
): ReadonlyMap<string, DocumentVerdict> {
  const out = new Map<string, DocumentVerdict>();
  if (!job) return out;
  for (const result of results(job)) {
    const verdict = resultVerdict(result, steps);
    if (verdict === null) continue;
    for (const documentId of linkedDocumentIds(result)) {
      out.set(documentId, worseVerdict(out.get(documentId), verdict));
    }
  }
  return out;
}

/** 문서 목록 글자 표시: red → `danger`, yellow → `warning`, green, 없음 → 표시 없음. */
export function flagForVerdict(
  verdict: DocumentVerdict | undefined,
): DocumentListFlag | undefined {
  if (verdict === "red") return "danger";
  if (verdict === "yellow") return "warning";
  return undefined;
}

/** 값 탭 위 검증 요약의 한 줄: 문제가 있는(yellow, red) Validate 결과 하나와 그 결과의 실패 근거. */
export type ValidationIssueItem = {
  resultId: string;
  stepId: string;
  stepName: string;
  verdict: Exclude<DocumentVerdict, "green">;
  /** 원본 판정 근거 중 통과하지 못한 것(`passed === false`). 근거가 없으면 빈 배열. */
  failedChecks: readonly ResultCheck[];
};

/**
 * 문서에 연결된 Validate 결과 중 yellow, red 판정인 것. red 를 먼저, 같은 판정은 결과 순서대로.
 */
export function validationIssuesForDocument(
  job: ReviewJob | null,
  steps: Steps | undefined,
  documentId: string,
): ValidationIssueItem[] {
  if (!job) return [];
  const out: ValidationIssueItem[] = [];
  for (const result of results(job)) {
    if (!linkedDocumentIds(result).includes(documentId)) continue;
    const verdict = resultVerdict(result, steps);
    if (verdict === null || verdict === "green") continue;
    out.push({
      resultId: result.id,
      stepId: result.step_id,
      stepName: stepOf(steps, result.step_id)?.name ?? result.step_id,
      verdict,
      failedChecks: (result.checks ?? []).filter(
        check => check.passed === false,
      ),
    });
  }
  return out.sort((a, b) => RANK[b.verdict] - RANK[a.verdict]);
}
