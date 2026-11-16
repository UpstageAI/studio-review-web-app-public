import { describe, expect, it } from "vitest";

import {
  movePagesTargets,
  type MovePagesCandidate,
  type MovePagesTarget,
} from "../move-pages-targets";

type Strip = {
  documentId: string;
  groupId: string;
  label: string | null;
  pages: readonly unknown[];
  locked?: boolean;
  excluded?: boolean;
};
type Batch = { documentId: string; groupId: string };

// 정리 화면(PageGrid)이 고른 페이지 묶음으로 대상을 고르던 식.
function organizerReference(
  strips: readonly Strip[],
  batch: readonly Batch[],
): MovePagesTarget[] {
  const mixedGroups = new Set(batch.map(item => item.groupId)).size > 1;
  const onlyDocumentId = batch.length === 1 ? batch[0]!.documentId : null;
  return batch.length === 0 || mixedGroups
    ? []
    : strips.flatMap((strip, index) =>
        strip.groupId === batch[0]!.groupId &&
        !strip.locked &&
        strip.documentId !== onlyDocumentId
          ? [
              {
                documentId: strip.documentId,
                index,
                label: strip.label,
                pageCount: strip.pages.length,
              },
            ]
          : [],
      );
}

function organizerAdapter(
  strips: readonly Strip[],
  batch: readonly Batch[],
): MovePagesTarget[] {
  const mixedGroups = new Set(batch.map(item => item.groupId)).size > 1;
  const onlyDocumentId = batch.length === 1 ? batch[0]!.documentId : null;
  return batch.length === 0 || mixedGroups
    ? []
    : movePagesTargets(
        strips.map(strip => ({
          documentId: strip.documentId,
          groupId: strip.groupId,
          label: strip.label,
          pageCount: strip.pages.length,
          locked: strip.locked,
        })),
        { groupId: batch[0]!.groupId, excludeDocumentId: onlyDocumentId },
      );
}

type Visible = {
  document: {
    document_id: string;
    group_id: string;
    label: string | null;
    pageCount: number;
  };
};

// 뷰어 툴바가 현재 문서 기준으로 대상을 고르던 식(`locked` 없음).
function toolbarReference(
  visible: readonly Visible[],
  selected: Visible | null,
): MovePagesTarget[] {
  if (!selected) return [];
  const { group_id: groupId, document_id: selfId } = selected.document;
  return visible.flatMap((item, index) =>
    item.document.group_id === groupId && item.document.document_id !== selfId
      ? [
          {
            documentId: item.document.document_id,
            index,
            label: item.document.label,
            pageCount: item.document.pageCount,
          },
        ]
      : [],
  );
}

function toolbarAdapter(
  visible: readonly Visible[],
  selected: Visible | null,
): MovePagesTarget[] {
  if (!selected) return [];
  return movePagesTargets(
    visible.map(item => ({
      documentId: item.document.document_id,
      groupId: item.document.group_id,
      label: item.document.label,
      pageCount: item.document.pageCount,
    })),
    {
      groupId: selected.document.group_id,
      excludeDocumentId: selected.document.document_id,
    },
  );
}

const strip = (
  documentId: string,
  groupId: string,
  pageCount: number,
  extra: Partial<Strip> = {},
): Strip => ({
  documentId,
  groupId,
  label: documentId === "c" ? null : `L-${documentId}`,
  pages: Array.from({ length: pageCount }, (_, i) => i),
  ...extra,
});

// g1 문서 사이에 g2 문서가 끼어 있고(c·e), 제외 문서(excluded)도 섞인 목록.
const baseStrips: Strip[] = [
  strip("a", "g1", 2),
  strip("b", "g1", 3),
  strip("x", "g2", 1),
  strip("c", "g1", 1, { excluded: true }),
  strip("y", "g2", 4),
  strip("d", "g1", 5),
];
const withLocked: Strip[] = baseStrips.map(item =>
  item.documentId === "b" || item.documentId === "y"
    ? { ...item, locked: true }
    : item,
);
const withLockedFalse: Strip[] = baseStrips.map(item => ({
  ...item,
  locked: false,
}));

const batches: Record<string, Batch[]> = {
  none: [],
  oneDocument: [{ documentId: "b", groupId: "g1" }],
  oneExcludedDocument: [{ documentId: "c", groupId: "g1" }],
  oneOtherGroup: [{ documentId: "x", groupId: "g2" }],
  manyDocuments: [
    { documentId: "a", groupId: "g1" },
    { documentId: "d", groupId: "g1" },
  ],
  manyIncludingExcluded: [
    { documentId: "c", groupId: "g1" },
    { documentId: "b", groupId: "g1" },
  ],
  mixedGroups: [
    { documentId: "a", groupId: "g1" },
    { documentId: "x", groupId: "g2" },
  ],
  lockedSource: [{ documentId: "y", groupId: "g2" }],
};

