import { describe, expect, it } from "vitest";

import type { JobRow } from "@/lib/review-api/types";
import {
  appendPage,
  buildQueue,
  entryOf,
  moveTo,
  neighbors,
  parseQueue,
  positionOf,
  queueStorageKey,
  restartWith,
  type ReviewQueue,
  serializeQueue,
  sourceJobsQueryOf,
  unfinishedVisitedCount,
} from "../review-queue";

function row(id: string, filename: string | null = `${id}.pdf`): JobRow {
  return {
    job_id: id,
    files: filename ? [{ id: `file_${id}`, filename }] : [],
    file_count: filename ? 1 : 0,
  };
}

const QUERY = { order: "desc", group_by: "input_files" } as const;

function queueOf(
  ids: string[],
  start: string,
  nextCursor: string | null = null,
): ReviewQueue {
  const queue = buildQueue({
    collectionId: "col_1",
    query: QUERY,
    rows: ids.map(id => row(id)),
    startJobId: start,
    nextCursor,
  });
  if (!queue) throw new Error("queue expected");
  return queue;
}

describe("entryOf", () => {
  it("첫 파일명과 파일 수를 담는다", () => {
    expect(
      entryOf({
        job_id: "job_a",
        files: [
          { id: "f1", filename: null },
          { id: "f2", filename: "b.pdf" },
        ],
      }),
    ).toEqual({ job_id: "job_a", filename: "b.pdf", file_count: 2 });
    expect(entryOf({ job_id: "job_b", file_count: 3 })).toEqual({
      job_id: "job_b",
      filename: null,
      file_count: 3,
    });
  });
});

describe("buildQueue", () => {
  it("시작 행을 현재 위치로 두고 방문 기록에 넣는다", () => {
    const queue = queueOf(["job_a", "job_b", "job_c"], "job_b", "cur_1");
    expect(queue).toMatchObject({
      version: 1,
      collectionId: "col_1",
      index: 1,
      next_cursor: "cur_1",
      visited: ["job_b"],
    });
    expect(queue.jobs.map(job => job.job_id)).toEqual([
      "job_a",
      "job_b",
      "job_c",
    ]);
  });

  it("시작 행이 없으면 null", () => {
    expect(
      buildQueue({
        collectionId: "col_1",
        query: QUERY,
        rows: [row("job_a")],
        startJobId: "job_x",
        nextCursor: null,
      }),
    ).toBeNull();
  });

  it("같은 Job 이 두 번 오면 한 번만 담는다", () => {
    const queue = queueOf(["job_a", "job_a", "job_b"], "job_a");
    expect(queue.jobs.map(job => job.job_id)).toEqual(["job_a", "job_b"]);
  });
});

describe("appendPage", () => {
  it("이미 있는 Job 은 건너뛰고 커서를 바꾼다", () => {
    const queue = appendPage(
      queueOf(["job_a", "job_b"], "job_a", "cur_1"),
      [row("job_b"), row("job_c")],
      null,
    );
    expect(queue.jobs.map(job => job.job_id)).toEqual([
      "job_a",
      "job_b",
      "job_c",
    ]);
    expect(queue.next_cursor).toBeNull();
  });
});

describe("neighbors", () => {
  it("처음·중간·끝의 이웃과 남은 수", () => {
    const queue = queueOf(["job_a", "job_b", "job_c"], "job_a", "cur_1");
    expect(neighbors(queue, "job_a")).toMatchObject({
      inQueue: true,
      previous: null,
      next: { job_id: "job_b" },
      remaining: 2,
      more: true,
    });
    expect(neighbors(queue, "job_b")).toMatchObject({
      previous: { job_id: "job_a" },
      next: { job_id: "job_c" },
      remaining: 1,
    });
    expect(neighbors(queue, "job_c")).toMatchObject({
      previous: { job_id: "job_b" },
      next: null,
      remaining: 0,
    });
  });

  it("큐 밖의 Job", () => {
    expect(neighbors(queueOf(["job_a"], "job_a"), "job_x")).toEqual({
      inQueue: false,
      previous: null,
      next: null,
      remaining: 0,
      more: false,
    });
    expect(positionOf(queueOf(["job_a"], "job_a"), "job_x")).toBe(-1);
  });
});

describe("moveTo", () => {
  it("위치를 옮기고 방문 기록을 중복 없이 늘린다", () => {
    let queue = queueOf(["job_a", "job_b"], "job_a");
    queue = moveTo(queue, "job_b");
    expect(queue.index).toBe(1);
    queue = moveTo(queue, "job_a");
    expect(queue.index).toBe(0);
    expect(queue.visited).toEqual(["job_a", "job_b"]);
  });

  it("큐 밖이면 그대로", () => {
    const queue = queueOf(["job_a"], "job_a");
    expect(moveTo(queue, "job_x")).toBe(queue);
  });
});

