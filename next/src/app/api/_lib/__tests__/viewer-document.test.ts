import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ELEMENTS_CONCURRENCY,
  ELEMENTS_MAX_BYTES,
  HIGHLIGHT_VALUE_MAX_LENGTH,
  PARSE_CATEGORY_COLORS,
  fileIdOf,
  filePagesOf,
  mapWithLimit,
  readElements,
  safeImageUrl,
  toFileHighlights,
  toFilePagesResponse,
  toHighlights,
} from "../viewer-document";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const box = [
  { x: 0.1, y: 0.1 },
  { x: 0.5, y: 0.1 },
  { x: 0.5, y: 0.2 },
  { x: 0.1, y: 0.2 },
];

const element = (id: number, category: string, text = "hello") => ({
  id,
  category,
  content: { text, html: `<p>${text}</p>` },
  coordinates: box,
  image_url: "https://storage.test/crop.png?sig=1",
});

describe("readElements", () => {
  it("JSON 문자열을 읽는다", async () => {
    const elements = await readElements({
      elements: JSON.stringify([element(1, "paragraph")]),
    });
    expect(elements).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("배열과 감싼 객체(elements·content.elements·data)를 읽는다", async () => {
    expect(
      await readElements({ elements: [element(1, "table")] }),
    ).toHaveLength(1);
    expect(
      await readElements({ elements: { elements: [element(1, "table")] } }),
    ).toHaveLength(1);
    expect(
      await readElements({
        elements: { content: { elements: [element(1, "table")] } },
      }),
    ).toHaveLength(1);
    expect(
      await readElements({ elements: { data: [element(1, "table")] } }),
    ).toHaveLength(1);
  });

  it("https URL 이면 결과 JSON 을 받아 읽는다", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ elements: [element(1, "figure")] }),
    );
    const elements = await readElements({
      elements: "https://storage.test/elements.json?sig=1",
    });
    expect(elements).toHaveLength(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      "https://storage.test/elements.json?sig=1",
    );
  });

  it("https·data 가 아닌 URL 은 받지 않고, 실패한 URL 은 빈 배열", async () => {
    expect(
      await readElements({ elements: "http://storage.test/e.json" }),
    ).toEqual([]);
    expect(await readElements({ elements: "file:///etc/passwd" })).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue(new Response("expired", { status: 403 }));
    expect(
      await readElements({ elements: "https://storage.test/e.json" }),
    ).toEqual([]);

    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    expect(
      await readElements({ elements_url: "https://storage.test/e.json" }),
    ).toEqual([]);
  });

  /** `chunk` 바이트씩 `count` 번 내보내는 본문. 몇 번 읽혔는지와 취소 여부를 센다. */
  function chunkedBody(chunk: number, count: number) {
    const seen = { pulls: 0, cancelled: false };
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        seen.pulls += 1;
        if (seen.pulls > count) controller.close();
        else controller.enqueue(new Uint8Array(chunk).fill(0x20));
      },
      cancel() {
        seen.cancelled = true;
      },
    });
    return { stream, seen };
  }

  it("content-length 가 상한을 넘으면 본문을 읽지 않고 빈 배열", async () => {
    const { stream, seen } = chunkedBody(1024, 1);
    fetchMock.mockResolvedValue(
      new Response(stream, {
        headers: { "content-length": String(ELEMENTS_MAX_BYTES + 1) },
      }),
    );
    expect(
      await readElements({ elements: "https://storage.test/e.json" }),
    ).toEqual([]);
    expect(seen.cancelled).toBe(true);
  });

  it("읽은 본문이 상한을 넘으면 거기서 멈추고 빈 배열", async () => {
    const chunk = 1024 * 1024;
    const { stream, seen } = chunkedBody(chunk, 100);
    fetchMock.mockResolvedValue(new Response(stream));
    expect(
      await readElements({ elements: "https://storage.test/e.json" }),
    ).toEqual([]);
    expect(seen.cancelled).toBe(true);
    expect(seen.pulls).toBeLessThan(100);
    expect(seen.pulls).toBeGreaterThan(ELEMENTS_MAX_BYTES / chunk);
  });
});

