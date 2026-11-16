import { describe, expect, it } from "vitest";

import {
  ExactNumber,
  STRUCTURE_GROUP_ID,
  type ChangeEntry,
} from "@/lib/review-model";

import {
  describeBatch,
  describeEntry,
  groupEntries,
  originNoteOf,
} from "../describe-change";

const placeholders = {
  untitled: "(untitled)",
  empty: "(empty)",
  nullValue: "(none)",
  arrayIndex: (index: number) => `${index}번째`,
};

function entry(
  partial: Partial<ChangeEntry> & Pick<ChangeEntry, "kind">,
  description: Partial<ChangeEntry["description"]> = {},
): ChangeEntry {
  return {
    id: "change-1",
    seq: 1,
    jobId: "job_1",
    ...partial,
    description: {
      documentLabel: "Invoice",
      documentIds: ["doc_1"],
      ...description,
    },
  } as ChangeEntry;
}

describe("describeEntry", () => {
  it("값 변경은 Step › 필드: 전 → 후, 큰 수는 원문 그대로", () => {
    const text = describeEntry(
      entry(
        { kind: "set_value", resultId: "occ_1", path: ["amount"], value: 1 },
        {
          stepName: "Extract",
          fieldTitle: "Amount",
          before: null,
          after: new ExactNumber("12345678901234567890"),
        },
      ),
      placeholders,
    );
    expect(text).toEqual({
      key: "setValue",
      values: {
        step: "Extract",
        field: "Amount",
        before: "(none)",
        after: "12345678901234567890",
      },
    });
  });

  it("결과 루트 값(경로·제목 없음)은 Step 이름을 필드 자리에 쓴다", () => {
    const root = (stepName?: string) =>
      entry(
        {
          kind: "set_value",
          resultId: "occ_validate_1",
          path: [],
          value: "red",
        },
        {
          ...(stepName ? { stepName } : {}),
          fieldTitle: "",
          pointer: "",
          before: "green",
          after: "red",
        },
      );
    expect(describeEntry(root("금액 검증"), placeholders)).toEqual({
      key: "setValueNoStep",
      values: { field: "금액 검증", before: "green", after: "red" },
    });
    expect(describeEntry(root(), placeholders)).toEqual({
      key: "setValueNoStep",
      values: { field: "occ_validate_1", before: "green", after: "red" },
    });
  });

  it("배열 안 값은 경로 단계와 위치(1-based)를 함께 보인다", () => {
    expect(
      describeEntry(
        entry(
          {
            kind: "set_value",
            resultId: "occ_1",
            path: ["lines", "0", "qty"],
            value: 10,
          },
          {
            stepName: "Step",
            fieldTitle: "qty",
            fieldPath: [
              { kind: "key", title: "lines" },
              { kind: "index", index: 1 },
              { kind: "key", title: "qty" },
            ],
            pointer: "/lines/0/qty",
            before: 9,
            after: 10,
          },
        ),
        placeholders,
      ),
    ).toEqual({
      key: "setValue",
      values: {
        step: "Step",
        field: "lines › 1번째 › qty",
        before: "9",
        after: "10",
      },
    });
    expect(
      describeEntry(
        entry(
          {
            kind: "insert_item",
            resultId: "occ_1",
            path: ["lines", "1", "tags"],
            index: 0,
            value: "a",
          },
          {
            stepName: "Step",
            fieldTitle: "tags",
            fieldPath: [
              { kind: "key", title: "lines" },
              { kind: "index", index: 2 },
              { kind: "key", title: "tags" },
            ],
            pointer: "/lines/1/tags",
            index: 1,
          },
        ),
        placeholders,
      ),
    ).toEqual({
      key: "insertItem",
      values: { target: "Step › lines › 2번째 › tags", index: 1 },
    });
  });

  it("긴 값은 60 자에서 자른다", () => {
    const text = describeEntry(
      entry(
        { kind: "set_value", resultId: "occ_1", path: ["memo"], value: "" },
        { fieldTitle: "Memo", before: "a".repeat(80), after: "b" },
      ),
      placeholders,
    );
    expect(text.key).toBe("setValueNoStep");
    expect(Array.from(String(text.values.before))).toHaveLength(60);
  });

  it("구성 항목은 문서·페이지 위치로 말한다", () => {
    expect(
      describeEntry(
        entry({ kind: "split_document" }, { pages: [3] }),
        placeholders,
      ),
    ).toEqual({ key: "split", values: { document: "Invoice", page: "3" } });
    expect(
      describeEntry(
        entry(
          { kind: "merge_documents" },
          { documentLabel: null, otherDocumentLabel: "Receipt" },
        ),
        placeholders,
      ),
    ).toEqual({
      key: "merge",
      values: { document: "(untitled)", other: "Receipt" },
    });
    expect(
      describeEntry(
        entry({ kind: "exclude_pages" }, { pages: [1, 2] }),
        placeholders,
      ),
    ).toEqual({ key: "excludePages", values: { pages: "1, 2" } });
  });

  it("같은 문서 안에서 모은 페이지 옮기기는 자리 이동 문구(뺀 뒤 기준 1-based), 다른 문서는 그대로", () => {
    const page = { file_ref: "job_1#0", page: 2 };
    expect(
      describeEntry(
        entry(
          {
            kind: "move_pages",
            fromDocumentId: "doc_1",
            pages: [page, page],
            to: { documentId: "doc_1", index: 0 },
          },
          { pages: [2, 4], otherDocumentLabel: "Invoice" },
        ),
        placeholders,
      ),
    ).toEqual({ key: "reorderPages", values: { pages: "2, 4", to: 1 } });
    expect(
      describeEntry(
        entry(
          {
            kind: "move_pages",
            fromDocumentId: "doc_1",
            pages: [page],
            to: { documentId: "doc_2", index: 0 },
          },
          { pages: [2], otherDocumentLabel: "Receipt" },
        ),
        placeholders,
      ),
    ).toEqual({ key: "movePages", values: { pages: "2", other: "Receipt" } });
  });
});

