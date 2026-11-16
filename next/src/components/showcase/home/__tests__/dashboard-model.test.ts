import { describe, expect, it } from "vitest";
import type { RecentJob } from "@/lib/recent-jobs";
import type { ReviewActivityRow } from "@/lib/review-api/activity";
import {
  hasReviewActivity,
  mergeRecentActivity,
  pickContinueJob,
  type ActivityInput,
} from "../dashboard-model";

const at = (minute: number) =>
  new Date(Date.UTC(2026, 10, 3, 9, minute)).toISOString();

function row(
  jobId: string,
  minute: number,
  overrides: Partial<ReviewActivityRow> = {},
): ReviewActivityRow {
  return {
    collection_id: "scol_1",
    job_id: jobId,
    review_status: "in_progress",
    started_at: at(0),
    completed_at: null,
    updated_at: at(minute),
    ...overrides,
  };
}

function local(
  jobId: string,
  minute: number,
  overrides: Partial<RecentJob> = {},
): RecentJob {
  return {
    collectionId: "scol_1",
    collectionName: "Invoices",
    jobId,
    jobName: `${jobId}.pdf`,
    openedAt: at(minute),
    ...overrides,
  };
}

function activity(
  data: ReviewActivityRow[],
  jobs: ReviewActivityRow[] = [],
  asked: string[] = [],
): ActivityInput {
  return { data, jobs, asked };
}

const OVERVIEW = { done: 0, in_progress: 0, collections_in_progress: 0 };

describe("hasReviewActivity", () => {
  it("DB 기록도, 이 브라우저에서 연 Job 도 없으면 거짓", () => {
    expect(hasReviewActivity(null, [])).toBe(false);
    expect(hasReviewActivity(OVERVIEW, [])).toBe(false);
  });

  it("DB 에 검수 중이나 검수 완료 기록이 있으면 참", () => {
    expect(hasReviewActivity({ ...OVERVIEW, in_progress: 1 }, [])).toBe(true);
    expect(hasReviewActivity({ ...OVERVIEW, done: 2 }, [])).toBe(true);
  });

  it("기록을 받기 전이라도 이 브라우저에서 연 Job 이 있으면 참", () => {
    expect(hasReviewActivity(null, [local("job_1", 1)])).toBe(true);
  });
});

describe("mergeRecentActivity", () => {
  it("DB 행에 브라우저의 이름을 붙이고, 모르는 이름은 null 로 둔다", () => {
    const rows = mergeRecentActivity(
      activity([row("job_1", 5), row("job_2", 4, { collection_id: "scol_2" })]),
      [local("job_1", 1)],
      5,
    );
    expect(rows).toEqual([
      expect.objectContaining({
        key: "scol_1:job_1",
        jobName: "job_1.pdf",
        collectionName: "Invoices",
        status: "in_progress",
      }),
      expect.objectContaining({
        key: "scol_2:job_2",
        collectionId: "scol_2",
        jobId: "job_2",
        jobName: null,
        collectionName: null,
      }),
    ]);
  });

  it("상태가 바뀐 시각과 연 시각 중 늦은 것으로 정렬한다", () => {
    const rows = mergeRecentActivity(
      activity([row("job_1", 10), row("job_2", 5)], [], ["scol_1:job_2"]),
      [local("job_2", 20)],
      5,
    );
    expect(rows.map(item => item.jobId)).toEqual(["job_2", "job_1"]);
    expect(rows[0]?.at).toBe(Date.parse(at(20)));
  });

  it("최근 행 밖의 Job 상태는 jobs 조회 결과로 채운다", () => {
    const rows = mergeRecentActivity(
      activity(
        [row("job_1", 10)],
        [row("job_9", 1, { review_status: "done", completed_at: at(1) })],
        ["scol_1:job_9"],
      ),
      [local("job_9", 2)],
      5,
    );
    expect(rows.find(item => item.jobId === "job_9")).toMatchObject({
      status: "done",
      completedAt: at(1),
    });
  });

  it("물어본 Job 에 기록이 없으면 검수 전, 묻지 않은 Job 은 모름", () => {
    const rows = mergeRecentActivity(
      activity([], [], ["scol_1:job_1"]),
      [local("job_1", 2), local("job_2", 1)],
      5,
    );
    expect(rows.map(item => [item.jobId, item.status])).toEqual([
      ["job_1", "pending"],
      ["job_2", undefined],
    ]);
  });

  it("기록을 받지 못했으면 브라우저 기록만 상태 없이 보인다", () => {
    const rows = mergeRecentActivity(null, [local("job_1", 1)], 5);
    expect(rows).toEqual([
      expect.objectContaining({ jobId: "job_1", status: undefined }),
    ]);
  });

  it("같은 Job 은 한 줄이고 limit 줄까지만 돌려준다", () => {
    const rows = mergeRecentActivity(
      activity(
        [row("job_1", 9), row("job_2", 8), row("job_3", 7)],
        [row("job_1", 9)],
        ["scol_1:job_1"],
      ),
      [local("job_1", 1), local("job_4", 6)],
      3,
    );
    expect(rows.map(item => item.jobId)).toEqual(["job_1", "job_2", "job_3"]);
  });
});

describe("pickContinueJob", () => {
  it("가장 최근에 연 Job 중 검수 중인 것을 고른다", () => {
    const job = pickContinueJob(
      activity(
        [row("job_1", 9, { review_status: "done", completed_at: at(9) })],
        [row("job_1", 9, { review_status: "done" }), row("job_2", 1)],
        ["scol_1:job_1", "scol_1:job_2"],
      ),
      [local("job_1", 30), local("job_2", 20)],
    );
    expect(job).toMatchObject({
      jobId: "job_2",
      jobName: "job_2.pdf",
      collectionName: "Invoices",
      status: "in_progress",
      at: Date.parse(at(20)),
    });
  });

  it("저장 순서가 어긋나도 연 시각으로 고른다", () => {
    const job = pickContinueJob(activity([row("job_1", 1), row("job_2", 1)]), [
      local("job_1", 5),
      local("job_2", 40),
    ]);
    expect(job?.jobId).toBe("job_2");
  });

  it("검수 중인 Job 이 없으면 null", () => {
    expect(
      pickContinueJob(activity([], [], ["scol_1:job_1"]), [local("job_1", 1)]),
    ).toBeNull();
    expect(pickContinueJob(activity([row("job_5", 1)]), [])).toBeNull();
  });

  it("기록을 받지 못했으면 가장 최근에 연 Job 을 상태 없이", () => {
    expect(
      pickContinueJob(null, [local("job_1", 1), local("job_2", 2)]),
    ).toMatchObject({ jobId: "job_2", status: undefined });
    expect(pickContinueJob(null, [])).toBeNull();
  });
});
