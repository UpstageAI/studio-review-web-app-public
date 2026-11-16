import {
  isJsonObject,
  isValueEntry,
  type ChangeEntry,
  type ImportConflict,
  type ImportUnit,
  type JsonObject,
} from "@/lib/review-model";
import type { SaveConflict } from "./job-review-state";

// 가져오기 결과를 화면 상태(트레이 항목·결과 행)에 잇는 순수 함수.

/**
 * 충돌 대상 → 트레이 항목. 값 충돌(`occurrence_id`)은 그 결과의 `set_value` 항목, 구조
 * 충돌은 그 Job 의 구성 편집 항목을 가리킨다.
 */
export function conflictTargets(
  entries: readonly ChangeEntry[],
  conflicts: readonly ImportConflict[],
): SaveConflict {
  const resultIds = new Set<string>();
  const structureJobs = new Set<string>();
  for (const conflict of conflicts) {
    if (conflict.target.kind === "structure") {
      structureJobs.add(conflict.target.job_id);
    } else if (conflict.target.occurrence_id !== undefined) {
      resultIds.add(conflict.target.occurrence_id);
    }
  }
  const entryIds = entries
    .filter(entry =>
      isValueEntry(entry)
        ? resultIds.has(entry.resultId)
        : structureJobs.has(entry.jobId),
    )
    .map(entry => entry.id);
  return {
    entryIds,
    resultIds: [...resultIds],
    structure: structureJobs.size > 0,
    count: conflicts.length,
  };
}

const RESULT_POINTER = /^\/jobs\/(\d+)\/output\/(\d+)(?:\/content(\/.*)?)?$/;

/**
 * 서버 오류 위치(업로드 본문 기준 JSON Pointer)를 결과 id·`content` 안 pointer 로 바꾼다.
 * 업로드 본문은 바뀐 결과만 담으므로 `output` 순번은 본문에서 찾아야 한다. 결과를 가리키지
 * 않으면 `null`.
 */
export function failureTarget(
  body: JsonObject | null,
  pointer: string | undefined,
): { resultId: string; fieldPointer: string | null } | null {
  if (!body || !pointer) return null;
  const match = RESULT_POINTER.exec(pointer);
  if (!match) return null;
  const jobs = body.jobs;
  const job = Array.isArray(jobs) ? jobs[Number(match[1])] : undefined;
  const output = isJsonObject(job) ? job.output : undefined;
  const item = Array.isArray(output) ? output[Number(match[2])] : undefined;
  const id = isJsonObject(item) ? item.id : undefined;
  if (typeof id !== "string") return null;
  return { resultId: id, fieldPointer: match[3] ?? null };
}

/** 반영된 version 중 가장 큰 값(`s:`·`v:`). 없으면 `fallback`. */
export function revisionOf(
  units: readonly ImportUnit[],
  fallback: number | null,
): number | null {
  let best: number | null = null;
  for (const unit of units) {
    for (const [key, value] of Object.entries(unit.applied_versions ?? {})) {
      if (!key.startsWith("s:") && !key.startsWith("v:")) continue;
      if (typeof value !== "number" || !Number.isSafeInteger(value)) continue;
      if (best === null || value > best) best = value;
    }
  }
  return best ?? fallback;
}

/** 같은 본문이면 같은 키를 다시 쓰기 위한 SHA-256 hex. 비보안 컨텍스트 등에서 못 구하면 `null`. */
export async function sha256Hex(text: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  try {
    const digest = await subtle.digest(
      "SHA-256",
      new TextEncoder().encode(text),
    );
    return Array.from(new Uint8Array(digest), byte =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  } catch {
    return null;
  }
}
