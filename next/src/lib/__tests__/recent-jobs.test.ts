import { describe, expect, it } from "vitest";
import {
  parseRecentJobs,
  RECENT_JOBS_MAX,
  recentJobKey,
  serializeRecentJobs,
  withRecentJob,
  type RecentJob,
} from "../recent-jobs";

function job(n: number, overrides: Partial<RecentJob> = {}): RecentJob {
  return {
    collectionId: "scol_1",
    collectionName: "Invoices",
    jobId: `job_${n}`,
    jobName: `file_${n}.pdf`,
    openedAt: new Date(Date.UTC(2026, 10, 3, 0, n)).toISOString(),
    ...overrides,
  };
}

describe("parseRecentJobs", () => {
  it("없음, 깨진 JSON, 배열이 아닌 값은 빈 목록", () => {
    expect(parseRecentJobs(null)).toEqual([]);
    expect(parseRecentJobs("")).toEqual([]);
    expect(parseRecentJobs("{")).toEqual([]);
    expect(parseRecentJobs('{"a":1}')).toEqual([]);
  });

  it("모양이 틀린 항목과 서버가 받지 않는 id 는 버리고, 빈 이름은 null 로 읽는다", () => {
    const raw = JSON.stringify([
      job(1),
      { collectionId: "scol_1", jobId: "job_2" },
      { collectionId: "", jobId: "job_3", openedAt: job(3).openedAt },
      { ...job(4), openedAt: "not a date" },
      { ...job(5), collectionName: "  ", jobName: 42 },
      "job_6",
      job(7, { jobId: "../job_7" }),
      job(8, { collectionId: "scol 8" }),
    ]);
    expect(parseRecentJobs(raw)).toEqual([
      job(1),
      { ...job(5), collectionName: null, jobName: null },
    ]);
  });

  it("같은 Job 은 앞의 것만 남기고 상한까지만 읽는다", () => {
    const list = Array.from({ length: RECENT_JOBS_MAX + 3 }, (_, i) => job(i));
    const raw = JSON.stringify([job(0, { jobName: "newer.pdf" }), ...list]);
    const parsed = parseRecentJobs(raw);
    expect(parsed).toHaveLength(RECENT_JOBS_MAX);
    expect(parsed[0]?.jobName).toBe("newer.pdf");
    expect(new Set(parsed.map(item => item.jobId)).size).toBe(RECENT_JOBS_MAX);
  });
});

describe("withRecentJob", () => {
  it("새 Job 을 맨 앞에 둔다", () => {
    expect(withRecentJob([job(1)], job(2)).map(item => item.jobId)).toEqual([
      "job_2",
      "job_1",
    ]);
  });

  it("이미 있는 Job 은 맨 앞으로 옮기고 연 시각을 새로 쓴다", () => {
    const next = withRecentJob(
      [job(1), job(2), job(3)],
      job(3, {
        openedAt: "2026-11-03T09:00:00.000Z",
      }),
    );
    expect(next.map(item => item.jobId)).toEqual(["job_3", "job_1", "job_2"]);
    expect(next[0]?.openedAt).toBe("2026-11-03T09:00:00.000Z");
  });

  it("다른 Collection 의 같은 Job ID 는 다른 Job 이다", () => {
    const next = withRecentJob([job(1)], job(1, { collectionId: "scol_2" }));
    expect(
      next.map(item => recentJobKey(item.collectionId, item.jobId)),
    ).toEqual(["scol_2:job_1", "scol_1:job_1"]);
  });

  it("이번에 이름을 모르면 전에 기억한 이름을 이어 쓴다", () => {
    const next = withRecentJob(
      [job(1)],
      job(1, { collectionName: null, jobName: null }),
    );
    expect(next[0]).toMatchObject({
      collectionName: "Invoices",
      jobName: "file_1.pdf",
    });
  });

  it("상한을 넘으면 오래 전에 연 것부터 버린다", () => {
    const list = Array.from({ length: RECENT_JOBS_MAX }, (_, i) => job(i));
    const next = withRecentJob(list, job(99));
    expect(next).toHaveLength(RECENT_JOBS_MAX);
    expect(next[0]?.jobId).toBe("job_99");
    expect(next.at(-1)?.jobId).toBe(`job_${RECENT_JOBS_MAX - 2}`);
  });

  it("저장한 값을 다시 읽으면 같은 목록이다", () => {
    const list = withRecentJob([job(1)], job(2));
    expect(parseRecentJobs(serializeRecentJobs(list))).toEqual(list);
  });
});
