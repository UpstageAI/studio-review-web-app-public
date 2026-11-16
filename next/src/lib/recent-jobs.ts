// 이 브라우저에서 최근에 연 검수 Job 목록(순수). Collection 이름과 Job 파일명은 앱 DB 에 없고 upstream 에서만
// 오므로, 검수 화면이 Job 을 불러온 뒤 이름을 여기에 남겨 홈 대시보드가 DB 기록과 합쳐 보여 준다.
// `localStorage` 한 키에 JSON 배열(최근 것이 앞)로 둔다.

import { RESOURCE_ID_PATTERN } from "@/lib/resource-id";

/** 최근 연 Job 을 두는 `localStorage` 키. */
export const RECENT_JOBS_KEY = "review-recent-jobs";

/** 기억하는 Job 수 상한. 넘으면 오래 전에 연 것부터 버린다. */
export const RECENT_JOBS_MAX = 10;

export type RecentJob = {
  collectionId: string;
  /** 모르면 `null`(화면은 Collection ID 로 보인다). */
  collectionName: string | null;
  jobId: string;
  /** Job 의 첫 파일명. 모르면 `null`(화면은 Job ID 로 보인다). */
  jobName: string | null;
  /** 마지막으로 연 시각(ISO 8601). */
  openedAt: string;
};

/** (Collection, Job) 을 한 문자열로. id 에는 `:` 이 들어가지 않는다(`[\w-]`). */
export function recentJobKey(collectionId: string, jobId: string): string {
  return `${collectionId}:${jobId}`;
}

function optionalName(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function readEntry(value: unknown): RecentJob | null {
  if (typeof value !== "object" || value === null) return null;
  const item = value as Record<string, unknown>;
  const { collectionId, jobId, openedAt } = item;
  // 서버(`/api/review-activity`)가 받는 모양의 id 만 남긴다. 하나라도 틀리면 요청 전체가 400 이 된다.
  if (
    typeof collectionId !== "string" ||
    !RESOURCE_ID_PATTERN.test(collectionId)
  ) {
    return null;
  }
  if (typeof jobId !== "string" || !RESOURCE_ID_PATTERN.test(jobId))
    return null;
  if (typeof openedAt !== "string" || !Number.isFinite(Date.parse(openedAt))) {
    return null;
  }
  return {
    collectionId,
    collectionName: optionalName(item.collectionName),
    jobId,
    jobName: optionalName(item.jobName),
    openedAt,
  };
}

/**
 * 저장소 값 → 최근 연 Job(최근 것이 앞). 없음, 깨진 JSON, 모르는 모양은 빈 목록이고, 모양이 틀린 항목과
 * 같은 Job 의 중복(앞의 것을 남김)은 버린다.
 */
export function parseRecentJobs(raw: string | null): RecentJob[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const out: RecentJob[] = [];
  for (const item of parsed) {
    const entry = readEntry(item);
    if (!entry) continue;
    const key = recentJobKey(entry.collectionId, entry.jobId);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
    if (out.length === RECENT_JOBS_MAX) break;
  }
  return out;
}

/**
 * 방금 연 Job 을 맨 앞에 둔 새 목록. 같은 Job 은 한 번만 남기고, 이번에 이름을 모르면 전에 기억한 이름을
 * 이어 쓴다. 상한을 넘으면 뒤(오래 전에 연 것)를 버린다.
 */
export function withRecentJob(
  list: readonly RecentJob[],
  entry: RecentJob,
): RecentJob[] {
  const key = recentJobKey(entry.collectionId, entry.jobId);
  const previous = list.find(
    item => recentJobKey(item.collectionId, item.jobId) === key,
  );
  const next: RecentJob = {
    ...entry,
    collectionName: entry.collectionName ?? previous?.collectionName ?? null,
    jobName: entry.jobName ?? previous?.jobName ?? null,
  };
  const rest = list.filter(
    item => recentJobKey(item.collectionId, item.jobId) !== key,
  );
  return [next, ...rest].slice(0, RECENT_JOBS_MAX);
}

export function serializeRecentJobs(list: readonly RecentJob[]): string {
  return JSON.stringify(list.slice(0, RECENT_JOBS_MAX));
}
