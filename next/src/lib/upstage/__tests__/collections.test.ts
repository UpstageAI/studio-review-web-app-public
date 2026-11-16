import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getSearchCollection,
  listSearchCollections,
  getSourceJobResponse,
  listSourceJobFiles,
  listSourceJobs,
} from "../collections";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("UPSTAGE_API_KEY", "test-key");
  vi.stubEnv("UPSTAGE_CONSOLE_API_URL", "https://example.test");
  fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function lastCall(): { url: URL; init: RequestInit; headers: Headers } {
  const [input, init] = fetchMock.mock.calls.at(-1)!;
  return {
    url: new URL(String(input)),
    init: init ?? {},
    headers: new Headers(init?.headers),
  };
}

describe("listSearchCollections", () => {
  it("쿼리를 문자열로 보내고 undefined 는 생략한다", async () => {
    await listSearchCollections({
      kind: "documents",
      include_default: true,
      limit: 20,
      q: undefined,
    });
    const { url, init, headers } = lastCall();
    expect(url.pathname).toBe("/v2/search-collections");
    expect(init.method).toBe("GET");
    expect(headers.get("authorization")).toBe("Bearer test-key");
    expect([...url.searchParams.entries()]).toEqual([
      ["kind", "documents"],
      ["include_default", "true"],
      ["limit", "20"],
    ]);
  });

  it("쿼리가 없으면 쿼리 문자열도 없다", async () => {
    await listSearchCollections();
    expect(lastCall().url.search).toBe("");
  });
});

describe("getSearchCollection", () => {
  it("Collection 상세를 GET 한다", async () => {
    await getSearchCollection("scol_1");
    expect(lastCall().url.pathname).toBe("/v2/search-collections/scol_1");
  });
});

describe("listSourceJobs", () => {
  it("group_by·latest·status 를 upstream 이름 그대로 보낸다", async () => {
    await listSourceJobs("scol_1", {
      status: "completed",
      group_by: "input_files",
      latest: false,
      order: "desc",
      after: "cur_1",
      config_id: undefined,
    });
    const { url } = lastCall();
    expect(url.pathname).toBe("/v2/search-collections/scol_1/source-jobs");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      status: "completed",
      group_by: "input_files",
      latest: "false",
      order: "desc",
      after: "cur_1",
    });
  });
});

describe("listSourceJobFiles", () => {
  it("Job 입력 파일 목록을 GET 한다", async () => {
    await listSourceJobFiles("scol_1", "job_1");
    expect(lastCall().url.pathname).toBe(
      "/v2/search-collections/scol_1/source-jobs/job_1/files",
    );
  });
});

describe("getSourceJobResponse", () => {
  it("Job 응답을 GET 한다", async () => {
    await getSourceJobResponse("scol_1", "job_1");
    const { url, init } = lastCall();
    expect(url.pathname).toBe(
      "/v2/search-collections/scol_1/source-jobs/job_1/response",
    );
    expect(init.method ?? "GET").toBe("GET");
  });
});
