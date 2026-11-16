import { describe, expect, it } from "vitest";

import { isExactNumber, type PageSpace } from "@/lib/review-model";

import { readInstructOutput } from "../instruct";
import {
  EMPTY_JOB_RESPONSE,
  instructOutputsFromResponse,
  parseHighlightsByFile,
  parseHighlightsFromResponse,
  readJobResponse,
} from "../job-response";
import { PARSE_TABLE_HTML_MAX_LENGTH } from "../parse-highlights";

const box = [
  { x: 0.1, y: 0.1 },
  { x: 0.2, y: 0.1 },
  { x: 0.2, y: 0.2 },
  { x: 0.1, y: 0.2 },
];

const leaf = (value: unknown, page: number) => ({
  _value: value,
  page,
  coordinates: box,
  confidence: 0.9,
});

const extractMessage = (id: string, items: [string, unknown][]) => ({
  type: "message",
  id,
  step_id: "st_extract",
  step_type: "information-extract",
  model: "extract",
  content: items.map(([text, additional]) => ({
    type: "output_text",
    text,
    additional_values: JSON.stringify(additional),
  })),
});

/** Parse 1 · Extract 2 항목 · Validate 1 — 실제 응답과 같은 모양(텍스트는 JSON 문자열). */
const RESPONSE = {
  id: "job_A",
  output: [
    {
      type: "message",
      id: "res_parse",
      step_id: "st_parse",
      step_type: "document-parse",
      content: [
        {
          type: "output_text",
          text: JSON.stringify({
            api: "2.0",
            content: { html: "<p>…</p>" },
            elements: [
              {
                id: 0,
                page: 1,
                category: "heading1",
                content: { text: "Invoice" },
                coordinates: box,
              },
              {
                id: 1,
                page: 3,
                category: "table",
                content: { text: "row" },
                coordinates: box,
              },
              {
                id: 2,
                page: 2,
                category: "paragraph",
                coordinates: box.slice(0, 2),
              },
              { id: 3, category: "paragraph", coordinates: box },
            ],
          }),
          additional_values: "{}",
        },
      ],
    },
    extractMessage("occ_1", [
      [
        '{"amount":12345678901234567890,"currency":"USD"}',
        {
          step_run_id: "occ_1",
          amount: leaf("12345678901234567890", 1),
          currency: leaf("USD", 3),
        },
      ],
      ["not json", {}],
      ['{"amount":1,"currency":"KRW"}', { amount: leaf(1, 2) }],
    ]),
    {
      type: "message",
      id: "res_validate",
      step_id: "st_validate",
      step_type: "validate",
      content: [{ type: "output_text", text: '"green"' }],
    },
  ],
};

const SPACE: PageSpace = {
  files: [
    { file_ref: "job_A#0", input_index: 0, num_pages: 2, offset: 0 },
    { file_ref: "job_A#1", input_index: 1, num_pages: 1, offset: 2 },
  ],
};

