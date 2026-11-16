import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isExactNumber } from "@/lib/review-model";

import { ApiError } from "../client";
import {
  getJobRevision,
  listJobRevisions,
  readJobRevision,
  readJobRevisionPage,
  revisionErrorKind,
  revisionRetryDelayMs,
} from "../revisions";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

function textResponse(text: string, status = 200, headers = {}) {
  return new Response(text, {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function lastUrl(): string {
  return String(fetchMock.mock.calls.at(-1)![0]);
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected rejection");
}

const ROW = {
  id: "rvn_1",
  object: "search_collection.job_revision",
  type: "result",
  version: 2,
  base_version: 1,
  published_at: 1_790_000_000,
  created_by: null,
  result: {
    occurrence_id: "occ_1",
    job_result_id: "jres_occ_1",
    step_id: "st_extract",
    step_name: "Extract",
    step_type: "extract",
    documents: [{ document_id: "doc_1", label: "invoice", field_group: "" }],
  },
  origin: null,
  operation: {
    id: "rvop_1",
    kind: "import",
    change_count: 2,
    collection_id: "scol_1",
    from_this_collection: true,
    reason: null,
    client_reference: null,
  },
};

const STRUCTURE_ROW = {
  ...ROW,
  id: "rvn_2",
  type: "structure",
  version: 1,
  base_version: 0,
  result: null,
};

function page(data: unknown[], extra = {}) {
  return JSON.stringify({
    object: "list",
    data,
    first_id: "rvn_1",
    last_id: "rvn_9",
    has_more: true,
    ...extra,
  });
}

describe("listJobRevisions", () => {
  it("쿼리를 직렬화해 BFF 경로를 부르고 행을 읽는다", async () => {
    fetchMock.mockResolvedValue(textResponse(page([ROW, STRUCTURE_ROW])));
    const result = await listJobRevisions("scol_1", "job_1", {
      type: "result",
      occurrence_id: "occ_1",
      after: "rvn_0",
      limit: 100,
      order: "asc",
      include: undefined,
    });
    expect(lastUrl()).toBe(
      "/api/search-collections/scol_1/source-jobs/job_1/revisions" +
        "?type=result&occurrence_id=occ_1&after=rvn_0&limit=100&order=asc",
    );
    expect(result).toMatchObject({
      object: "list",
      first_id: "rvn_1",
      last_id: "rvn_9",
      has_more: true,
    });
    expect(result.data.map(row => row.id)).toEqual(["rvn_1", "rvn_2"]);
    expect(result.data[0]).toMatchObject({
      result: {
        occurrence_id: "occ_1",
        documents: [{ document_id: "doc_1", field_group: "" }],
      },
      operation: { id: "rvop_1", kind: "import", change_count: 2 },
    });
    expect(result.data[1]!.result).toBeNull();
  });

  it("content 의 숫자 표기를 ExactNumber 로 보존한다", async () => {
    fetchMock.mockResolvedValue(
      textResponse(
        `{"object":"list","data":[${JSON.stringify(ROW).slice(0, -1)},"content":{"total":1.10,"n":12345678901234567890,"e":1E2},"base_content":{"total":1}}],"has_more":false}`,
      ),
    );
    const { data } = await listJobRevisions("scol_1", "job_1", {
      include: "content",
    });
    const content = data[0]!.content as Record<string, unknown>;
    // 값이 같은 표기(`1.10` = `1.1`)는 number 로, JS number 로 왕복되지 않는 수는 원문 그대로 둔다.
    expect(content.total).toBe(1.1);
    expect(isExactNumber(content.n)).toBe(true);
    expect(content.n).toMatchObject({ raw: "12345678901234567890" });
    expect(content.e).toMatchObject({ raw: "1E2" });
    expect(data[0]!.base_content).toEqual({ total: 1 });
  });

  it("필수 필드가 빠진 행은 버리고 last_id·has_more 는 유지한다", async () => {
    const noId: Record<string, unknown> = { ...ROW };
    delete noId.id;
    fetchMock.mockResolvedValue(
      textResponse(
        page([
          noId,
          { ...ROW, id: "rvn_a", operation: {} },
          { ...ROW, id: "rvn_b", type: "other" },
          { ...ROW, id: "rvn_c", result: null },
          ROW,
        ]),
      ),
    );
    const result = await listJobRevisions("scol_1", "job_1");
    expect(result.data.map(row => row.id)).toEqual(["rvn_1"]);
    expect(result.last_id).toBe("rvn_9");
    expect(result.has_more).toBe(true);
  });

  it("JSON 이 아니거나 목록이 아니면 invalid_response", async () => {
    fetchMock.mockResolvedValue(textResponse("<html>oops</html>"));
    expect(await caught(listJobRevisions("scol_1", "job_1"))).toMatchObject({
      code: "invalid_response",
    });
    fetchMock.mockResolvedValue(textResponse('{"data":{}}'));
    expect(await caught(listJobRevisions("scol_1", "job_1"))).toMatchObject({
      code: "invalid_response",
    });
  });

  it("429 는 ApiError(code, retryAfter) 이고 busy 로 분류한다", async () => {
    fetchMock.mockResolvedValue(
      textResponse(
        '{"error":{"code":"operation_capacity_exceeded","message":"busy"}}',
        429,
        { "Retry-After": "2" },
      ),
    );
    const err = await caught(listJobRevisions("scol_1", "job_1"));
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 429,
      code: "operation_capacity_exceeded",
      retryAfter: "2",
    });
    expect(revisionErrorKind(err)).toBe("busy");
    expect(revisionRetryDelayMs(err as ApiError)).toBe(2000);
  });

  it("gateway 의 비 JSON 404(upstream_error)는 unsupported", async () => {
    fetchMock.mockResolvedValue(
      textResponse(
        '{"error":{"code":"upstream_error","type":"upstream_error","message":"Not Found","param":null}}',
        404,
      ),
    );
    const err = await caught(listJobRevisions("scol_1", "job_1"));
    expect(revisionErrorKind(err)).toBe("unsupported");
  });

  it("취소는 AbortError 그대로 던진다", async () => {
    const abort = new DOMException("aborted", "AbortError");
    fetchMock.mockRejectedValue(abort);
    const controller = new AbortController();
    const err = await caught(
      listJobRevisions("scol_1", "job_1", {}, { signal: controller.signal }),
    );
    expect(err).toBe(abort);
    expect(revisionErrorKind(err)).toBe("aborted");
  });
});

describe("getJobRevision", () => {
  it("단건 경로를 부르고 content_omitted·content:null 을 보존한다", async () => {
    fetchMock.mockResolvedValue(
      textResponse(
        JSON.stringify({
          ...ROW,
          content: null,
          content_omitted: "too_large",
          base_content: { a: 1 },
          base_content_omitted: null,
        }),
        200,
        { ETag: '"rev-rvn_1"' },
      ),
    );
    const revision = await getJobRevision("scol_1", "job_1", "rvn/1");
    expect(lastUrl()).toBe(
      "/api/search-collections/scol_1/source-jobs/job_1/revisions/rvn%2F1",
    );
    expect(revision.content).toBeNull();
    expect(revision.content_omitted).toBe("too_large");
    expect(revision.base_content).toEqual({ a: 1 });
    expect(revision.base_content_omitted).toBeNull();
  });

  it("모양이 다르면 invalid_response", async () => {
    fetchMock.mockResolvedValue(textResponse('{"id":"rvn_1"}'));
    expect(
      await caught(getJobRevision("scol_1", "job_1", "rvn_1")),
    ).toMatchObject({ code: "invalid_response" });
  });

  it("404 revision_not_found 를 분류한다", async () => {
    fetchMock.mockResolvedValue(
      textResponse(
        '{"error":{"code":"revision_not_found","message":"no"}}',
        404,
      ),
    );
    const err = await caught(getJobRevision("scol_1", "job_1", "rvn_1"));
    expect(revisionErrorKind(err)).toBe("revision_not_found");
  });
});

describe("readJobRevision", () => {
  it("version·published_at 이 ExactNumber 면 버린다", () => {
    const page = readJobRevisionPage(
      `{"data":[${JSON.stringify(ROW).replace('"version":2', '"version":2e0')}],"has_more":false}`,
    );
    expect(page.data).toEqual([]);
  });

  it("content 키가 없으면 필드를 만들지 않는다", () => {
    const revision = readJobRevision(ROW);
    expect(revision).not.toBeNull();
    expect("content" in revision!).toBe(false);
    expect("base_content" in revision!).toBe(false);
  });
});

describe("revisionErrorKind", () => {
  it.each([
    [new ApiError(404, "source_job_not_found", ""), "not_found"],
    [new ApiError(404, "result_not_found", ""), "result_not_found"],
    [new ApiError(400, "invalid_cursor", ""), "invalid_cursor"],
    [new ApiError(429, "http_error", ""), "busy"],
    [new ApiError(404, "http_error", ""), "unsupported"],
    [new ApiError(500, "internal_error", ""), "retry"],
    [new ApiError(0, "network_error", ""), "retry"],
    [new Error("x"), "retry"],
  ])("%o → %s", (err, kind) => {
    expect(revisionErrorKind(err)).toBe(kind);
  });
});

describe("revisionRetryDelayMs", () => {
  it("Retry-After 가 없으면 2 초, 정수 초는 10 초 상한", () => {
    expect(revisionRetryDelayMs(new ApiError(429, "x", ""))).toBe(2000);
    expect(
      revisionRetryDelayMs(new ApiError(429, "x", "", { retryAfter: "60" })),
    ).toBe(10_000);
  });

  it("HTTP-date 는 now 기준 남은 시간", () => {
    const now = Date.parse("2026-11-06T00:00:00Z");
    const err = new ApiError(429, "x", "", {
      retryAfter: "Fri, 06 Nov 2026 00:00:03 GMT",
    });
    expect(revisionRetryDelayMs(err, now)).toBe(3000);
  });
});