describe("describeEntry — 배열 항목·키·하위 트리", () => {
  const value = { resultId: "occ_1", path: ["lines"] };
  const desc = { stepName: "Extract", fieldTitle: "Lines" };

  it("결과 전체 교체는 Step 이름으로, 일부 교체는 대상과 전·후 값으로", () => {
    expect(
      describeEntry(
        entry(
          { kind: "replace_subtree", resultId: "occ_1", path: [], value: 1 },
          { stepName: "Extract", fieldTitle: "" },
        ),
        placeholders,
      ),
    ).toEqual({ key: "replaceAll", values: { step: "Extract" } });
    expect(
      describeEntry(
        entry(
          { kind: "replace_subtree", resultId: "occ_1", path: [], value: 1 },
          {},
        ),
        placeholders,
      ),
    ).toEqual({ key: "replaceAll", values: { step: "occ_1" } });
    expect(
      describeEntry(
        entry(
          { kind: "replace_subtree", ...value, value: [] },
          { ...desc, before: "", after: null },
        ),
        placeholders,
      ),
    ).toEqual({
      key: "replaceSubtree",
      values: { target: "Extract › Lines", before: "(empty)", after: "(none)" },
    });
  });

  it("배열 항목 추가·삭제·이동은 1 부터 센 위치로", () => {
    expect(
      describeEntry(
        entry(
          { kind: "insert_item", ...value, index: 0, value: {} },
          { ...desc, index: 1 },
        ),
        placeholders,
      ),
    ).toEqual({
      key: "insertItem",
      values: { target: "Extract › Lines", index: 1 },
    });
    expect(
      describeEntry(
        entry(
          { kind: "remove_item", ...value, index: 1 },
          { ...desc, index: 2, before: "x" },
        ),
        placeholders,
      ),
    ).toEqual({
      key: "removeItem",
      values: { target: "Extract › Lines", index: 2, before: "x" },
    });
    expect(
      describeEntry(
        entry(
          { kind: "move_item", ...value, from: 0, to: 2 },
          { ...desc, from: 1, to: 3 },
        ),
        placeholders,
      ),
    ).toEqual({
      key: "moveItem",
      values: { target: "Extract › Lines", from: 1, to: 3 },
    });
  });

  it("필드 추가·삭제는 대상 이름으로, Step 이 없으면 필드만", () => {
    expect(
      describeEntry(
        entry(
          {
            kind: "set_key",
            resultId: "occ_1",
            path: [],
            key: "memo",
            value: "",
          },
          { fieldTitle: "Memo" },
        ),
        placeholders,
      ),
    ).toEqual({ key: "setKey", values: { target: "Memo" } });
    expect(
      describeEntry(
        entry(
          { kind: "remove_key", resultId: "occ_1", path: [], key: "memo" },
          { stepName: "Extract", fieldTitle: "Memo", before: null },
        ),
        placeholders,
      ),
    ).toEqual({
      key: "removeKey",
      values: { target: "Extract › Memo", before: "(none)" },
    });
  });
});

