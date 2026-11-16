import { describe, expect, it } from "vitest";

import type {
  InstructCitation,
  InstructOutput,
} from "@/lib/review-api/instruct";
import {
  parseHighlightsByFile,
  readJobResponse,
} from "@/lib/review-api/job-response";
import { toHighlights } from "@/lib/review-api/parse-highlights";
import type { LocatedDocument, PageRef, PageSpace } from "@/lib/review-model";

import { parseHighlightsFor, type FileEntry } from "../job-review-state";

import {
  INSTRUCT_CITATION_COLOR,
  citationTarget,
  instructForDocument,
  instructHighlights,
  parseItemsFor,
  resolveCitation,
} from "../step-outputs";

const box = [
  { x: 0.1, y: 0.1 },
  { x: 0.2, y: 0.1 },
  { x: 0.2, y: 0.2 },
];

// 파일 2 개: job_1#0 은 병합 1~2쪽, job_1#1 은 병합 3쪽.
const SPACE: PageSpace = {
  files: [
    { file_ref: "job_1#0", input_index: 0, num_pages: 2, offset: 0 },
    { file_ref: "job_1#1", input_index: 1, num_pages: 1, offset: 2 },
  ],
};

// Job 응답의 Parse Step 출력(병합 페이지 번호). 목록·응답 하이라이트 모두 여기서 읽는다.
const PARSE_RAW = [
  {
    id: 0,
    page: 1,
    category: "heading1",
    content: { text: "제목" },
    coordinates: box,
  },
  {
    id: 1,
    page: 2,
    category: "table",
    content: { text: "표", html: "<table><tr><td>표</td></tr></table>" },
    coordinates: box,
  },
  { id: 2, page: 2, category: "", content: { text: "본문" } },
  {
    id: 3,
    page: 3,
    category: "paragraph",
    content: { text: "끝" },
    coordinates: box,
  },
  {
    id: 4,
    page: 3,
    category: "figure",
    coordinates: box,
    base64_encoding: "iVBORw0KGgo=",
  },
];

const RESPONSE = readJobResponse({
  output: [
    {
      type: "message",
      step_id: "st_parse",
      step_type: "document-parse",
      content: [
        { type: "output_text", text: JSON.stringify({ elements: PARSE_RAW }) },
      ],
    },
  ],
});
const ELEMENTS = RESPONSE.parseElements;

const output = (
  index: number,
  pageRanges: InstructOutput["pageRanges"],
  citations: InstructCitation[] = [],
  stepId = "st_ins",
): InstructOutput => ({
  stepId,
  stepName: "요약",
  index,
  text: `출력 ${index}`,
  json: null,
  enumDecision: null,
  citations,
  pageRanges,
  extra: null,
});

const cite = (
  index: number,
  page: number | null,
  coordinates: InstructCitation["coordinates"] = box,
  sourceType: string | null = "extract",
  sourceRef: string | null = null,
): InstructCitation => ({ index, sourceType, sourceRef, page, coordinates });

describe("parseItemsFor", () => {
  const docPages: PageRef[] = [
    { file_ref: "job_1#1", page: 1 },
    { file_ref: "job_1#0", page: 2 },
  ];

  it("문서의 뷰어 페이지 순서로, id 는 뷰어 Parse 하이라이트와 같게, 그림은 이미지, 표는 html 원문을 지닌다", () => {
    expect(parseItemsFor(docPages, ELEMENTS, SPACE)).toEqual([
      {
        id: "parse:job_1#1:p1-3",
        page: 1,
        text: "끝",
        type: "paragraph",
        image: null,
        tableHtml: null,
      },
      {
        id: "parse:job_1#1:p1-4",
        page: 1,
        text: "",
        type: "figure",
        image: "data:image/png;base64,iVBORw0KGgo=",
        tableHtml: null,
      },
      {
        id: "parse:job_1#0:p2-1",
        page: 2,
        text: "표",
        type: "table",
        image: null,
        tableHtml: "<table><tr><td>표</td></tr></table>",
      },
      {
        id: "parse:job_1#0:p2-2",
        page: 2,
        text: "본문",
        image: null,
        tableHtml: null,
      },
    ]);
  });

  it("공간을 모르면 빈 목록, 같은 페이지는 한 번만", () => {
    expect(parseItemsFor(docPages, ELEMENTS, null)).toEqual([]);
    expect(
      parseItemsFor([docPages[1]!, docPages[1]!], ELEMENTS, SPACE).map(
        item => item.id,
      ),
    ).toEqual(["parse:job_1#0:p2-1", "parse:job_1#0:p2-2"]);
  });

  describe("둘째 파일(input_index 1)의 목록 id == 뷰어 하이라이트 id", () => {
    const second: PageRef[] = [{ file_ref: "job_1#1", page: 1 }];
    const listIds = () =>
      parseItemsFor(second, ELEMENTS, SPACE)
        .map(item => item.id)
        .sort();
    // 좌표가 있는 요소만 하이라이트가 된다(이 페이지는 둘 다 있다).
    const expected = ["parse:job_1#1:p1-3", "parse:job_1#1:p1-4"];

    it("응답 fallback 경로(파일 하이라이트 없음)", () => {
      const fromResponse = parseHighlightsByFile(RESPONSE.parse, SPACE);
      const viewerIds = parseHighlightsFor(second, {}, fromResponse)
        .map(item => item.id)
        .sort();
      expect(listIds()).toEqual(expected);
      expect(viewerIds).toEqual(expected);
    });

    it("파일 묶음 경로(파일 하이라이트 API 는 파일 로컬 page 로 id 를 만든다)", () => {
      const local = PARSE_RAW.filter(item => item.page === 3).map(item => ({
        ...item,
        page: 1,
      }));
      const files: Record<string, FileEntry> = {
        "job_1#1": {
          fileId: "file_b",
          name: "b.pdf",
          status: "ready",
          numPages: 1,
          imageUrls: [null],
          parse: { 1: toHighlights(local, 1) },
          parseChunks: {},
        },
      };
      const viewerIds = parseHighlightsFor(second, files)
        .map(item => item.id)
        .sort();
      expect(viewerIds).toEqual(expected);
      expect(listIds()).toEqual(viewerIds);
    });
  });
});

