import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  buildQuery,
  createReviewImport,
  getReviewImport,
  getCollection,
  getFileHighlights,
  getFilePages,
  getJobFiles,
  getJobResponse,
  getReviewCapabilities,
  getReviewDocumentText,
  getReviewProgress,
  isAbortError,
  listCollections,
  requestText,
  listJobRows,
  setReviewStatus,
} from "../client";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function lastCall(): { url: string; init: RequestInit | undefined } {
  const [input, init] = fetchMock.mock.calls.at(-1)!;
  return { url: String(input), init };
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected rejection");
}

describe("buildQuery", () => {
  it("undefined·null·빈 문자열은 빼고 boolean·number 는 문자열로 만든다", () => {
    expect(
      buildQuery({
        kind: "documents",
        include_default: true,
        latest: false,
        limit: 20,
        q: "",
        after: undefined,
        before: null,
      }),
    ).toBe("?kind=documents&include_default=true&latest=false&limit=20");
  });

  it("값이 없으면 빈 문자열", () => {
    expect(buildQuery({})).toBe("");
    expect(buildQuery({ q: undefined })).toBe("");
  });

  it("값을 인코딩한다", () => {
    expect(buildQuery({ q: "보고서 a&b" })).toBe(
      "?q=%EB%B3%B4%EA%B3%A0%EC%84%9C+a%26b",
    );
  });
});

describe("요청 경로", () => {
  it("Collection 목록은 같은 origin 의 BFF 를 쿼리와 함께 부른다", async () => {
    const page = { object: "list", data: [{ id: "col_1" }], has_more: false };
    fetchMock.mockResolvedValueOnce(jsonResponse(page));

    const result = await listCollections({
      kind: "documents",
      include_default: true,
      limit: 20,
      after: "cur_1",
    });

    expect(result).toEqual(page);
    const { url, init } = lastCall();
    expect(url).toBe(
      "/api/search-collections?kind=documents&include_default=true&limit=20&after=cur_1",
    );
    expect(init?.method).toBe("GET");
    expect(init?.cache).toBe("no-store");
  });

  it("경로 세그먼트를 인코딩한다", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ id: "x" }));

    await getCollection("col/1");
    expect(lastCall().url).toBe("/api/search-collections/col%2F1");

    await getReviewCapabilities("col_1");
    expect(lastCall().url).toBe(
      "/api/search-collections/col_1/review-capabilities",
    );

    await getJobFiles("col_1", "job_a b");
    expect(lastCall().url).toBe(
      "/api/search-collections/col_1/source-jobs/job_a%20b/files",
    );
  });

  it("Job 행 쿼리를 upstream 이름 그대로 보낸다", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }));

    await listJobRows("col_1", {
      status: "completed",
      group_by: "input_files",
      latest: true,
      q: "invoice",
      order: "desc",
      limit: 20,
    });

    expect(lastCall().url).toBe(
      "/api/search-collections/col_1/source-jobs?status=completed&group_by=input_files&latest=true&q=invoice&order=desc&limit=20",
    );
  });

  it("signal 을 fetch 에 넘긴다", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }));
    const controller = new AbortController();

    await listCollections({}, { signal: controller.signal });

    expect(lastCall().init?.signal).toBe(controller.signal);
  });
});