describe("readJobResponse", () => {
  it("Extract 항목만 꺼내고 텍스트는 숫자를 보존한다", () => {
    const { extractItems } = readJobResponse(RESPONSE);
    expect(extractItems).toHaveLength(2);
    expect(extractItems.map(item => [item.outputId, item.index])).toEqual([
      ["occ_1", 0],
      ["occ_1", 2],
    ]);
    const content = extractItems[0]!.content as Record<string, unknown>;
    expect(isExactNumber(content.amount)).toBe(true);
    expect(
      extractItems[0]!.leaves.map(item => [item.pointer, item.page]),
    ).toEqual([
      ["/amount", 1],
      ["/currency", 3],
    ]);
    expect(extractItems[0]!.leaves[0]!.coordinates).toHaveLength(4);
  });

  it("모양이 틀리면 빈 목록", () => {
    expect(readJobResponse(null)).toEqual(EMPTY_JOB_RESPONSE);
    expect(readJobResponse({ output: "x" })).toEqual(EMPTY_JOB_RESPONSE);
  });

  it("Parse 요소를 본문 글자만 남겨 줄인다(페이지 순, 하이라이트와 같은 id)", () => {
    const { parseElements, parseStepId } = readJobResponse(RESPONSE);
    expect(parseStepId).toBe("st_parse");
    expect(
      parseElements.map(item => [
        item.id,
        item.elementId,
        item.page,
        item.category,
        item.text,
      ]),
    ).toEqual([
      ["p1-0", "0", 1, "heading1", "Invoice"],
      ["p2-2", "2", 2, "paragraph", ""],
      ["p3-1", "1", 3, "table", "row"],
    ]);
    // 좌표가 모자라도 목록에는 남는다(뷰어 위치만 없다).
    expect(parseElements[1]!.coordinates).toBeNull();
    expect(parseElements[0]!.coordinates).toHaveLength(4);
    expect(Object.keys(parseElements[0]!).sort()).toEqual([
      "category",
      "coordinates",
      "elementId",
      "id",
      "image",
      "page",
      "tableHtml",
      "text",
    ]);
    expect(parseElements.every(item => item.image === null)).toBe(true);
    // html 이 없는 표는 원문이 없다.
    expect(parseElements.every(item => item.tableHtml === null)).toBe(true);
  });

  it("그림 요소는 이미지 data URL 을 남기고 이미지 표기는 text·markdown 어디에 있든 글자로 보지 않는다", () => {
    const response = {
      output: [
        {
          type: "message",
          step_id: "st_parse",
          step_type: "document-parse",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                elements: [
                  {
                    id: 0,
                    page: 1,
                    category: "figure",
                    content: {
                      html: "<figure><img alt='' data-coord='top-left:(1,2)'/></figure>",
                      markdown: "![image](/image/placeholder)",
                      // 실데이터는 `text` 에도 자리표시가 들어 있다.
                      text: "![image](/image/placeholder)",
                    },
                    coordinates: box,
                    base64_encoding: "iVBORw0KGgo=",
                  },
                  {
                    id: 3,
                    page: 1,
                    category: "table",
                    content: {
                      html: "<table><tr><td>222 Valley</td><td>Farms Street</td></tr></table>",
                      markdown: "",
                      text: "| ![image](/image/placeholder)\n 222 Valley | Farms Street |\n| --- | --- |",
                    },
                    coordinates: box,
                    base64_encoding: null,
                  },
                  {
                    id: 1,
                    page: 1,
                    category: "chart",
                    content: {
                      markdown: "![image](/image/placeholder)\n그림 1",
                    },
                    coordinates: box,
                    base64_encoding: "/9j/4AAQ",
                  },
                  {
                    id: 2,
                    page: 1,
                    category: "paragraph",
                    content: { text: "본문" },
                    coordinates: box,
                    base64_encoding: "",
                  },
                ],
              }),
            },
          ],
        },
      ],
    };
    const { parseElements } = readJobResponse(response);
    expect(
      parseElements.map(item => [
        item.id,
        item.category,
        item.text,
        item.image,
      ]),
    ).toEqual([
      ["p1-0", "figure", "", "data:image/png;base64,iVBORw0KGgo="],
      ["p1-3", "table", "| 222 Valley | Farms Street |\n| --- | --- |", null],
      ["p1-1", "chart", "그림 1", "data:image/jpeg;base64,/9j/4AAQ"],
      ["p1-2", "paragraph", "본문", null],
    ]);
  });

  it("표 요소만 html 원문을 tableHtml 로 남기고 text 는 그대로 둔다", () => {
    const tableHtml =
      "<table id='1' style='font-size:20px'><tr><td>a</td></tr></table>";
    const element = (id: number, category: string, content: unknown) => ({
      id,
      page: 1,
      category,
      content,
      coordinates: box,
    });
    const response = {
      output: [
        {
          type: "message",
          step_id: "st_parse",
          step_type: "document-parse",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                elements: [
                  element(0, "table", { html: tableHtml, text: "| a |" }),
                  element(1, "paragraph", {
                    html: "<p>본문</p>",
                    text: "본문",
                  }),
                  element(2, "table", { text: "html 없음" }),
                  element(3, "table", { html: "", text: "빈 html" }),
                  element(4, "table", {
                    html: `<table>${"x".repeat(PARSE_TABLE_HTML_MAX_LENGTH)}</table>`,
                    text: "상한 초과",
                  }),
                  element(5, "table", { html: 12, text: "문자열 아님" }),
                ],
              }),
            },
          ],
        },
      ],
    };
    const { parseElements } = readJobResponse(response);
    expect(
      parseElements.map(item => [item.elementId, item.text, item.tableHtml]),
    ).toEqual([
      ["0", "| a |", tableHtml],
      ["1", "본문", null],
      ["2", "html 없음", null],
      ["3", "빈 html", null],
      ["4", "상한 초과", null],
      ["5", "문자열 아님", null],
    ]);
  });

  it("BFF 가 넣은 figure_url 은 패턴에 맞을 때만 쓰고, 아니면 base64 폴백 또는 null", () => {
    const parseElement = (id: number, extra: Record<string, unknown>) => ({
      id,
      page: 1,
      category: "figure",
      content: { text: "![image](/image/placeholder)" },
      coordinates: box,
      ...extra,
    });
    const response = {
      output: [
        {
          type: "message",
          step_id: "st_parse",
          step_type: "document-parse",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                elements: [
                  parseElement(0, {
                    figure_url:
                      "/api/search-collections/scol_1/source-jobs/job_1/figures/f12",
                  }),
                  parseElement(1, {
                    figure_url: "https://evil.example/figures/f1",
                    base64_encoding: "iVBORw0KGgo=",
                  }),
                  parseElement(2, { figure_url: "/api/other/figures/f1" }),
                  parseElement(3, {
                    figure_url:
                      "/api/search-collections/scol_1/source-jobs/job_1/figures/f1/../../x",
                  }),
                  parseElement(4, {
                    figure_url:
                      "/api/search-collections/scol_1/source-jobs/job_1/figures/f1?x=1",
                  }),
                  parseElement(5, { figure_url: 12 }),
                ],
              }),
            },
          ],
        },
      ],
    };
    const { parseElements } = readJobResponse(response);
    expect(parseElements.map(item => item.image)).toEqual([
      "/api/search-collections/scol_1/source-jobs/job_1/figures/f12",
      "data:image/png;base64,iVBORw0KGgo=",
      null,
      null,
      null,
      null,
    ]);
  });

  it("Step 순서는 응답 순서, 같은 Step 은 한 번", () => {
    const { stepOrder } = readJobResponse({
      output: [...RESPONSE.output, INSTRUCT_MESSAGE, INSTRUCT_MESSAGE_2],
    });
    expect(stepOrder.map(step => [step.stepId, step.stepType])).toEqual([
      ["st_parse", "document-parse"],
      ["st_extract", "information-extract"],
      ["st_validate", "validate"],
      ["st_instruct", "instruct"],
    ]);
    expect(stepOrder[3]!.stepName).toBe("요약");
  });
});

