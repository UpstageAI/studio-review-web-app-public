import { describe, expect, it } from "vitest";

import { upstageEndpoints } from "../endpoints";

const { searchCollections, agents, files, responses } = upstageEndpoints;

describe("upstageEndpoints", () => {
  it("모든 빌더가 /v2/ 로 시작하는 경로를 만든다", () => {
    const paths = [
      searchCollections.list(),
      searchCollections.detail("scol_1"),
      searchCollections.sourceJobFiles("scol_1", "job_1"),
      searchCollections.reviewCapabilities("scol_1"),
      searchCollections.reviewDocument("scol_1"),
      searchCollections.reviewImports("scol_1"),
      searchCollections.reviewImport("scol_1", "imp_1"),
      searchCollections.sourceJobs("scol_1"),
      searchCollections.sourceJobResponse("scol_1", "job_1"),
      searchCollections.resultContextSearch("scol_1"),
      searchCollections.bindings("scol_1"),
      searchCollections.sourceJobSearch("scol_1"),
      searchCollections.sourceJobRevisions("scol_1", "job_1"),
      searchCollections.sourceJobRevision("scol_1", "job_1", "rvn_1"),
      agents.config("agt_1", "cfg_1"),
      files.file("file_1"),
      responses.response("job_1"),
    ];
    for (const path of paths) expect(path.startsWith("/v2/")).toBe(true);
  });

  it("spec 경로와 같은 모양을 만든다", () => {
    expect(searchCollections.list()).toBe("/v2/search-collections");
    expect(searchCollections.detail("scol_1")).toBe(
      "/v2/search-collections/scol_1",
    );
    expect(searchCollections.sourceJobFiles("scol_1", "job_1")).toBe(
      "/v2/search-collections/scol_1/source-jobs/job_1/files",
    );
    expect(searchCollections.reviewDocument("scol_1")).toBe(
      "/v2/search-collections/scol_1/review-document",
    );
    expect(searchCollections.reviewImport("scol_1", "imp_1")).toBe(
      "/v2/search-collections/scol_1/review-imports/imp_1",
    );
    expect(searchCollections.sourceJobResponse("scol_1", "job_1")).toBe(
      "/v2/search-collections/scol_1/source-jobs/job_1/response",
    );
    expect(searchCollections.sourceJobRevisions("scol_1", "job_1")).toBe(
      "/v2/search-collections/scol_1/source-jobs/job_1/revisions",
    );
    expect(
      searchCollections.sourceJobRevision("scol_1", "job_1", "rvn_1"),
    ).toBe("/v2/search-collections/scol_1/source-jobs/job_1/revisions/rvn_1");
  });

  it("세그먼트를 인코딩한다", () => {
    expect(searchCollections.reviewCapabilities("a/b")).toBe(
      "/v2/search-collections/a%2Fb/review-capabilities",
    );
    expect(searchCollections.detail("a/b")).toBe(
      "/v2/search-collections/a%2Fb",
    );
    expect(searchCollections.sourceJobFiles("scol_1", "j/../x")).toBe(
      "/v2/search-collections/scol_1/source-jobs/j%2F..%2Fx/files",
    );
    expect(
      searchCollections.sourceJobRevision("scol_1", "job_1", "r/../x"),
    ).toBe(
      "/v2/search-collections/scol_1/source-jobs/job_1/revisions/r%2F..%2Fx",
    );
    expect(searchCollections.reviewImport("scol_1", "x?y#z")).toBe(
      "/v2/search-collections/scol_1/review-imports/x%3Fy%23z",
    );
  });

  it("`../` 가 경로를 거슬러 오르지 않는다", () => {
    const path = searchCollections.reviewCapabilities("../../files/x");
    const url = new URL(path, "https://example.test");
    expect(url.pathname).toBe(
      "/v2/search-collections/..%2F..%2Ffiles%2Fx/review-capabilities",
    );
  });
});