describe("describeEntry — 구조 교체", () => {
  it("문서·제외 개수를 싣고 구조 묶음으로 따로 묶인다", () => {
    const structure = entry(
      { kind: "replace_structure", fileGroups: {} as never, layouts: [] },
      {
        documentLabel: null,
        documentIds: [STRUCTURE_GROUP_ID],
        detail: { documents: 3, excludedDocuments: 1, excludedPages: 2 },
      },
    );
    expect(describeEntry(structure, placeholders)).toEqual({
      key: "replaceStructure",
      values: { documents: 3, excludedDocuments: 1, excludedPages: 2 },
    });
    const unlinked = entry(
      { kind: "set_value", resultId: "occ_9", path: ["a"], value: 1 },
      { documentIds: [] },
    );
    expect(
      groupEntries([structure, unlinked]).map(group => group.documentId),
    ).toEqual([STRUCTURE_GROUP_ID, ""]);
  });
});

describe("describeEntry — 구조 교체 요약", () => {
  const counts = { documents: 3, excludedDocuments: 0, excludedPages: 0 };
  const changed = (index: number) => ({
    documentId: `doc_${index}`,
    status: "changed" as const,
    position: index,
    before: `old_${index}`,
    after: `new_${index}`,
    labelChanged: index !== 4,
    rangesChanged: index === 4,
    pageSetChanged: index === 4,
  });

  it("라벨 하나가 바뀌면 바뀐 수와 바뀐 문서를 조각으로 싣는다", () => {
    const structure = entry(
      { kind: "replace_structure", fileGroups: {} as never, layouts: [] },
      {
        documentLabel: null,
        documentIds: [STRUCTURE_GROUP_ID, "doc_2"],
        detail: {
          ...counts,
          labelChanged: 1,
          rangesChanged: 0,
          added: 0,
          removed: 0,
          reordered: 0,
          groupsChanged: 0,
        },
        structureDocuments: [
          {
            documentId: "doc_2",
            status: "changed",
            position: 2,
            before: "receipt",
            after: "contract",
            labelChanged: true,
            rangesChanged: false,
            pageSetChanged: false,
          },
        ],
      },
    );
    expect(describeEntry(structure, placeholders)).toEqual({
      key: "replaceStructureChanged",
      values: { ...counts, shown: 1, more: 0 },
      lists: {
        summary: [{ key: "structureLabels", values: { count: 1 } }],
        examples: [
          {
            key: "structureLabelChange",
            values: { before: "receipt", after: "contract", position: 2 },
          },
        ],
      },
    });
  });

  it("바뀐 문서는 3 개까지 보이고 나머지는 센다. 추가·삭제 문서는 라벨로", () => {
    const structure = entry(
      { kind: "replace_structure", fileGroups: {} as never, layouts: [] },
      {
        documentLabel: null,
        documentIds: [STRUCTURE_GROUP_ID],
        detail: {
          ...counts,
          labelChanged: 3,
          rangesChanged: 1,
          added: 0,
          removed: 1,
          reordered: 2,
          groupsChanged: 1,
        },
        structureDocuments: [
          {
            documentId: "doc_9",
            status: "removed",
            position: 1,
            before: null,
            after: null,
            labelChanged: false,
            rangesChanged: false,
            pageSetChanged: true,
          },
          changed(4),
          changed(1),
          changed(2),
          changed(3),
        ],
      },
    );
    const text = describeEntry(structure, placeholders);
    expect(text.key).toBe("replaceStructureChanged");
    expect(text.values).toMatchObject({ shown: 3, more: 2 });
    expect(text.lists?.summary.map(fragment => fragment.key)).toEqual([
      "structureLabels",
      "structureRanges",
      "structureRemoved",
      "structureReordered",
      "structureGroups",
    ]);
    expect(text.lists?.examples).toEqual([
      {
        key: "structureDocument",
        values: { document: "(untitled)", position: 1 },
      },
      { key: "structureDocument", values: { document: "new_4", position: 4 } },
      {
        key: "structureLabelChange",
        values: { before: "old_1", after: "new_1", position: 1 },
      },
    ]);
  });
});