/**
 * 실데이터 모양의 Instruct 출력(값은 가짜). `content[]` 항목마다 문서 하나,
 * `additional_values` 는 JSON 문자열.
 */
const INSTRUCT_MESSAGE = {
  type: "message",
  id: "res_instruct_1",
  step_id: "st_instruct",
  step_type: "instruct",
  model: "요약",
  content: [
    {
      type: "output_text",
      // 실데이터는 본문을 JSON 문자열로 직렬화해 보낸다(따옴표·`\n` 이 글자로 들어 있다).
      text: JSON.stringify(
        "## 문서 설명\n\n**총금액은 12,700원**입니다.【†1】 발행일은 2000-01-01 입니다.【†2】",
      ),
      additional_values: JSON.stringify({
        enum: "신분증",
        previous_step_name: "parse",
        page_ranges: [[1, 2]],
        citations: [
          {
            index: 1,
            source_type: "extract",
            source_ref: "total_amount",
            page: 2,
            coordinates: box,
            word_coordinates: [],
          },
          {
            index: 2,
            source_type: "parse",
            source_ref: "0",
            page: 0,
            coordinates: [],
          },
          { index: "x", page: 1 },
        ],
      }),
    },
    {
      type: "output_text",
      text: '{"category":"receipt","amount":12345678901234567890}',
      additional_values: {
        enum: "",
        page_ranges: [
          [3, 3],
          [5, 4],
        ],
      },
    },
  ],
};

const INSTRUCT_MESSAGE_2 = {
  ...INSTRUCT_MESSAGE,
  id: "res_instruct_2",
  content: [{ type: "output_text", text: "plain", additional_values: "oops" }],
};

