import { describe, expect, it } from "vitest";
import { parseReviewActivityQuery } from "../query";

const parse = (query: string) =>
  parseReviewActivityQuery(new URLSearchParams(query));

describe("parseReviewActivityQuery", () => {
  it("없으면 limit 8, jobs 없음", () => {
    expect(parse("")).toEqual({ ok: true, query: { limit: 8, jobs: [] } });
  });

  it("limit 는 1 ~ 20 정수만 받는다", () => {
    expect(parse("limit=1")).toMatchObject({ ok: true, query: { limit: 1 } });
    expect(parse("limit=20")).toMatchObject({ ok: true, query: { limit: 20 } });
    for (const bad of [
      "0",
      "21",
      "-1",
      "1.5",
      "abc",
      "",
      "1e1",
      " 5",
      "0005",
    ]) {
      expect(parse(`limit=${encodeURIComponent(bad)}`)).toMatchObject({
        ok: false,
        param: "limit",
      });
    }
  });

  it("jobs 는 collectionId:jobId 목록이고 같은 것은 한 번만", () => {
    expect(parse("jobs=scol_1:job_1,scol_2:job-2,scol_1:job_1,")).toEqual({
      ok: true,
      query: {
        limit: 8,
        jobs: [
          { collectionId: "scol_1", jobId: "job_1" },
          { collectionId: "scol_2", jobId: "job-2" },
        ],
      },
    });
  });

  it("모양이 틀린 jobs 는 400 대상", () => {
    for (const bad of ["scol_1", "scol_1:", ":job_1", "a:b:c", "../x:job_1"]) {
      expect(parse(`jobs=${encodeURIComponent(bad)}`)).toMatchObject({
        ok: false,
        param: "jobs",
      });
    }
  });

  it("jobs 는 10 개까지", () => {
    const keys = (n: number) =>
      Array.from({ length: n }, (_, i) => `scol_1:job_${i}`).join(",");
    expect(parse(`jobs=${keys(10)}`)).toMatchObject({ ok: true });
    expect(parse(`jobs=${keys(11)}`)).toMatchObject({
      ok: false,
      param: "jobs",
    });
  });
});