describe("restartWith", () => {
  it("안 본 Job 만으로 새 큐를 만들고 방문 기록을 잇는다", () => {
    const queue = moveTo(queueOf(["job_a", "job_b"], "job_a"), "job_b");
    const next = restartWith(
      queue,
      [row("job_new"), row("job_a"), row("job_b"), row("job_c")],
      "cur_2",
    );
    expect(next).toMatchObject({
      index: 0,
      next_cursor: "cur_2",
      visited: ["job_a", "job_b"],
    });
    expect(next?.jobs.map(job => job.job_id)).toEqual(["job_new", "job_c"]);
  });

  it("볼 Job 이 없으면 null", () => {
    const queue = queueOf(["job_a"], "job_a");
    expect(restartWith(queue, [row("job_a")], null)).toBeNull();
  });
});

describe("unfinishedVisitedCount", () => {
  const visitedQueue = (): ReviewQueue =>
    moveTo(
      moveTo(queueOf(["job_a", "job_b", "job_c"], "job_a"), "job_b"),
      "job_c",
    );

  it("이번 큐에서 연 미완료 Job 을 센다(같은 Job 은 한 번)", () => {
    const rows = [
      { ...row("job_a"), review_status: "in_progress" as const },
      { ...row("job_b"), review_status: "pending" as const },
      { ...row("job_a"), review_status: "in_progress" as const },
    ];
    expect(unfinishedVisitedCount(visitedQueue(), rows, "job_c")).toBe(2);
  });

  it("검수 완료 Job 은 빼고, 상태가 없는 행은 미완료로 본다", () => {
    const rows = [
      { ...row("job_a"), review_status: "done" as const },
      row("job_b"),
    ];
    expect(unfinishedVisitedCount(visitedQueue(), rows, "job_c")).toBe(1);
  });

  it("지금 보는 Job 은 세지 않는다", () => {
    const rows = [{ ...row("job_c"), review_status: "in_progress" as const }];
    expect(unfinishedVisitedCount(visitedQueue(), rows, "job_c")).toBe(0);
  });

  it("이번 큐에서 안 연 행은 무시한다", () => {
    const rows = [
      { ...row("job_new"), review_status: "pending" as const },
      row("job_other"),
    ];
    expect(unfinishedVisitedCount(visitedQueue(), rows, "job_c")).toBe(0);
  });
});

describe("sourceJobsQueryOf", () => {
  it("큐 조건 + 완료 Job + 페이지 크기", () => {
    const queue = queueOf(["job_a"], "job_a");
    expect(sourceJobsQueryOf(queue)).toEqual({
      status: "completed",
      limit: 20,
      order: "desc",
      group_by: "input_files",
      after: undefined,
    });
    expect(
      sourceJobsQueryOf(
        { query: { order: "asc", review_status: "unfinished" } },
        "cur_1",
      ),
    ).toEqual({
      status: "completed",
      limit: 20,
      order: "asc",
      review_status: "unfinished",
      after: "cur_1",
    });
  });
});

describe("serializeQueue / parseQueue", () => {
  it("되돌려 읽는다", () => {
    const queue = moveTo(
      queueOf(["job_a", "job_b"], "job_a", "cur_1"),
      "job_b",
    );
    queue.jobs[0] = { ...queue.jobs[0], filename: null };
    expect(parseQueue(serializeQueue(queue))).toEqual(queue);
    expect(queueStorageKey("col_1")).toBe("review-queue:col_1");
  });

  it("깨진 값·버전 불일치·모양이 다른 값은 null", () => {
    const good = JSON.parse(
      serializeQueue(queueOf(["job_a"], "job_a")),
    ) as Record<string, unknown>;
    const cases: unknown[] = [
      { ...good, version: 2 },
      { ...good, collectionId: "" },
      { ...good, query: { order: "sideways" } },
      { ...good, query: { order: "desc", review_status: "all" } },
      { ...good, jobs: [{ job_id: "job_a" }] },
      { ...good, index: 1 },
      { ...good, next_cursor: 3 },
      { ...good, visited: [1] },
      [],
    ];
    expect(parseQueue(null)).toBeNull();
    expect(parseQueue("{not json")).toBeNull();
    for (const value of cases) {
      expect(parseQueue(JSON.stringify(value))).toBeNull();
    }
  });
});