describe("toHighlights", () => {
  it("id 는 p{page}-{elementId}, 종류별 색, 좌표가 셋 미만이면 뺀다", () => {
    const highlights = toHighlights(
      [
        element(7, "table"),
        { ...element(8, "paragraph"), coordinates: box.slice(0, 2) },
        { ...element(9, "heading1"), coordinates: [{ x: "1", y: 2 }] },
        { category: "caption", content: { text: "c" }, coordinates: box },
      ],
      3,
    );
    expect(highlights.map(h => h.id)).toEqual(["p3-7", "p3-3"]);
    expect(highlights[0]).toMatchObject({
      page: 3,
      _value: "hello",
      color: PARSE_CATEGORY_COLORS.table,
    });
    expect(highlights[1]!.color).toBe(PARSE_CATEGORY_COLORS.other);
  });

  it("_value 를 120 자로 자르고 text 가 없으면 markdown·html 을 쓴다", () => {
    const long = "가".repeat(300);
    const [first, second] = toHighlights(
      [
        element(1, "paragraph", long),
        { id: 2, content: { html: "<b>A</b>  <i>B</i>" }, coordinates: box },
      ],
      1,
    );
    expect(Array.from(String(first!._value))).toHaveLength(
      HIGHLIGHT_VALUE_MAX_LENGTH,
    );
    expect(String(first!._value).endsWith("…")).toBe(true);
    expect(second!._value).toBe("A B");
  });
});