describe("describeEntry — 파일 이동", () => {
  it("기존 그룹은 그룹 순서, 새 그룹은 분리 문구. 파일 이름은 host 가 붙인다", () => {
    const named = {
      ...placeholders,
      fileName: (ref: string) => (ref === "job_1#0" ? "a.pdf" : ref),
    };
    expect(
      describeEntry(
        entry(
          { kind: "move_file", fileRef: "job_1#0", to: { groupId: "g2" } },
          {
            documentLabel: null,
            documentIds: [STRUCTURE_GROUP_ID, "doc_1"],
            detail: { fileRef: "job_1#0", group: 2 },
          },
        ),
        named,
      ),
    ).toEqual({ key: "moveFile", values: { file: "a.pdf", group: 2 } });
    expect(
      describeEntry(
        entry(
          {
            kind: "move_file",
            fileRef: "job_1#0",
            to: { newGroupId: "review-grp-x" },
          },
          { documentLabel: null, documentIds: [STRUCTURE_GROUP_ID] },
        ),
        named,
      ),
    ).toEqual({ key: "moveFileNewGroup", values: { file: "a.pdf" } });
  });
});

describe("groupEntries", () => {
  it("주 대상 문서별로 처음 나온 순서대로 묶는다", () => {
    const a = entry({ kind: "set_label", id: "change-1" });
    const b = entry(
      { kind: "exclude_pages", id: "change-2" },
      {
        documentIds: ["doc_2"],
        documentLabel: "Other",
      },
    );
    const c = entry({ kind: "set_label", id: "change-3" });
    const groups = groupEntries([a, b, c]);
    expect(groups.map(group => group.documentId)).toEqual(["doc_1", "doc_2"]);
    expect(
      groups[0]!.units.map(unit =>
        unit.kind === "entry" ? unit.entry.id : unit.batchId,
      ),
    ).toEqual(["change-1", "change-3"]);
  });

  const page = { file_ref: "job_1#0", page: 1 };
  const batched = (
    id: string,
    batchId: string | undefined,
    documentId: string,
    label: string,
  ) =>
    entry(
      {
        kind: "exclude_pages",
        id,
        stepId: "st_c",
        fromDocumentId: documentId,
        pages: [page],
        ...(batchId ? { batchId } : {}),
      },
      { documentIds: [documentId], documentLabel: label, pages: [1] },
    );

  it("같은 batchId 는 처음 나온 항목의 문서 묶음 안에서 한 줄이 된다", () => {
    const groups = groupEntries([
      batched("change-1", "b1", "doc_1", "A"),
      batched("change-2", undefined, "doc_2", "B"),
      batched("change-3", "b1", "doc_3", "C"),
      batched("change-4", "b1", "doc_2", "B"),
    ]);
    expect(groups.map(group => group.documentId)).toEqual(["doc_1", "doc_2"]);
    expect(groups[0]!.units).toHaveLength(1);
    const unit = groups[0]!.units[0]!;
    expect(unit.kind).toBe("batch");
    if (unit.kind !== "batch") return;
    expect(unit.batchId).toBe("b1");
    expect(unit.entries.map(item => item.id)).toEqual([
      "change-1",
      "change-3",
      "change-4",
    ]);
    expect(
      groups[1]!.units.map(item =>
        item.kind === "entry" ? item.entry.id : item.batchId,
      ),
    ).toEqual(["change-2"]);
  });

  it("항목이 하나뿐인 묶음은 보통 항목과 같게 보인다", () => {
    const groups = groupEntries([
      batched("change-1", "b1", "doc_1", "A"),
      batched("change-2", "b2", "doc_1", "A"),
      batched("change-3", "b2", "doc_2", "B"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.units.map(unit => unit.kind)).toEqual(["entry", "batch"]);
  });
});

describe("describeBatch", () => {
  const p1 = { file_ref: "job_1#0", page: 1 };
  const p2 = { file_ref: "job_1#0", page: 2 };

  it("전부 제외면 batchExcludePages: 장 수 합·문서 수·원본별 페이지", () => {
    const text = describeBatch(
      [
        entry(
          {
            kind: "exclude_pages",
            id: "change-1",
            stepId: "st_c",
            fromDocumentId: "doc_1",
            pages: [p1, p2],
            batchId: "b1",
          },
          { documentLabel: "Invoice", pages: [1, 2] },
        ),
        entry(
          {
            kind: "exclude_pages",
            id: "change-2",
            stepId: "st_c",
            fromDocumentId: "doc_2",
            pages: [p1],
            batchId: "b1",
          },
          { documentLabel: null, documentIds: ["doc_2"], pages: [3] },
        ),
      ],
      placeholders,
    );
    expect(text).toEqual({
      key: "batchExcludePages",
      values: {
        count: 3,
        documents: 2,
        sources: "Invoice 1, 2; (untitled) 3",
      },
    });
  });

  it("옮기기는 batchMovePages, other 는 대상 라벨", () => {
    const move = (id: string, from: string, label: string) =>
      entry(
        {
          kind: "move_pages",
          id,
          stepId: "st_c",
          fromDocumentId: from,
          pages: [p1],
          to: { documentId: "doc_9", index: 0 },
          batchId: "b1",
        },
        {
          documentLabel: label,
          documentIds: [from, "doc_9"],
          pages: [1],
          otherDocumentLabel: "Target",
        },
      );
    expect(
      describeBatch([move("c1", "doc_1", "A"), move("c2", "doc_2", "B")], {
        ...placeholders,
      }),
    ).toEqual({
      key: "batchMovePages",
      values: { count: 2, documents: 2, sources: "A 1; B 1", other: "Target" },
    });
  });

  it("끌어 놓기 묶음(같은 문서 모으기 + 다른 문서)도 batchMovePages, other 는 대상 라벨", () => {
    const text = describeBatch(
      [
        entry(
          {
            kind: "move_pages",
            id: "c1",
            stepId: "st_c",
            fromDocumentId: "doc_9",
            pages: [p1],
            to: { documentId: "doc_9", index: 1 },
            batchId: "b1",
          },
          {
            documentLabel: "Target",
            documentIds: ["doc_9"],
            pages: [1],
            otherDocumentLabel: "Target",
          },
        ),
        entry(
          {
            kind: "move_pages",
            id: "c2",
            stepId: "st_c",
            fromDocumentId: "doc_1",
            pages: [p2],
            to: { documentId: "doc_9", index: 1 },
            batchId: "b1",
          },
          {
            documentLabel: "A",
            documentIds: ["doc_1", "doc_9"],
            pages: [2],
            otherDocumentLabel: "Target",
          },
        ),
      ],
      placeholders,
    );
    expect(text).toEqual({
      key: "batchMovePages",
      values: {
        count: 2,
        documents: 2,
        sources: "Target 1; A 2",
        other: "Target",
      },
    });
  });

  it("첫 항목이 새 문서를 만들면 batchNewDocument, other 는 첫 원본 라벨", () => {
    const text = describeBatch(
      [
        entry(
          {
            kind: "move_pages",
            id: "c1",
            stepId: "st_c",
            fromDocumentId: "doc_1",
            pages: [p1, p2],
            to: { newDocumentId: "review-doc-n", afterDocumentId: "doc_1" },
            batchId: "b1",
          },
          {
            documentLabel: "A",
            documentIds: ["doc_1", "review-doc-n"],
            pages: [1, 2],
            otherDocumentLabel: "A",
          },
        ),
        entry(
          {
            kind: "move_pages",
            id: "c2",
            stepId: "st_c",
            fromDocumentId: "doc_2",
            pages: [p1],
            to: { documentId: "review-doc-n", index: 2 },
            batchId: "b1",
          },
          {
            documentLabel: "B",
            documentIds: ["doc_2", "review-doc-n"],
            pages: [4],
            otherDocumentLabel: "A",
          },
        ),
      ],
      placeholders,
    );
    expect(text).toEqual({
      key: "batchNewDocument",
      values: { count: 3, documents: 2, sources: "A 1, 2; B 4", other: "A" },
    });
  });
});

describe("describeEntry — 페이지 범위·새 문서·문서 제외", () => {
  const names = {
    ...placeholders,
    fileName: (ref: string) => (ref === "job_1#0" ? "a.pdf" : ref),
  };

  it("페이지 범위 지정은 파일 이름과 범위를 전·후로", () => {
    expect(
      describeEntry(
        entry(
          {
            kind: "set_page_ranges",
            stepId: "st_c",
            documentId: "doc_1",
            sourceFiles: [],
          },
          {
            beforeSourceFiles: [{ file_ref: "job_1#0", page_ranges: [[1, 3]] }],
            sourceFiles: [
              {
                file_ref: "job_1#0",
                page_ranges: [
                  [1, 2],
                  [5, 5],
                ],
              },
              { file_ref: "job_1#1", page_ranges: [[1, 1]] },
            ],
          },
        ),
        names,
      ),
    ).toEqual({
      key: "setPageRanges",
      values: { before: "a.pdf 1-3", after: "a.pdf 1-2, 5; job_1#1 1" },
    });
  });

  it("다른 문서·제외 목록에서 가져온 페이지는 조각 목록으로 싣는다", () => {
    expect(
      describeEntry(
        entry(
          {
            kind: "set_page_ranges",
            stepId: "st_c",
            documentId: "doc_2",
            sourceFiles: [],
          },
          {
            beforeSourceFiles: [{ file_ref: "job_1#0", page_ranges: [[3, 3]] }],
            sourceFiles: [{ file_ref: "job_1#0", page_ranges: [[3, 4]] }],
            takenFrom: [{ documentId: "doc_3", label: "contract", count: 1 }],
            removedDocuments: [{ documentId: "doc_3", label: "contract" }],
          },
        ),
        names,
      ),
    ).toEqual({
      key: "setPageRangesMoved",
      values: { before: "a.pdf 3", after: "a.pdf 3-4" },
      lists: {
        moved: [
          {
            key: "movedFromRemoved",
            values: { document: "contract", count: 1 },
          },
        ],
      },
    });
    expect(
      describeEntry(
        entry(
          {
            kind: "add_document",
            stepId: "st_c",
            newDocumentId: "review-doc-1",
            groupId: "g1",
            label: "memo",
            sourceFiles: [],
            index: 0,
          },
          {
            documentLabel: "memo",
            sourceFiles: [{ file_ref: "job_1#0", page_ranges: [[1, 3]] }],
            takenFrom: [{ documentId: "doc_1", label: null, count: 2 }],
            fromExcluded: 1,
          },
        ),
        names,
      ),
    ).toEqual({
      key: "addDocumentMoved",
      values: { document: "memo", ranges: "a.pdf 1-3" },
      lists: {
        moved: [
          {
            key: "movedFrom",
            values: { document: "(untitled)", count: 2 },
          },
          { key: "movedFromExcluded", values: { count: 1 } },
        ],
      },
    });
  });

  it("새 문서는 라벨(없으면 자리 문구)과 범위", () => {
    expect(
      describeEntry(
        entry(
          {
            kind: "add_document",
            stepId: "st_c",
            newDocumentId: "review-doc-1",
            groupId: "g1",
            label: null,
            sourceFiles: [],
            index: 0,
          },
          {
            documentLabel: null,
            sourceFiles: [{ file_ref: "job_1#0", page_ranges: [[4, 4]] }],
          },
        ),
        names,
      ),
    ).toEqual({
      key: "addDocument",
      values: { document: "(untitled)", ranges: "a.pdf 4" },
    });
  });

  it("문서 제외·복귀", () => {
    expect(
      describeEntry(
        entry({ kind: "exclude_document", documentId: "doc_1" }),
        names,
      ),
    ).toEqual({ key: "excludeDocument", values: { document: "Invoice" } });
    expect(
      describeEntry(
        entry({ kind: "restore_document", documentId: "doc_1" }),
        names,
      ),
    ).toEqual({ key: "restoreDocument", values: { document: "Invoice" } });
  });

  it("제외 페이지를 새 문서로 되돌리면 전용 문구", () => {
    expect(
      describeEntry(
        entry({
          kind: "restore_pages",
          stepId: "st_c",
          pages: [{ file_ref: "job_1#0", page: 3 }],
          to: { newDocumentId: "review-doc-2", afterDocumentId: "doc_1" },
        }),
        names,
      ),
    ).toEqual({ key: "restoreToNewDocument", values: { count: 1 } });
  });
});

describe("originNoteOf", () => {
  it("이력 행에서 불러온 항목은 version 을 넣은 문구", () => {
    expect(
      originNoteOf(
        entry({
          kind: "replace_subtree",
          resultId: "occ_1",
          path: [],
          value: {},
          origin: { kind: "revision", revisionId: "rev_4", version: 4 },
        } as Partial<ChangeEntry> & Pick<ChangeEntry, "kind">),
      ),
    ).toEqual({ key: "origin.revision", values: { version: 4 } });
  });

  it("최초 원본에서 불러온 구조 항목", () => {
    expect(
      originNoteOf(
        entry({
          kind: "replace_structure",
          fileGroups: { groups: [] },
          layouts: [],
          origin: { kind: "original" },
        } as unknown as Partial<ChangeEntry> & Pick<ChangeEntry, "kind">),
      ),
    ).toEqual({ key: "origin.original" });
  });

  it("출처가 없으면 null", () => {
    expect(
      originNoteOf(
        entry({
          kind: "replace_subtree",
          resultId: "occ_1",
          path: [],
          value: {},
        } as Partial<ChangeEntry> & Pick<ChangeEntry, "kind">),
      ),
    ).toBeNull();
    expect(
      originNoteOf(
        entry({
          kind: "set_value",
          resultId: "occ_1",
          path: ["a"],
          value: 1,
        } as Partial<ChangeEntry> & Pick<ChangeEntry, "kind">),
      ),
    ).toBeNull();
  });
});
