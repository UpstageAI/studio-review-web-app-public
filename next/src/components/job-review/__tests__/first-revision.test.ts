import { describe, expect, it, vi } from "vitest";

import type {
  JobRevision,
  JobRevisionPage,
  JobRevisionsQuery,
} from "@/lib/review-api/types";
import type { MachineTarget } from "@/lib/revision-history";

import { revision } from "../../../lib/revision-history/__tests__/helpers";
import { firstRevisionOf } from "../use-job-revisions";

const TARGET: MachineTarget = {
  type: "result",
  occurrenceId: "occ_extract_1",
  stepId: "st_extract",
};

/** v1 → v3 이력. `base_version` 0 인 v1 이 기계 출력을 담은 행이다. */
const ROWS: JobRevision[] = [1, 2, 3].map(version =>
  revision({ id: `rev_${version}`, version, base_version: version - 1 }),
);

/** 서버 흉내. `order` 를 따르고 `after` 다음부터 `limit` 행을 준다. */
function fakeServer(rows: JobRevision[]) {
  const calls: JobRevisionsQuery[] = [];
  const list = vi.fn(
    async (
      _collectionId: string,
      _jobId: string,
      query: JobRevisionsQuery = {},
    ): Promise<JobRevisionPage> => {
      calls.push(query);
      const asc = query.order === "asc";
      const sorted = [...rows].sort((a, b) =>
        asc ? a.version - b.version : b.version - a.version,
      );
      const start = query.after
        ? sorted.findIndex(row => row.id === query.after) + 1
        : 0;
      const limit = query.limit ?? 50;
      const data = sorted.slice(start, start + limit);
      return {
        data,
        has_more: start + limit < sorted.length,
        last_id: data.at(-1)?.id ?? null,
      };
    },
  );
  return { list, calls };
}

const signal = new AbortController().signal;

describe("firstRevisionOf", () => {
  it("order 를 따르는 서버면 오래된 순 1 행만 받는다", async () => {
    const { list, calls } = fakeServer(ROWS);
    const first = await firstRevisionOf(
      "scol_1",
      "job_1",
      TARGET,
      signal,
      list,
    );
    expect(first?.id).toBe("rev_1");
    expect(calls).toEqual([
      {
        occurrence_id: "occ_extract_1",
        order: "asc",
        limit: 1,
        include: "content",
      },
    ]);
  });

  it("머리 행이 base_version 0 이 아니어도 그대로 돌려주고 요청은 한 번이다", async () => {
    const { list, calls } = fakeServer(ROWS.slice(1));
    const first = await firstRevisionOf(
      "scol_1",
      "job_1",
      TARGET,
      signal,
      list,
    );
    expect(first?.id).toBe("rev_2");
    expect(first?.base_version).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it("이력이 없으면 null", async () => {
    const { list } = fakeServer([]);
    expect(
      await firstRevisionOf("scol_1", "job_1", TARGET, signal, list),
    ).toBeNull();
  });

  it("구조 대상은 type=structure 로 거른다", async () => {
    const { list, calls } = fakeServer([
      revision({ type: "structure", result: null }),
    ]);
    await firstRevisionOf(
      "scol_1",
      "job_1",
      { type: "structure" },
      signal,
      list,
    );
    expect(calls[0]).toMatchObject({ type: "structure", order: "asc" });
    expect(calls[0]).not.toHaveProperty("occurrence_id");
  });
});
