// Collection 상세 검색창의 입력 해석.

/** Job ID 로 보는 형식. 이 형식이면 목록을 거르지 않고 그 Job 을 바로 연다. */
export const JOB_ID_PATTERN = /^job_[A-Za-z0-9_-]{1,124}$/;

/** 파일명 검색어 최소·최대 길이(코드 포인트). BFF·upstream 과 같다. */
export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 200;

/** 입력값이 Job ID 형식인지(앞뒤 공백 무시). */
export function isJobIdInput(input: string): boolean {
  return JOB_ID_PATTERN.test(input.trim());
}

/** 입력값을 목록 필터 값으로 바꾼다. Job ID·2 자 미만·200 자 초과면 필터 없음. */
export function filterQueryOf(input: string): string | undefined {
  const value = input.trim();
  if (JOB_ID_PATTERN.test(value)) return undefined;
  const length = Array.from(value).length;
  if (length < MIN_QUERY_LENGTH || length > MAX_QUERY_LENGTH) return undefined;
  return value;
}

/** Job ID 도 아니고 필터에도 못 쓰는 1 자 입력인지(안내 문구용). */
export function isTooShortQuery(input: string): boolean {
  const value = input.trim();
  if (!value || JOB_ID_PATTERN.test(value)) return false;
  return Array.from(value).length < MIN_QUERY_LENGTH;
}
