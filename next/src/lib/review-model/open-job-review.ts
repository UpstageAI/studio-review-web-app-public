import { ReviewModelError } from "./errors";
import { readReviewDocument } from "./normalize";
import type { ReviewDocument } from "./types";

/**
 * 한 Job 의 검수 JSON 문자열을 읽어 문서로 돌려준다. 파싱·정규화 오류는 그대로 던지고, Job 이
 * 정확히 하나가 아니거나 id 가 `jobId` 와 다르면 `invalid_document`(`/jobs`)를 던진다. 세션은
 * 만들지 않는다 — 실패를 화면 오류로 보일지 상태로 남길지는 부르는 쪽이 정한다.
 */
export function openJobReview(text: string, jobId: string): ReviewDocument {
  const doc = readReviewDocument(text);
  if (doc.jobs.length !== 1 || doc.jobs[0]?.id !== jobId) {
    throw new ReviewModelError("invalid_document", { pointer: "/jobs" });
  }
  return doc;
}
