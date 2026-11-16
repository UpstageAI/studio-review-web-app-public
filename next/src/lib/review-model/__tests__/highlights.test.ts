import { describe, expect, it } from "vitest";

import {
  collectExtractLeaves,
  extractItemsFromResponse,
  pairExtractItems,
  pairHighlights,
  type ExtractItem,
} from "../highlights";
import { parseJson } from "../json";
import { findDocument, findResult } from "../layout";
import { readReviewDocument } from "../normalize";
import { buildPageSpace, documentPages } from "../viewer";
import { singleJob } from "./fixtures/builders";
import { SINGLE_JOB } from "./fixtures/fixtures";

const box = (n = 4) =>
  Array.from({ length: n }, (_, i) => ({ x: 0.1 * (i + 1), y: 0.2 }));

const leaf = (value: unknown, page: number, points = 4) => ({
  _value: value,
  page,
  coordinates: box(points),
  confidence: 0.9,
});

const EXTRACT_1_TEXT =
  '{"amount":12345678901234567890,"rate":0.1234567890123456789,"scale":1E2,"delta":-0,' +
  '"currency":"USD","invoice_no":"INV-1","paid":true,"memo":null,"lines":[{"qty":2,"price":10.5}]}';

function response(items: { text: string; additional_values: unknown }[]) {
  return {
    output: [
      {
        id: "res_classify",
        step_id: "st_classify",
        step_type: "document-classify",
        content: [],
      },
      {
        id: "res_extract",
        step_id: "st_extract",
        step_type: "information-extract",
        content: items.map(item => ({
          type: "output_text",
          text: item.text,
          additional_values: JSON.stringify(item.additional_values),
        })),
      },
    ],
  };
}

describe("collectExtractLeaves", () => {
  it("중첩·배열을 따라가고 3 점 미만·page 없는 leaf 는 뺀다", () => {
    const leaves = collectExtractLeaves(
      parseJson(
        JSON.stringify({
          amount: leaf(1, 1),
          currency: { _value: "USD", coordinates: box() },
          lines: [{ qty: leaf(2, 2), price: leaf(10.5, 2, 2) }],
          nested: { deep: { value: leaf("x", 3) } },
        }),
      ),
    );
    expect(leaves.map(item => [item.pointer, item.page, item.value])).toEqual([
      ["/amount", 1, 1],
      ["/lines/0/qty", 2, 2],
      ["/nested/deep/value", 3, "x"],
    ]);
    expect(leaves[0]!.coordinates).toHaveLength(4);
  });
});

describe("extractItemsFromResponse", () => {
  it("Extract 메시지의 항목만, text 는 숫자 보존 파서로", () => {
    const items = extractItemsFromResponse(
      response([
        { text: EXTRACT_1_TEXT, additional_values: { amount: leaf(1, 1) } },
        { text: "not json", additional_values: {} },
      ]),
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      stepId: "st_extract",
      outputId: "res_extract",
      index: 0,
    });
    expect(extractItemsFromResponse(null)).toEqual([]);
  });
});