describe("instructForDocument", () => {
  const outputs = [
    output(0, [[1, 2]]),
    output(1, [[3, 3]]),
    output(2, []),
    output(0, [[1, 3]], [], "st_other"),
  ];
  const firstDoc: PageRef[] = [{ file_ref: "job_1#0", page: 2 }];

  it("문서 병합 페이지와 겹치는 출력 + 범위 없는 출력", () => {
    const view = instructForDocument(outputs, "st_ins", firstDoc, SPACE);
    expect(view.outputs.map(item => item.index)).toEqual([0, 2]);
    expect(view).toMatchObject({ filtered: true, unmatched: false });
  });

  it("겹치는 출력이 없으면 전부(unmatched), 공간을 모르면 전부", () => {
    const only = [output(1, [[3, 3]])];
    expect(instructForDocument(only, "st_ins", firstDoc, SPACE)).toMatchObject({
      filtered: false,
      unmatched: true,
    });
    const noSpace = instructForDocument(outputs, "st_ins", firstDoc, null);
    expect(noSpace.outputs).toHaveLength(3);
    expect(noSpace).toMatchObject({ filtered: false, unmatched: false });
  });
});

describe("resolveCitation · citationTarget · instructHighlights", () => {
  it("좌표가 있으면 그 위치, 없으면 Parse 요소 id 로 대신한다", () => {
    expect(resolveCitation(cite(1, 3), SPACE, ELEMENTS)).toEqual({
      ref: { file_ref: "job_1#1", page: 1 },
      coordinates: box,
    });
    expect(
      resolveCitation(cite(2, null, null, "parse", "1"), SPACE, ELEMENTS),
    ).toEqual({ ref: { file_ref: "job_1#0", page: 2 }, coordinates: box });
    // 대신할 요소에도 좌표가 없거나, extract 인용이면 위치 없음.
    expect(
      resolveCitation(cite(3, null, null, "parse", "2"), SPACE, ELEMENTS),
    ).toBeNull();
    expect(resolveCitation(cite(4, 2, null), SPACE, ELEMENTS)).toBeNull();
    expect(resolveCitation(cite(1, 3), null, ELEMENTS)).toBeNull();
    expect(resolveCitation(cite(1, 9), SPACE, ELEMENTS)).toBeNull();
  });

  it("선택 문서 밖의 위치면 그 페이지를 가진 문서를 찾는다", () => {
    const documents: LocatedDocument[] = [
      {
        stepId: null,
        index: 0,
        document: {
          document_id: "doc_a",
          group_id: "g",
          label: null,
          source_files: [{ file_ref: "job_1#0", page_ranges: [[1, 2]] }],
        },
      },
      {
        stepId: null,
        index: 1,
        document: {
          document_id: "doc_b",
          group_id: "g",
          label: null,
          source_files: [{ file_ref: "job_1#1", page_ranges: [[1, 1]] }],
        },
      },
    ];
    const docPages: PageRef[] = [
      { file_ref: "job_1#0", page: 1 },
      { file_ref: "job_1#0", page: 2 },
    ];
    const here = { ref: { file_ref: "job_1#0", page: 2 }, coordinates: box };
    expect(citationTarget(here, docPages, documents)).toEqual({
      document: null,
      pageIndex: 1,
    });
    const there = { ref: { file_ref: "job_1#1", page: 1 }, coordinates: box };
    expect(citationTarget(there, docPages, documents)).toEqual({
      document: documents[1],
      pageIndex: 0,
    });
    const nowhere = { ref: { file_ref: "job_1#9", page: 1 }, coordinates: box };
    expect(citationTarget(nowhere, docPages, documents)).toBeNull();
  });

  it("선택 문서 안의 인용만 뷰어 하이라이트로(같은 인용 번호는 한 번)", () => {
    const docPages: PageRef[] = [{ file_ref: "job_1#0", page: 2 }];
    const view = instructForDocument(
      [output(0, [[1, 3]], [cite(1, 2), cite(1, 2), cite(2, 3)])],
      "st_ins",
      docPages,
      SPACE,
    );
    expect(instructHighlights(view, docPages, SPACE, ELEMENTS)).toEqual([
      {
        id: "instruct:st_ins:0:1",
        _value: "†1",
        page: 1,
        coordinates: box,
        color: INSTRUCT_CITATION_COLOR,
      },
    ]);
    expect(instructHighlights(view, docPages, null, ELEMENTS)).toEqual([]);
    expect(instructHighlights(null, docPages, SPACE, ELEMENTS)).toEqual([]);
  });
});
