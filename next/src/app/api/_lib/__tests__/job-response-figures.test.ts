import { describe, expect, it } from "vitest";

import { FIGURE_URL_PATTERN } from "@/lib/review-api/parse-highlights";

import {
  FIGURE_KEY_PATTERN,
  JOB_RESPONSE_MAX_BYTES,
  extractFigures,
  figureUrl,
  sniffImageType,
} from "../job-response-figures";

const IDS = { collectionId: "scol_1", jobId: "job_1" };

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const GIF = Buffer.from("GIF89a\u0000\u0000", "latin1");
const WEBP = Buffer.from("RIFF\u0000\u0000\u0000\u0000WEBPVP8 ", "latin1");

const box = [
  { x: 0.1, y: 0.1 },
  { x: 0.2, y: 0.1 },
  { x: 0.2, y: 0.2 },
];

/** 실데이터 모양: Parse 출력은 message `text` 안의 JSON 문자열, Extract `text` 에는 큰 정수. */
function realShapedResponse(figures: [string, string][]) {
  return (
    '{"id":"job_1","output":[' +
    JSON.stringify({
      type: "message",
      id: "res_parse",
      step_type: "document-parse",
      content: [
        {
          type: "output_text",
          text: JSON.stringify({
            api: "2.0",
            elements: [
              ...figures.map(([id, base64], index) => ({
                id,
                page: index + 1,
                category: "figure",
                content: { text: "![image](/image/placeholder)" },
                coordinates: box,
                base64_encoding: base64,
              })),
              {
                id: 99,
                page: 1,
                category: "paragraph",
                content: { text: "본문" },
                coordinates: box,
                base64_encoding: null,
              },
              {
                id: 100,
                page: 1,
                category: "table",
                content: { text: "표" },
                coordinates: box,
                base64_encoding: "",
              },
            ],
          }),
        },
      ],
    }) +
    ',{"id":"r1","step_type":"information-extract","content":[{"type":"output_text","text":"{\\"n\\":12345678901234567890}"}]}' +
    '],"n":12345678901234567890}'
  );
}

/** 바뀐 본문을 실제 클라이언트처럼 두 번 파싱해 Parse 요소를 꺼낸다. */
function parseElementsOf(text: string): Record<string, unknown>[] {
  const body = JSON.parse(text) as {
    output: { content?: { text: string }[] }[];
  };
  const parse = JSON.parse(body.output[0]!.content![0]!.text) as {
    elements: Record<string, unknown>[];
  };
  return parse.elements;
}

