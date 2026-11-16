import { describe, expect, it, vi } from "vitest";

import type {
  JobRevision,
  JobRevisionPage,
  JobRevisionsQuery,
} from "@/lib/review-api/types";

import { revision } from "../../../lib/revision-history/__tests__/helpers";
import {
  OPERATION_PAGE_LIMIT,
  OPERATION_PAGE_MAX,
  operationRowsOf,
} from "../use-job-revisions";

const signal = new AbortController().signal;

const rowsOf = (count: number): JobRevision[] =>
  Array.from({ length: count }, (_, index) =>
    revision({ id: `rev_${index + 1}`, version: index + 1 }),
  );

/** 서버 흉내. `after` 다음부터 `limit` 행을 준다. */
function fakeServer(rows: JobRevision[]) {
  const calls: JobRevisionsQuery[] = [];
  const list = vi.fn(
    async (
      _collectionId: string,
      _jobId: string,
      query: JobRevisionsQuery = {},
    ): Promise<JobRevisionPage> => {
      calls.push(query);
      const start = query.after
        ? rows.findIndex(row => row.id === query.after) + 1
        : 0;
      const limit = query.limit ?? 50;
      const data = rows.slice(start, start + limit);
      return {
        data,
        has_more: start + limit < rows.length,
        last_id: data.at(-1)?.id ?? null,
      };
    },
  );
  return { list, calls };
}

describe("operationRowsOf", () => {
  it("has_more 가 false 가 될 때까지 20 행씩 따라간다", async () => {
    const { list, calls } = fakeServer(rowsOf(45));
    const rows = await operationRowsOf(
      "scol_1",
      "job_1",
      "rvop_1",
      signal,
      list,
    );
    expect(rows.map(row => row.id)).toEqual(rowsOf(45).map(row => row.id));
    expect(calls).toEqual([
      {
        operation_id: "rvop_1",
        include: "content",
        limit: OPERATION_PAGE_LIMIT,
        after: undefined,
      },
      {
        operation_id: "rvop_1",
        include: "content",
        limit: OPERATION_PAGE_LIMIT,
        after: "rev_20",
      },
      {
        operation_id: "rvop_1",
        include: "content",
        limit: OPERATION_PAGE_LIMIT,
        after: "rev_40",
      },
    ]);
  });

  it("커서가 나아가지 않으면(last_id === after) 멈춘다", async () => {
    const page: JobRevisionPage = {
      data: [revision({ id: "rev_1" })],
      has_more: true,
      last_id: "rev_1",
    };
    const list = vi.fn(async () => page);
    const rows = await operationRowsOf(
      "scol_1",
      "job_1",
      "rvop_1",
      signal,
      list,
    );
    expect(list).toHaveBeenCalledTimes(2);
    expect(rows).toHaveLength(2);
  });

  it("최대 페이지 수에서 멈춘다", async () => {
    let n = 0;
    const list = vi.fn(async (): Promise<JobRevisionPage> => {
      n += 1;
      return {
        data: [revision({ id: `rev_${n}` })],
        has_more: true,
        last_id: `rev_${n}`,
      };
    });
    const rows = await operationRowsOf(
      "scol_1",
      "job_1",
      "rvop_1",
      signal,
      list,
    );
    expect(list).toHaveBeenCalledTimes(OPERATION_PAGE_MAX);
    expect(rows).toHaveLength(OPERATION_PAGE_MAX);
  });

  it("행이 없으면 빈 배열", async () => {
    const { list, calls } = fakeServer([]);
    expect(
      await operationRowsOf("scol_1", "job_1", "rvop_1", signal, list),
    ).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});