describe("오류", () => {
  it("오류 envelope 을 ApiError 로 바꾼다", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: "invalid_value",
            type: "invalid_value",
            message: "limit is invalid",
            param: "limit",
          },
        },
        400,
      ),
    );

    const err = await caught(listCollections({ limit: 0 }));

    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 400,
      code: "invalid_value",
      message: "limit is invalid",
      param: "limit",
      retryAfter: null,
    });
  });

  it("Retry-After 헤더를 담는다", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: "rate_limited", message: "slow" } }, 429, {
        "Retry-After": "3",
      }),
    );

    const err = await caught(listCollections());

    expect(err).toMatchObject({
      status: 429,
      code: "rate_limited",
      retryAfter: "3",
      param: null,
    });
  });

  it("409 collection_source_type_unsupported 를 코드로 구분할 수 있다", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { error: { code: "collection_source_type_unsupported", message: "" } },
        409,
      ),
    );

    const err = await caught(listJobRows("col_1"));

    expect(err).toMatchObject({
      status: 409,
      code: "collection_source_type_unsupported",
    });
  });

  it("JSON 이 아닌 오류 본문은 http_error", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("<html>Bad gateway</html>", {
        status: 502,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const err = await caught(getCollection("col_1"));

    expect(err).toMatchObject({ status: 502, code: "http_error" });
  });

  it("envelope 모양이 아닌 JSON 오류도 http_error", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: "nope" }, 404));

    const err = await caught(getCollection("col_1"));

    expect(err).toMatchObject({ status: 404, code: "http_error" });
  });

  it("성공 응답이 JSON 이 아니면 invalid_response", async () => {
    fetchMock.mockResolvedValueOnce(new Response("not json", { status: 200 }));

    const err = await caught(getCollection("col_1"));

    expect(err).toMatchObject({ status: 200, code: "invalid_response" });
  });

  it("네트워크 실패는 status 0 의 network_error", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const err = await caught(getCollection("col_1"));

    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 0, code: "network_error" });
  });

  it("취소는 ApiError 로 바꾸지 않고 AbortError 를 그대로 던진다", async () => {
    const abort = new DOMException("aborted", "AbortError");
    fetchMock.mockRejectedValueOnce(abort);

    const err = await caught(getCollection("col_1"));

    expect(err).toBe(abort);
    expect(isAbortError(err)).toBe(true);
    expect(isAbortError(new ApiError(0, "network_error", ""))).toBe(false);
  });
});

describe("getReviewDocumentText", () => {
  it("본문을 파싱하지 않고 문자열과 ETag 로 돌려준다", async () => {
    const text = '{"n":12345678901234567890}';
    fetchMock.mockResolvedValue(
      new Response(text, {
        status: 200,
        headers: { "Content-Type": "application/json", ETag: '"v1"' },
      }),
    );
    const result = await getReviewDocumentText("scol_1", "job_1");
    expect(lastCall().url).toBe(
      "/api/search-collections/scol_1/review-document?job_ids=job_1",
    );
    expect(result).toEqual({ text, etag: '"v1"' });
  });

  it("오류 envelope 는 ApiError 로 던진다", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: { code: "review_target_not_found", message: "no" } },
        404,
      ),
    );
    const err = await caught(getReviewDocumentText("scol_1", "job_1"));
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 404, code: "review_target_not_found" });
  });
});

describe("requestText", () => {
  it("쿼리를 붙여 GET 하고 본문을 파싱하지 않는다", async () => {
    const text = '{"n":12345678901234567890,"total":1.10}';
    fetchMock.mockResolvedValue(
      new Response(text, { status: 200, headers: { ETag: '"e"' } }),
    );
    const result = await requestText("/api/x", {
      query: { a: 1, b: undefined, c: "z" },
    });
    expect(lastCall().url).toBe("/api/x?a=1&c=z");
    expect(lastCall().init).toMatchObject({ method: "GET", cache: "no-store" });
    expect(result).toEqual({ text, etag: '"e"' });
  });

  it("ETag 가 없으면 null", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    expect((await requestText("/api/x")).etag).toBeNull();
  });

  it("오류는 ApiError(retryAfter 포함), 네트워크 실패는 network_error", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: "busy", message: "" } }, 429, {
        "Retry-After": "3",
      }),
    );
    expect(await caught(requestText("/api/x"))).toMatchObject({
      status: 429,
      code: "busy",
      retryAfter: "3",
    });
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    expect(await caught(requestText("/api/x"))).toMatchObject({
      code: "network_error",
    });
  });

  it("취소는 AbortError 를 그대로 던진다", async () => {
    const abort = new DOMException("aborted", "AbortError");
    fetchMock.mockRejectedValue(abort);
    expect(await caught(requestText("/api/x"))).toBe(abort);
  });
});

describe("getFilePages", () => {
  it("refresh 면 refresh=1 을 붙인다", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ id: "file_1", pages: [] }),
    );
    await getFilePages("file_1");
    expect(lastCall().url).toBe("/api/files/file_1");
    await getFilePages("file_1", { refresh: true });
    expect(lastCall().url).toBe("/api/files/file_1?refresh=1");
  });
});