describe("pairExtractItems", () => {
  const { doc, job } = singleJob();

  it("동치 1 개면 그것과 짝짓는다(정밀 숫자 포함)", () => {
    const items = extractItemsFromResponse(
      response([
        { text: '{"amount":1,"currency":"KRW"}', additional_values: {} },
        { text: EXTRACT_1_TEXT, additional_values: { amount: leaf(1, 1) } },
      ]),
    );
    const paired = pairExtractItems(doc, job, items);
    expect(paired.get("occ_extract_1")?.index).toBe(1);
    expect(paired.has("occ_extract_2")).toBe(false);
    expect(paired.has("occ_validate_1")).toBe(false);
  });

  it("동치가 둘이면 결과 문서 페이지에 드는 것을 고른다", () => {
    const text = '{"currency":"KRW","amount":1000.0}';
    const items = extractItemsFromResponse(
      response([
        // 병합 1쪽 = job_A#0:1 (doc_1)
        { text, additional_values: { amount: leaf(1000, 1) } },
        // 병합 3쪽 = job_A#0:3 (doc_2, occ_extract_2 의 문서)
        { text, additional_values: { amount: leaf(1000, 3) } },
      ]),
    );
    expect(pairExtractItems(doc, job, items).get("occ_extract_2")?.index).toBe(
      1,
    );
  });

  it("동치가 둘이어도 메시지 id 가 결과 id 와 같으면 그것을 고른다", () => {
    const text = '{"currency":"KRW","amount":1000.0}';
    const base = response([
      { text, additional_values: { amount: leaf(1000, 1) } },
    ]);
    const extract = base.output[1]!;
    const items = extractItemsFromResponse({
      output: [
        // 응답 순서가 앞서지만 id 가 다른 항목
        { ...extract, id: "res_other", content: [extract.content[0]!] },
        // id 가 결과 id 와 같은 항목
        {
          ...extract,
          id: "occ_extract_2",
          content: [
            {
              ...extract.content[0]!,
              additional_values: JSON.stringify({ amount: leaf(1000, 1) }),
            },
          ],
        },
      ],
    });
    expect(
      pairExtractItems(doc, job, items).get("occ_extract_2")?.outputId,
    ).toBe("occ_extract_2");
  });

  it("목록 결과는 원소별로 나뉜 항목을 합쳐 짝짓는다(경로 앞에 원소 index)", () => {
    const listDoc = readReviewDocument(
      SINGLE_JOB.replace(
        /"id": "occ_extract_1",([\s\S]*?)"content": \{[\s\S]*?\n {10}\}/,
        '"id": "occ_extract_1",$1"content": [{"amount": 1}, {"amount": 2}]',
      ),
    );
    const listJob = listDoc.jobs[0]!;
    expect(findResult(listJob, "occ_extract_1")!.content).toEqual([
      { amount: 1 },
      { amount: 2 },
    ]);
    const base = response([
      { text: '{"amount":1}', additional_values: { amount: leaf(1, 1) } },
      { text: '{"amount":2}', additional_values: { amount: leaf(2, 2) } },
    ]);
    const items = extractItemsFromResponse({
      output: [{ ...base.output[1]!, id: "occ_extract_1" }],
    });
    const paired = pairExtractItems(listDoc, listJob, items).get(
      "occ_extract_1",
    );
    expect(paired?.leaves.map(item => [item.pointer, item.page])).toEqual([
      ["/0/amount", 1],
      ["/1/amount", 2],
    ]);
  });

  it("동치가 없으면 짝이 없다·다른 Job 에서 복사된 결과는 짝짓지 않는다", () => {
    expect(pairExtractItems(doc, job, []).size).toBe(0);
    const copied = readReviewDocument(
      SINGLE_JOB.replace(
        '"document_ids": ["doc_1"]\n        },\n        {\n          "id": "occ_extract_2"',
        '"document_ids": ["doc_1"],\n          "source": { "job_id": "job_S", "occurrence_id": "occ_s" }\n        },\n        {\n          "id": "occ_extract_2"',
      ),
    );
    expect(findResult(copied.jobs[0]!, "occ_extract_1")!.source).toBeDefined();
    const items = extractItemsFromResponse(
      response([{ text: EXTRACT_1_TEXT, additional_values: {} }]),
    );
    expect(pairExtractItems(copied, copied.jobs[0]!, items).size).toBe(0);
  });
});

describe("pairHighlights", () => {
  const { job } = singleJob();
  const space = buildPageSpace(job);
  const result = findResult(job, "occ_extract_1")!;
  const item: ExtractItem = extractItemsFromResponse(
    response([
      {
        text: EXTRACT_1_TEXT,
        additional_values: {
          amount: leaf(12, 2),
          currency: leaf("USD", 1),
          paid: leaf(true, 4), // job_A#1:1 → doc_1 밖
          lines: [{ qty: leaf(2, 1) }],
        },
      },
    ]),
  )[0]!;

  it("id 형식·뷰어 페이지·현재 값", () => {
    const pages = documentPages(findDocument(job, "st_classify", "doc_1")!);
    const highlights = pairHighlights("job_A", result, item, space, pages);
    expect(
      highlights.map(h => [h.id, h.page, h.viewerIndex, h._value]),
    ).toEqual([
      ["occ_extract_1#/amount", 2, 1, "12345678901234567890"],
      ["occ_extract_1#/currency", 1, 0, "USD"],
      ["occ_extract_1#/lines/0/qty", 1, 0, 2],
    ]);
    expect(highlights[0]!.coordinates).toHaveLength(4);
  });

  it("문서 순서를 바꾸면 뷰어 페이지가 따라간다", () => {
    const reversed = [
      { file_ref: "job_A#0", page: 2 },
      { file_ref: "job_A#0", page: 1 },
    ];
    const highlights = pairHighlights("job_A", result, item, space, reversed);
    expect(highlights.find(h => h.pointer === "/amount")?.page).toBe(1);
  });

  it("항목 하나짜리 배열 결과는 배열 없이 담긴 provenance 와도 잇는다", () => {
    const wrapped = { ...result, content: parseJson('[{"amount":12}]') };
    const [only] = extractItemsFromResponse(
      response([
        { text: '[{"amount":12}]', additional_values: { amount: leaf(12, 1) } },
      ]),
    );
    const pages = documentPages(findDocument(job, "st_classify", "doc_1")!);
    expect(
      pairHighlights("job_A", wrapped, only!, space, pages).map(h => [
        h.id,
        h.page,
      ]),
    ).toEqual([["occ_extract_1#/0/amount", 1]]);
  });

  it("다른 Job 접두사·space null 은 제외", () => {
    const pages = documentPages(findDocument(job, "st_classify", "doc_1")!);
    expect(pairHighlights("job_Z", result, item, space, pages)).toEqual([]);
    expect(pairHighlights("job_A", result, item, null, pages)).toEqual([]);
  });
});