describe("movePagesTargets", () => {
  it("같은 그룹 · 잠기지 않음 · 제외 id 가 아닌 후보를 입력 위치 index 와 함께 순서대로", () => {
    const candidates: MovePagesCandidate[] = [
      { documentId: "a", groupId: "g1", label: "A", pageCount: 2 },
      { documentId: "x", groupId: "g2", label: "X", pageCount: 1 },
      { documentId: "b", groupId: "g1", label: null, pageCount: 3 },
      {
        documentId: "c",
        groupId: "g1",
        label: "C",
        pageCount: 4,
        locked: true,
      },
      { documentId: "d", groupId: "g1", label: "D", pageCount: 5 },
    ];
    expect(
      movePagesTargets(candidates, { groupId: "g1", excludeDocumentId: "a" }),
    ).toEqual([
      { documentId: "b", index: 2, label: null, pageCount: 3 },
      { documentId: "d", index: 4, label: "D", pageCount: 5 },
    ]);
    expect(
      movePagesTargets(candidates, { groupId: "g1", excludeDocumentId: null }),
    ).toEqual([
      { documentId: "a", index: 0, label: "A", pageCount: 2 },
      { documentId: "b", index: 2, label: null, pageCount: 3 },
      { documentId: "d", index: 4, label: "D", pageCount: 5 },
    ]);
  });

  it("후보가 없거나 같은 그룹이 없으면 빈 목록", () => {
    expect(
      movePagesTargets([], { groupId: "g1", excludeDocumentId: null }),
    ).toEqual([]);
    expect(
      movePagesTargets(
        [{ documentId: "a", groupId: "g2", label: null, pageCount: 1 }],
        { groupId: "g1", excludeDocumentId: null },
      ),
    ).toEqual([]);
  });
});

describe("다른 그룹 후보의 pageCount 는 결과에 닿지 않는다", () => {
  const candidateSets: Record<string, MovePagesCandidate[]> =
    Object.fromEntries(
      Object.entries({ baseStrips, withLocked, withLockedFalse }).map(
        ([name, strips]) => [
          name,
          strips.map(item => ({
            documentId: item.documentId,
            groupId: item.groupId,
            label: item.label,
            pageCount: item.pages.length,
            locked: item.locked,
          })),
        ],
      ),
    );
  const groupIds = ["g1", "g2", "g3"];
  const excludeIds = [null, "a", "x", "d", "z"];
  for (const [setName, candidates] of Object.entries(candidateSets)) {
    for (const groupId of groupIds) {
      it(`${setName} × ${groupId}`, () => {
        const zeroed = candidates.map(candidate =>
          candidate.groupId === groupId
            ? candidate
            : { ...candidate, pageCount: 0 },
        );
        for (const excludeDocumentId of excludeIds) {
          expect(
            movePagesTargets(zeroed, { groupId, excludeDocumentId }),
          ).toEqual(
            movePagesTargets(candidates, { groupId, excludeDocumentId }),
          );
        }
      });
    }
  }
});

describe("정리 화면 대상 목록은 지금 식과 같다", () => {
  const stripSets: Record<string, Strip[]> = {
    base: baseStrips,
    withLocked,
    withLockedFalse,
  };
  for (const [stripName, strips] of Object.entries(stripSets)) {
    for (const [batchName, batch] of Object.entries(batches)) {
      it(`${stripName} × ${batchName}`, () => {
        expect(organizerAdapter(strips, batch)).toEqual(
          organizerReference(strips, batch),
        );
      });
    }
  }

  it("한 문서 선택이면 그 문서를 빼고, 여러 문서면 원본 문서도 남는다", () => {
    expect(
      organizerAdapter(withLocked, batches.oneDocument!).map(
        item => item.documentId,
      ),
    ).toEqual(["a", "c", "d"]);
    expect(
      organizerAdapter(withLocked, batches.manyDocuments!).map(
        item => item.index,
      ),
    ).toEqual([0, 3, 5]);
    expect(organizerAdapter(withLocked, batches.mixedGroups!)).toEqual([]);
    expect(organizerAdapter(withLocked, batches.none!)).toEqual([]);
  });
});

describe("툴바 대상 목록은 지금 식과 같다(locked 없는 입력)", () => {
  const visible: Visible[] = baseStrips.map(item => ({
    document: {
      document_id: item.documentId,
      group_id: item.groupId,
      label: item.label,
      pageCount: item.pages.length,
    },
  }));
  const selections: Record<string, Visible | null> = {
    none: null,
    ...Object.fromEntries(
      visible.map(item => [item.document.document_id, item]),
    ),
    notInList: {
      document: {
        document_id: "z",
        group_id: "g1",
        label: null,
        pageCount: 1,
      },
    },
  };
  for (const [name, selected] of Object.entries(selections)) {
    it(`선택 ${name}`, () => {
      expect(toolbarAdapter(visible, selected)).toEqual(
        toolbarReference(visible, selected),
      );
    });
  }

  it("빈 목록에서도 같다", () => {
    expect(toolbarAdapter([], selections.a!)).toEqual(
      toolbarReference([], selections.a!),
    );
  });
});
