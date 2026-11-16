import { isValueEntry, type ChangeEntry, type ReviewSession } from "./changes";
import type { JsonObject } from "./json";
import { buildUploadBody } from "./upload";
import { hasBlockingIssues, validateJob } from "./validate";

/**
 * 값 항목(`isValueEntry`)이 고친 결과 id. 항목 순서대로 넣는다. 저장 전 검증·편집 중 행 오류가
 * 검사할 결과를 고를 때 쓴다(diff 기준인 `UploadBody.changedResultIds` 와 다를 수 있다).
 */
export function changedValueResultIds(
  entries: readonly ChangeEntry[],
): Set<string> {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (isValueEntry(entry)) ids.add(entry.resultId);
  }
  return ids;
}

/** 저장 직전 판정. `ready` 일 때만 올린다. */
export type SavePlan =
  | { readonly kind: "no_job" }
  | { readonly kind: "no_change" }
  | { readonly kind: "blocked"; readonly reason: "issues" }
  | {
      readonly kind: "blocked";
      readonly reason: "package_limit_exceeded";
      readonly bytes: number;
      readonly limit: number;
    }
  | {
      readonly kind: "ready";
      readonly text: string;
      readonly body: JsonObject;
    };

/**
 * 저장할지·무엇을 올릴지 판정한다. 순서: Job 없음 → 항목 없음 → 값 항목 기준 검증 → 본문
 * 생성(바뀐 것 없음 → 크기 초과 → 본문 검증) → 올릴 본문. 검증 대상은 항목 기준이고, diff 는
 * 본문을 만들 때만 쓴다. `maxBytes` 는 부르는 쪽이 정한다(서버 능력값 또는 기본 한도).
 */
export function planSave(
  session: ReviewSession,
  options: { maxBytes: number },
): SavePlan {
  const job = session.current.jobs[0] ?? null;
  if (!job) return { kind: "no_job" };
  if (session.entries.length === 0) return { kind: "no_change" };
  const changedResultIds = changedValueResultIds(session.entries);
  if (
    hasBlockingIssues(validateJob(session.current, job, { changedResultIds }))
  ) {
    return { kind: "blocked", reason: "issues" };
  }
  const { maxBytes } = options;
  const upload = buildUploadBody(session.base, session.current, { maxBytes });
  if (!upload.body) return { kind: "no_change" };
  if (upload.issues.some(issue => issue.code === "package_limit_exceeded")) {
    return {
      kind: "blocked",
      reason: "package_limit_exceeded",
      bytes: upload.bytes,
      limit: maxBytes,
    };
  }
  if (hasBlockingIssues(upload.issues)) {
    return { kind: "blocked", reason: "issues" };
  }
  return { kind: "ready", text: upload.text, body: upload.body };
}