describe("safeImageUrl", () => {
  it("https 만 남긴다", () => {
    expect(safeImageUrl("https://storage.test/p1.png?sig=1")).toBe(
      "https://storage.test/p1.png?sig=1",
    );
    expect(safeImageUrl("javascript:alert(1)")).toBeNull();
    expect(safeImageUrl("http://storage.test/p1.png")).toBeNull();
    expect(safeImageUrl("not a url")).toBeNull();
    expect(safeImageUrl(null)).toBeNull();
  });

  it("플래그가 없으면 loopback http 도 거른다", () => {
    expect(safeImageUrl("http://127.0.0.1:4010/p.svg")).toBeNull();
    vi.stubEnv("UPSTAGE_ALLOW_HTTP_IMAGE_URLS", "0");
    expect(safeImageUrl("http://localhost:4010/p.svg")).toBeNull();
  });

  it("플래그가 1 이면 loopback http 만 통과하고 https 는 그대로", () => {
    vi.stubEnv("UPSTAGE_ALLOW_HTTP_IMAGE_URLS", "1");
    expect(safeImageUrl("http://127.0.0.1:4010/pages/f/1.svg")).toBe(
      "http://127.0.0.1:4010/pages/f/1.svg",
    );
    expect(safeImageUrl("http://localhost:4010/p.svg")).toBe(
      "http://localhost:4010/p.svg",
    );
    expect(safeImageUrl("http://[::1]:4010/p.svg")).toBe(
      "http://[::1]:4010/p.svg",
    );
    expect(safeImageUrl("http://10.0.0.5/p.svg")).toBeNull();
    expect(safeImageUrl("http://example.test/p.svg")).toBeNull();
    expect(safeImageUrl("http://127.0.0.1.example.test/p.svg")).toBeNull();
    expect(safeImageUrl("https://storage.test/p1.png?sig=1")).toBe(
      "https://storage.test/p1.png?sig=1",
    );
    expect(safeImageUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("toFilePagesResponse", () => {
  const upstreamFile = {
    id: "file_1",
    object: "file",
    status: "READY",
    filename: "a.pdf",
    num_pages: 2,
    file_url: "https://storage.test/original.pdf?sig=1",
    pages: [
      {
        id: "page_1",
        idx: 1,
        image_url: "https://storage.test/p1.png?sig=1",
        elements: JSON.stringify([element(1, "table"), element(2, "figure")]),
      },
      { id: "page_2", idx: 2, image_url: null, elements: "[]" },
    ],
  };

  it("이미지 URL 만 담고 요소는 읽지 않는다(fetch 없음, highlights 키 없음)", () => {
    const body = toFilePagesResponse("file_1", {
      ...upstreamFile,
      pages: upstreamFile.pages.map(page => ({
        ...page,
        elements: "https://storage.test/elements.json?sig=1",
      })),
    });
    expect(body).toEqual({
      id: "file_1",
      status: "READY",
      filename: "a.pdf",
      num_pages: 2,
      pages: [
        { image_url: "https://storage.test/p1.png?sig=1" },
        { image_url: null },
      ],
    });
    expect(fetchMock).not.toHaveBeenCalled();
    const text = JSON.stringify(body);
    expect(text).not.toContain("original.pdf");
    expect(text).not.toContain("crop.png");
    expect(text).not.toContain("elements");
    expect(text).not.toContain("highlights");
  });

  it("data·file 로 감싼 응답과 페이지 없는 응답을 읽는다", () => {
    expect(
      toFilePagesResponse("file_1", { data: upstreamFile }).pages,
    ).toHaveLength(2);
    expect(filePagesOf({ file: upstreamFile })).toHaveLength(2);
    expect(toFilePagesResponse("file_9", { status: "UPLOADED" })).toEqual({
      id: "file_9",
      status: "UPLOADED",
      num_pages: null,
      pages: [],
    });
    expect(fileIdOf("file_9", { status: "UPLOADED" })).toBe("file_9");
    expect(fileIdOf("file_9", upstreamFile)).toBe("file_1");
  });
});

describe("toFileHighlights", () => {
  const pagesWith = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      image_url: `https://storage.test/p${i + 1}.png`,
      elements: JSON.stringify([element(i + 1, "paragraph", `p${i + 1}`)]),
    }));

  it("범위 안에서 파일에 있는 페이지만, 페이지 순서로, id 는 그 페이지 번호로", async () => {
    const pages = await toFileHighlights({ pages: pagesWith(5) }, 4, 20);
    expect(pages.map(page => page.page)).toEqual([4, 5]);
    expect(pages[0]!.highlights[0]).toMatchObject({
      id: "p4-4",
      page: 4,
      _value: "p4",
    });
    expect(pages[1]!.highlights[0]!.id).toBe("p5-5");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("범위가 파일 밖이거나 비어 있으면 빈 배열, 요소 없는 페이지는 빈 하이라이트", async () => {
    expect(await toFileHighlights({ pages: pagesWith(3) }, 10, 12)).toEqual([]);
    expect(await toFileHighlights({ status: "UPLOADED" }, 1, 20)).toEqual([]);
    const [page] = await toFileHighlights(
      { pages: [{ image_url: null, elements: "[]" }] },
      1,
      1,
    );
    expect(page).toEqual({ page: 1, highlights: [] });
  });

  it("요소 URL 은 한 번에 ELEMENTS_CONCURRENCY 개까지만 읽는다", async () => {
    let running = 0;
    let peak = 0;
    fetchMock.mockImplementation(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise(resolve => setTimeout(resolve, 2));
      running -= 1;
      return Response.json({ elements: [element(1, "table")] });
    });
    const pages = await toFileHighlights(
      {
        pages: Array.from({ length: 20 }, (_, i) => ({
          elements: `https://storage.test/e${i + 1}.json`,
        })),
      },
      1,
      20,
    );
    expect(pages).toHaveLength(20);
    expect(fetchMock).toHaveBeenCalledTimes(20);
    expect(peak).toBeLessThanOrEqual(ELEMENTS_CONCURRENCY);
    expect(peak).toBeGreaterThan(1);
  });
});

describe("mapWithLimit", () => {
  it("입력 순서를 지키고 동시 실행을 limit 으로 막는다", async () => {
    let running = 0;
    let peak = 0;
    const order: number[] = [];
    const result = await mapWithLimit(
      [5, 1, 3, 2, 4],
      2,
      async (item, index) => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise(resolve => setTimeout(resolve, item));
        running -= 1;
        order.push(index);
        return item * 10;
      },
    );
    expect(result).toEqual([50, 10, 30, 20, 40]);
    expect(peak).toBe(2);
    expect(order).not.toEqual([0, 1, 2, 3, 4]);
  });

  it("빈 입력은 빈 배열, 거부는 전파된다", async () => {
    expect(await mapWithLimit([], 3, async () => 1)).toEqual([]);
    await expect(
      mapWithLimit([1, 2, 3], 2, async item => {
        if (item === 2) throw new Error("boom");
        return item;
      }),
    ).rejects.toThrow("boom");
  });
});