describe("getFileHighlights", () => {
  it("범위를 pages=a-b 로 보낸다", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ id: "file_1", pages: [] }),
    );
    const controller = new AbortController();
    await expect(
      getFileHighlights("file 1", {
        from: 21,
        to: 40,
        signal: controller.signal,
      }),
    ).resolves.toEqual({ id: "file_1", pages: [] });
    const { url, init } = lastCall();
    expect(url).toBe("/api/files/file%201/highlights?pages=21-40");
    expect(init?.signal).toBe(controller.signal);
  });
});

describe("getJobResponse", () => {
  it("Job 응답 BFF 를 부른다", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ output: [] }));
    await expect(getJobResponse("scol_1", "job 1")).resolves.toEqual({
      output: [],
    });
    expect(lastCall().url).toBe(
      "/api/search-collections/scol_1/source-jobs/job%201/response",
    );
  });
});

describe("createReviewImport · getReviewImport", () => {
  it("본문을 octet-stream 그대로, 멱등 키와 함께 보내고 Retry-After 를 돌려준다", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: "rvop_1", status: "pending" }, 202, {
        "Retry-After": "2",
      }),
    );
    const text = '{"format":"collection-results/11","n":12345678901234567890}';
    const result = await createReviewImport("scol 1", text, "key-1");
    const { url, init } = lastCall();
    expect(url).toBe("/api/search-collections/scol%201/review-imports");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(text);
    expect(init?.headers).toMatchObject({
      "Content-Type": "application/octet-stream",
      "Idempotency-Key": "key-1",
    });
    expect(result).toEqual({
      resource: { id: "rvop_1", status: "pending" },
      retryAfter: "2",
    });
  });

  it("오류 envelope 는 ApiError(code·Retry-After)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { error: { code: "operation_capacity_exceeded", message: "busy" } },
        429,
        { "Retry-After": "2" },
      ),
    );
    const err = await caught(createReviewImport("scol_1", "{}", "k"));
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 429,
      code: "operation_capacity_exceeded",
      retryAfter: "2",
    });
  });

  it("가져오기 상태를 GET 으로 읽는다", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: "rvop_1", status: "applied" }),
    );
    const result = await getReviewImport("scol_1", "rvop_1");
    expect(lastCall().url).toBe(
      "/api/search-collections/scol_1/review-imports/rvop_1",
    );
    expect(result.retryAfter).toBeNull();
    expect(result.resource).toEqual({ id: "rvop_1", status: "applied" });
  });
});

describe("setReviewStatus · getReviewProgress", () => {
  it("상태 변경은 PUT JSON 본문 { action } 으로 보내고 응답을 돌려준다", async () => {
    const record = {
      job_id: "job/1",
      review_status: "done",
      review_completed_at: "2026-10-29T00:00:00.000Z",
    };
    fetchMock.mockResolvedValue(jsonResponse(record));
    expect(await setReviewStatus("scol_1", "job/1", "complete")).toEqual(
      record,
    );
    const { url, init } = lastCall();
    expect(url).toBe(
      "/api/search-collections/scol_1/source-jobs/job%2F1/review-status",
    );
    expect(init?.method).toBe("PUT");
    expect(new Headers(init?.headers).get("content-type")).toBe(
      "application/json",
    );
    expect(JSON.parse(String(init?.body))).toEqual({ action: "complete" });
  });

  it("상태 변경 오류 envelope 는 ApiError", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "review_status_unavailable",
            message: "down",
            param: null,
          },
        },
        503,
      ),
    );
    await expect(
      setReviewStatus("scol_1", "job_1", "start"),
    ).rejects.toMatchObject({ status: 503, code: "review_status_unavailable" });
  });

  it("진행 현황은 review-progress 를 GET 한다", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ done: 2, in_progress: 1 }));
    expect(await getReviewProgress("scol_1")).toEqual({
      done: 2,
      in_progress: 1,
    });
    expect(lastCall().url).toBe(
      "/api/search-collections/scol_1/review-progress",
    );
  });
});
