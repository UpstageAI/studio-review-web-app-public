import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getFileWithPages } from "../files";

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

describe("getFileWithPages", () => {
  it("view=all·pages=all 로 파일을 GET 한다", async () => {
    await getFileWithPages("file_1");
    const [input, init] = fetchMock.mock.calls.at(-1)!;
    const url = new URL(String(input));
    expect(url.pathname).toBe("/v2/files/file_1");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      view: "all",
      pages: "all",
    });
    expect(init?.method).toBe("GET");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer test-key",
    );
  });
});
