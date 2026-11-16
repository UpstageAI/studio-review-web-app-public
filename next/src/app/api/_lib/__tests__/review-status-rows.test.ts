import { describe, expect, it, vi } from "vitest";

import type {
  JobRow,
  ListPage,
  ReviewStatusRecord,
} from "@/lib/review-api/types";

import {
  annotateRows,
  collectFilteredPages,
  matchesReviewFilter,
  parseJobRowsPage,
  toListBody,
} from "../review-status-rows";

function page(jobIds: string[], next: string | null): ListPage<JobRow> {
  return {
    object: "list",
    data: jobIds.map(job_id => ({ job_id })),
    has_more: next !== null,
    first_cursor: `first:${jobIds[0]}`,
    last_cursor: next,
  };
}

describe("parseJobRowsPage", () => {
  it("data 배열이 있는 객체만 받는다", () => {
    expect(parseJobRowsPage('{"data":[{"job_id":"j1"}]}')?.data).toEqual([
      { job_id: "j1" },
    ]);
    expect(parseJobRowsPage("nope")).toBeNull();
    expect(parseJobRowsPage("null")).toBeNull();
    expect(parseJobRowsPage('{"data":{}}')).toBeNull();
  });
});

describe("annotateRows", () => {
  it("상태를 붙이고 맵에 없는 행은 pending", () => {
    const statuses = new Map<string, ReviewStatusRecord>([
      [
        "j1",
        {
          job_id: "j1",
          review_status: "done",
          review_completed_at: "2026-10-29T00:00:00.000Z",
        },
      ],
    ]);
    expect(
      annotateRows(
        [{ job_id: "j1", status: "completed" }, { job_id: "j2" }],
        statuses,
      ),
    ).toEqual([
      {
        job_id: "j1",
        status: "completed",
        review_status: "done",
        review_completed_at: "2026-10-29T00:00:00.000Z",
      },
      { job_id: "j2", review_status: "pending", review_completed_at: null },
    ]);
  });
});

describe("matchesReviewFilter", () => {
  const rows: JobRow[] = [
    { job_id: "a", review_status: "pending" },
    { job_id: "b", review_status: "in_progress" },
    { job_id: "c", review_status: "done" },
    { job_id: "d" },
  ];
  const ids = (filter: Parameters<typeof matchesReviewFilter>[1]) =>
    rows.filter(r => matchesReviewFilter(r, filter)).map(r => r.job_id);

  it("값별로 거른다", () => {
    expect(ids("pending")).toEqual(["a", "d"]);
    expect(ids("in_progress")).toEqual(["b"]);
    expect(ids("done")).toEqual(["c"]);
    expect(ids("unfinished")).toEqual(["a", "b", "d"]);
  });
});

describe("toListBody", () => {
  it("has_more 는 커서가 있을 때만 참", () => {
    const first = page(["j1"], null);
    expect(
      toListBody(
        [],
        first,
        { ...first, has_more: true, last_cursor: null },
        {
          first_id: null,
          last_id: null,
        },
      ).has_more,
    ).toBe(false);
  });
});

describe("collectFilteredPages", () => {
  const keepEven = async (rows: JobRow[]) =>
    rows.filter(r => Number(r.job_id.slice(1)) % 2 === 0);

  it("limit 를 채우면 더 받지 않는다", async () => {
    const fetchNext = vi.fn();
    const body = await collectFilteredPages(
      page(["j2", "j4"], "c1"),
      fetchNext,
      {
        limit: 2,
        maxPages: 5,
        keep: keepEven,
      },
    );
    expect(fetchNext).not.toHaveBeenCalled();
    expect(body).toMatchObject({
      has_more: true,
      last_cursor: "c1",
      first_id: "j2",
      last_id: "j4",
    });
  });

  it("모자라면 커서로 이어 받고 페이지를 통째로 합친다", async () => {
    const fetchNext = vi
      .fn()
      .mockResolvedValueOnce(page(["j3", "j4", "j6", "j8"], null));
    const body = await collectFilteredPages(
      page(["j1", "j2"], "c1"),
      fetchNext,
      {
        limit: 2,
        maxPages: 5,
        keep: keepEven,
      },
    );
    expect(fetchNext).toHaveBeenCalledWith("c1");
    expect(body.data.map(r => r.job_id)).toEqual(["j2", "j4", "j6", "j8"]);
    expect(body).toMatchObject({
      has_more: false,
      first_cursor: "first:j1",
      last_cursor: null,
    });
  });

  it("maxPages 에서 멈춘다", async () => {
    let n = 1;
    const fetchNext = vi.fn(async () => {
      n += 1;
      return page([`j${n * 2 - 1}`], `c${n}`);
    });
    const body = await collectFilteredPages(page(["j1"], "c1"), fetchNext, {
      limit: 20,
      maxPages: 3,
      keep: keepEven,
    });
    expect(fetchNext).toHaveBeenCalledTimes(2);
    expect(body).toMatchObject({ data: [], has_more: true, last_cursor: "c3" });
  });

  it("다음 페이지가 null 이면 직전 커서를 남긴다", async () => {
    const body = await collectFilteredPages(
      page(["j2"], "c1"),
      async () => null,
      { limit: 5, maxPages: 5, keep: keepEven },
    );
    expect(body).toMatchObject({ has_more: true, last_cursor: "c1" });
    expect(body.data).toHaveLength(1);
  });

  it("keep 이 던지면 전파한다", async () => {
    await expect(
      collectFilteredPages(page(["j1"], null), async () => null, {
        limit: 5,
        maxPages: 5,
        keep: async () => {
          throw new Error("db");
        },
      }),
    ).rejects.toThrow("db");
  });
});