describe("extractFigures", () => {
  it("JSON 문자열 안의 그림 두 개를 f1·f2 로 떼고 나머지 바이트는 그대로 둔다", () => {
    const input = realShapedResponse([
      ["0", PNG.toString("base64")],
      ["1", JPEG.toString("base64")],
    ]);
    const { text, figures } = extractFigures(input, IDS);

    expect(figures.map(figure => [figure.key, figure.contentType])).toEqual([
      ["f1", "image/png"],
      ["f2", "image/jpeg"],
    ]);
    expect(Buffer.from(figures[0]!.bytes).equals(PNG)).toBe(true);
    expect(Buffer.from(figures[1]!.bytes).equals(JPEG)).toBe(true);
    // 그림 바이트는 공유 풀이 아닌 자기 ArrayBuffer 에 있다(캐시 바이트 계산·보관용).
    expect(figures[0]!.bytes.buffer.byteLength).toBe(PNG.byteLength);

    // 그림 두 개의 base64_encoding 은 사라지고 null·"" 두 개만 남는다(아래에서 그대로인지 본다).
    expect(text.match(/base64_encoding/g)).toHaveLength(2);
    // 그림 밖은 바이트 그대로: 큰 정수 토큰과 Extract text.
    expect(text.endsWith('],"n":12345678901234567890}')).toBe(true);
    expect(text).toContain('"text":"{\\"n\\":12345678901234567890}"');
    const [first, second, paragraph, table] = parseElementsOf(text);
    expect(first!.figure_url).toBe(figureUrl("scol_1", "job_1", "f1"));
    expect(second!.figure_url).toBe(figureUrl("scol_1", "job_1", "f2"));
    expect(FIGURE_URL_PATTERN.test(first!.figure_url as string)).toBe(true);
    expect(first!.base64_encoding).toBeUndefined();
    // null 과 "" 는 손대지 않는다.
    expect(paragraph!.base64_encoding).toBeNull();
    expect(table!.base64_encoding).toBe("");
    expect("figure_url" in paragraph!).toBe(false);
    expect("figure_url" in table!).toBe(false);
    // 바뀐 본문은 원본과 요소 수·순서가 같다.
    expect(parseElementsOf(text).map(e => e.id)).toEqual(
      parseElementsOf(input).map(e => e.id),
    );
  });

  it("객체 형태(이스케이프 없음)도 떼고 공백을 보존한다", () => {
    const input =
      '{"elements":[{"id":1, "base64_encoding" : "' +
      GIF.toString("base64") +
      '" , "page":1},{"id":2,"base64_encoding":"' +
      WEBP.toString("base64") +
      '"}]}';
    const { text, figures } = extractFigures(input, IDS);
    expect(figures.map(figure => [figure.key, figure.contentType])).toEqual([
      ["f1", "image/gif"],
      ["f2", "image/webp"],
    ]);
    expect(text).toBe(
      '{"elements":[{"id":1, "figure_url" : "' +
        figureUrl("scol_1", "job_1", "f1") +
        '" , "page":1},{"id":2,"figure_url":"' +
        figureUrl("scol_1", "job_1", "f2") +
        '"}]}',
    );
    expect(JSON.parse(text)).toMatchObject({
      elements: [{ id: 1, page: 1 }, { id: 2 }],
    });
  });

  it("이스케이프된 `\\/` 는 복원해 디코드하므로 결과 바이트가 같다", () => {
    const base64 = Buffer.from([0xff, 0xd8, 0xff, 0xff, 0xfe, 0xfd]).toString(
      "base64",
    );
    expect(base64).toContain("/");
    const escaped = base64.replaceAll("/", "\\/");
    const plain = extractFigures(
      `{"text":"{\\"base64_encoding\\":\\"${base64}\\"}"}`,
      IDS,
    );
    const slashed = extractFigures(
      `{"text":"{\\"base64_encoding\\":\\"${escaped}\\"}"}`,
      IDS,
    );
    expect(plain.figures).toHaveLength(1);
    expect(slashed.figures).toHaveLength(1);
    expect(
      Buffer.from(slashed.figures[0]!.bytes).equals(
        Buffer.from(plain.figures[0]!.bytes),
      ),
    ).toBe(true);
    expect(JSON.parse(JSON.parse(slashed.text).text)).toEqual({
      figure_url: figureUrl("scol_1", "job_1", "f1"),
    });
  });

  it("매치가 없으면 입력 문자열 그대로(같은 참조)", () => {
    const input = '{"id":"job_1","output":[],"n":12345678901234567890}';
    const result = extractFigures(input, IDS);
    expect(result.text).toBe(input);
    expect(result.figures).toEqual([]);
    // 값에 base64 가 아닌 글자가 섞이면 손대지 않는다(브라우저 폴백).
    const odd = '{"base64_encoding":"not base64 at all!"}';
    expect(extractFigures(odd, IDS).text).toBe(odd);
    // 디코드 결과가 0 바이트인 값도 그대로.
    const empty = '{"base64_encoding":"="}';
    expect(extractFigures(empty, IDS).text).toBe(empty);
  });

  it("같은 본문을 다시 돌리면 같은 키 순서", () => {
    const input = realShapedResponse([
      ["a", PNG.toString("base64")],
      ["b", GIF.toString("base64")],
      ["c", WEBP.toString("base64")],
    ]);
    const first = extractFigures(input, IDS);
    const second = extractFigures(input, IDS);
    expect(second.text).toBe(first.text);
    expect(second.figures.map(figure => figure.key)).toEqual([
      "f1",
      "f2",
      "f3",
    ]);
  });

  it("Collection·Job id 를 URL 에 넣고 키는 FIGURE_KEY_PATTERN 에 맞다", () => {
    expect(figureUrl("scol_a-b", "job_1", "f12")).toBe(
      "/api/search-collections/scol_a-b/source-jobs/job_1/figures/f12",
    );
    expect(FIGURE_KEY_PATTERN.test("f1")).toBe(true);
    expect(FIGURE_KEY_PATTERN.test("f999999")).toBe(true);
    expect(FIGURE_KEY_PATTERN.test("f1234567")).toBe(false);
    expect(FIGURE_KEY_PATTERN.test("g1")).toBe(false);
    expect(FIGURE_KEY_PATTERN.test("f")).toBe(false);
    expect(FIGURE_KEY_PATTERN.test("f1/..")).toBe(false);
    expect(JOB_RESPONSE_MAX_BYTES).toBe(64 * 1024 * 1024);
  });
});

describe("sniffImageType", () => {
  it("png·jpeg·gif·webp 를 가리고 모르면 jpeg", () => {
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(JPEG)).toBe("image/jpeg");
    expect(sniffImageType(GIF)).toBe("image/gif");
    expect(sniffImageType(WEBP)).toBe("image/webp");
    expect(sniffImageType(new Uint8Array([0x42, 0x4d, 0, 0]))).toBe(
      "image/jpeg",
    );
    expect(sniffImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46]))).toBe(
      "image/jpeg",
    );
  });
});