describe("instructOutputsFromResponse", () => {
  it("본문·결정·인용·페이지 범위를 읽고 Step 안 순번을 잇는다", () => {
    const outputs = instructOutputsFromResponse({
      output: [...RESPONSE.output, INSTRUCT_MESSAGE, INSTRUCT_MESSAGE_2],
    });
    expect(outputs.map(item => [item.stepId, item.index])).toEqual([
      ["st_instruct", 0],
      ["st_instruct", 1],
      ["st_instruct", 2],
    ]);
    const [first, second, third] = outputs;
    expect(first).toMatchObject({
      stepName: "요약",
      // JSON 문자열은 풀어서 markdown 본문으로 쓴다.
      text: "## 문서 설명\n\n**총금액은 12,700원**입니다.【†1】 발행일은 2000-01-01 입니다.【†2】",
      json: null,
      enumDecision: "신분증",
      pageRanges: [[1, 2]],
    });
    expect(first!.citations).toEqual([
      {
        index: 1,
        sourceType: "extract",
        sourceRef: "total_amount",
        page: 2,
        coordinates: box,
      },
      {
        index: 2,
        sourceType: "parse",
        sourceRef: "0",
        page: null,
        coordinates: null,
      },
    ]);
    // 원본 보기에는 인용·previous_step_name 을 뺀다.
    expect(Object.keys(first!.extra ?? {}).sort()).toEqual([
      "enum",
      "page_ranges",
    ]);

    // JSON 객체 본문은 숫자를 보존해 읽는다. 빈 결정은 미분류(빈 문자열)로 남는다.
    expect(second!.enumDecision).toBe("");
    expect(second!.pageRanges).toEqual([[3, 3]]);
    const json = second!.json as Record<string, unknown>;
    expect(json.category).toBe("receipt");
    expect(isExactNumber(json.amount)).toBe(true);

    expect(third).toMatchObject({
      text: "plain",
      json: null,
      enumDecision: null,
      citations: [],
      pageRanges: [],
      extra: null,
    });
  });

  it("따옴표로 시작하지만 JSON 이 아닌 글과 단일 값은 원문 그대로 본문이다", () => {
    const textOf = (text: string) =>
      readInstructOutput({ ...INSTRUCT_MESSAGE, content: [{ text }] }).map(
        item => [item.text, item.json],
      );
    expect(textOf('"깨진 문자열')).toEqual([['"깨진 문자열', null]]);
    expect(textOf('"인용"으로 시작하는 문장')).toEqual([
      ['"인용"으로 시작하는 문장', null],
    ]);
    expect(textOf("12")).toEqual([["12", null]]);
    expect(textOf('"a\\"b"')).toEqual([['a"b', null]]);
  });

  it("Instruct 가 아닌 출력은 건너뛴다", () => {
    expect(instructOutputsFromResponse(RESPONSE)).toEqual([]);
    expect(readInstructOutput({ ...INSTRUCT_MESSAGE, step_id: 1 })).toEqual([]);
  });
});

describe("parseHighlightsFromResponse", () => {
  it("Parse 출력 요소를 병합 페이지 기준 하이라이트로(좌표 부족·page 없음은 뺀다)", () => {
    const parse = parseHighlightsFromResponse(RESPONSE);
    expect(parse.map(item => [item.id, item.page, item.color])).toEqual([
      ["p1-0", 1, "var(--chart-3)"],
      ["p3-1", 3, "var(--chart-1)"],
    ]);
    expect(parse[0]!._value).toBe("Invoice");
  });

  it("Parse 텍스트가 JSON 이 아니면 빈 목록", () => {
    expect(
      parseHighlightsFromResponse({
        output: [
          {
            step_type: "document-parse",
            content: [{ type: "output_text", text: "oops" }],
          },
        ],
      }),
    ).toEqual([]);
  });
});

describe("parseHighlightsByFile", () => {
  it("병합 페이지를 파일 로컬 페이지로 나누고 id 도 로컬 번호로 다시 만든다", () => {
    const byFile = parseHighlightsByFile(
      parseHighlightsFromResponse(RESPONSE),
      SPACE,
    );
    expect(Object.keys(byFile).sort()).toEqual(["job_A#0", "job_A#1"]);
    expect(byFile["job_A#0"]!.map(page => page.map(item => item.id))).toEqual([
      ["p1-0"],
    ]);
    // 둘째 파일의 병합 3쪽 = 로컬 1쪽: 파일 하이라이트 API 와 같은 `p1-{elementId}`.
    expect(byFile["job_A#1"]![0]!.map(item => [item.id, item.page])).toEqual([
      ["p1-1", 1],
    ]);
  });

  it("공간을 모르면 비어 있다", () => {
    expect(
      parseHighlightsByFile(parseHighlightsFromResponse(RESPONSE), null),
    ).toEqual({});
  });
});
