import { findResult, results, type ReviewJob } from "@/lib/review-model";
import type { JobRevision } from "@/lib/review-api/types";

type Target = Pick<JobRevision, "type" | "result">;

/**
 * 이력 대상의 지금 `base_version`. 값이면 결과의 `base_version`, 구조면
 * `file_groups.base_version`(서버가 모든 문서 배치 보기에 같은 값을 넣는다). 대상이 없으면 `null`.
 */
export function currentVersionOf(job: ReviewJob, rev: Target): number | null {
  if (rev.type === "structure") return job.file_groups?.base_version ?? null;
  if (!rev.result) return null;
  return findResult(job, rev.result.occurrence_id)?.base_version ?? null;
}

/** 이 변경이 지금 문서에 반영된 version 인가(`job` 은 불러온 문서). */
export function isCurrentRevision(
  job: ReviewJob,
  rev: Target & Pick<JobRevision, "version">,
): boolean {
  return currentVersionOf(job, rev) === rev.version;
}

/** 최초 원본을 불러올 수 있는 대상. */
export type MachineTarget =
  | {
      readonly type: "result";
      readonly occurrenceId: string;
      readonly stepId: string;
    }
  | { readonly type: "structure" };

/**
 * 한 번이라도 저장된(`base_version > 0`) 대상. 구조가 먼저, 결과는 문서 순서. 저장된 것이
 * 없으면 지금 값이 곧 기계 출력이라 빈 배열.
 */
export function machineTargets(job: ReviewJob): MachineTarget[] {
  const out: MachineTarget[] = [];
  if ((job.file_groups?.base_version ?? 0) > 0) out.push({ type: "structure" });
  for (const result of results(job)) {
    if (result.base_version > 0) {
      out.push({
        type: "result",
        occurrenceId: result.id,
        stepId: result.step_id,
      });
    }
  }
  return out;
}

/** 대상별 캐시 키. */
export function machineTargetKey(target: MachineTarget): string {
  return target.type === "structure"
    ? "structure"
    : `result:${target.occurrenceId}`;
}
