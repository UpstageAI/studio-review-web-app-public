import { readFileSync } from "node:fs";

/**
 * 테스트 fixture 를 "문자열" 로 읽는다. JSON import 는 `JSON.parse` 를 거쳐 큰 정수·
 * 고정밀 소수를 잃으므로, 모든 테스트가 `parseJson`/`readReviewDocument` 를 거치게 한다.
 */
function read(name: string): string {
  return readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
}

/** 파일 2 개(3p+2p)·그룹 1·문서 3·Extract/Merge/Validate 결과, 정밀 숫자, state 혼재. */
export const SINGLE_JOB = read("single-job.json");
/** 문서 배치 보기 2 개(같은 document_id 가 보기마다 있음). */
export const MULTI_LAYOUT = read("multi-layout.json");
/** labels·schema·num_pages·checks 없음, step_id null 보기, file_groups 없는 Job. */
export const NO_LOOKUPS = read("no-lookups.json");
/** 파이프라인 `app/static/collection-results-v11.schema.json` 사본. */
export const V11_SCHEMA = read("collection-results-v11.schema.json");
