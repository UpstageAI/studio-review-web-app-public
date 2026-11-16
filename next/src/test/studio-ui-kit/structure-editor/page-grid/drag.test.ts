import { indexAfterRemoval } from "@/components/studio-ui-kit/structure-editor/shared/drag-core";
import {
  DRAG_MIME,
  dropOk,
  dropVerdict,
  expandDrag,
  gatherUnchanged,
  indexAfterRemovingPages,
  isMultiDrag,
  isPageGridDrag,
  sameTarget,
  startDrag,
  type DraggedPage,
  type DragPayload,
  type DropDocument,
  type DropTarget,
} from "@/components/studio-ui-kit/structure-editor/page-grid/drag";
import type { StructureDocument } from "@/components/studio-ui-kit/structure-editor/shared/types";

/** 테스트용 dataTransfer: 넣은 데이터와 effectAllowed 만 기록한다. */
function fakeEvent(types: readonly string[] = []) {
  const data = new Map<string, string>();
  const dataTransfer = {
    effectAllowed: "uninitialized",
    types,
    setData: (type: string, value: string) => void data.set(type, value),
  };
  return {
    event: { dataTransfer } as unknown as Parameters<typeof startDrag>[0],
    data,
    dataTransfer,
  };
}

describe("startDrag", () => {
  const payload: DragPayload = {
    kind: "page",
    documentId: "doc_1",
    pageKey: "f1:3",
    groupId: "grp_1",
    index: 2,
  };

  it("move 만 허용하고 격자 MIME 에 payload 를, text/plain 에 문서 id 를 넣는다", () => {
    const { event, data, dataTransfer } = fakeEvent();
    startDrag(event, payload);
    expect(dataTransfer.effectAllowed).toBe("move");
    expect(JSON.parse(data.get(DRAG_MIME) ?? "null")).toEqual(payload);
    expect(data.get("text/plain")).toBe("doc_1");
  });

  it("제외 칸 페이지(documentId null)는 text/plain 이 빈 문자열", () => {
    const { event, data } = fakeEvent();
    startDrag(event, { ...payload, documentId: null });
    expect(data.get("text/plain")).toBe("");
    expect(JSON.parse(data.get(DRAG_MIME) ?? "null")).toMatchObject({
      documentId: null,
    });
  });

  it("여러 장이면 JSON 에 multi 도 싣는다", () => {
    const { event, data } = fakeEvent();
    const multi: DraggedPage[] = [
      { documentId: "doc_1", pageKey: "f1:3", groupId: "grp_1", index: 2 },
      { documentId: "doc_2", pageKey: "f1:7", groupId: "grp_1", index: 0 },
    ];
    startDrag(event, { ...payload, multi });
    expect(JSON.parse(data.get(DRAG_MIME) ?? "null")).toEqual({
      ...payload,
      multi,
    });
  });

  it("MIME 은 필름스트립과 다르다", () => {
    expect(DRAG_MIME).toBe("application/x-review-page-grid");
    expect(DRAG_MIME).not.toBe("application/x-review-filmstrip");
  });
});

describe("isPageGridDrag", () => {
  it("격자 MIME 이 types 에 있을 때만 참", () => {
    expect(isPageGridDrag(fakeEvent(["text/plain", DRAG_MIME]).event)).toBe(
      true,
    );
    expect(isPageGridDrag(fakeEvent([DRAG_MIME]).event)).toBe(true);
    expect(isPageGridDrag(fakeEvent(["text/plain"]).event)).toBe(false);
    expect(isPageGridDrag(fakeEvent(["Files"]).event)).toBe(false);
    expect(
      isPageGridDrag(fakeEvent(["application/x-review-filmstrip"]).event),
    ).toBe(false);
    expect(isPageGridDrag(fakeEvent().event)).toBe(false);
  });
});

describe("dropOk", () => {
  const documents: readonly DropDocument[] = [
    { documentId: "a", groupId: "g1" },
    { documentId: "b", groupId: "g1" },
    { documentId: "locked", groupId: "g1", locked: true },
    { documentId: "other", groupId: "g2" },
  ];
  const fromA = (index: number): DragPayload => ({
    kind: "page",
    documentId: "a",
    pageKey: `f1:${index + 1}`,
    groupId: "g1",
    index,
  });
  const fromExcluded: DragPayload = {
    kind: "page",
    documentId: null,
    pageKey: "f1:9",
    groupId: "g1",
    index: 0,
  };

  it("같은 그룹의 다른 문서는 어느 자리든 받는다", () => {
    expect(
      dropOk(fromA(0), { kind: "pages", documentId: "b", index: 0 }, documents),
    ).toBe(true);
    expect(
      dropOk(fromA(0), { kind: "pages", documentId: "b", index: 7 }, documents),
    ).toBe(true);
  });

  it("다른 그룹·잠긴 문서·없는 문서는 거부한다", () => {
    expect(
      dropOk(
        fromA(0),
        { kind: "pages", documentId: "other", index: 0 },
        documents,
      ),
    ).toBe(false);
    expect(
      dropOk(
        fromA(0),
        { kind: "pages", documentId: "locked", index: 0 },
        documents,
      ),
    ).toBe(false);
    expect(
      dropOk(
        fromA(0),
        { kind: "pages", documentId: "missing", index: 0 },
        documents,
      ),
    ).toBe(false);
    expect(
      dropOk(
        { ...fromA(0), groupId: "g2" },
        { kind: "pages", documentId: "a", index: 3 },
        documents,
      ),
    ).toBe(false);
  });

  it("같은 문서 안에서는 자리가 실제로 바뀔 때만 받는다(자기 앞·뒤 틈은 그대로)", () => {
    const spot = (index: number) =>
      ({ kind: "pages", documentId: "a", index }) as const;
    expect(dropOk(fromA(2), spot(2), documents)).toBe(false);
    expect(dropOk(fromA(2), spot(3), documents)).toBe(false);
    expect(dropOk(fromA(2), spot(0), documents)).toBe(true);
    expect(dropOk(fromA(2), spot(1), documents)).toBe(true);
    expect(dropOk(fromA(2), spot(4), documents)).toBe(true);
    expect(dropOk(fromA(0), spot(0), documents)).toBe(false);
    expect(dropOk(fromA(0), spot(1), documents)).toBe(false);
    expect(dropOk(fromA(0), spot(2), documents)).toBe(true);
  });

  it("제외 칸의 페이지는 같은 그룹 문서로 되돌릴 수 있고 제외 칸에는 다시 놓을 수 없다", () => {
    expect(
      dropOk(
        fromExcluded,
        { kind: "pages", documentId: "a", index: 0 },
        documents,
      ),
    ).toBe(true);
    expect(
      dropOk(
        fromExcluded,
        { kind: "pages", documentId: "other", index: 0 },
        documents,
      ),
    ).toBe(false);
    expect(dropOk(fromExcluded, { kind: "excluded" }, documents)).toBe(false);
  });

  it("문서의 페이지는 제외 칸에 놓을 수 있다", () => {
    expect(dropOk(fromA(0), { kind: "excluded" }, documents)).toBe(true);
    expect(dropOk(fromA(5), { kind: "excluded" }, [])).toBe(true);
  });
});

describe("sameTarget", () => {
  const pages = (index: number, ok = true): DropTarget => ({
    kind: "pages",
    documentId: "a",
    index,
    ...(ok ? { ok: true } : { ok: false, reason: "group" }),
  });

  it("종류·문서·위치·ok 가 모두 같을 때만 참", () => {
    expect(sameTarget(pages(1), pages(1))).toBe(true);
    expect(sameTarget(pages(1), pages(2))).toBe(false);
    expect(sameTarget(pages(1), pages(1, false))).toBe(false);
    expect(
      sameTarget(pages(1), {
        kind: "pages",
        documentId: "b",
        index: 1,
        ok: true,
      }),
    ).toBe(false);
    expect(sameTarget(pages(1), { kind: "excluded", ok: true })).toBe(false);
  });

  it("제외 칸끼리는 ok 만 본다", () => {
    expect(
      sameTarget(
        { kind: "excluded", ok: true },
        { kind: "excluded", ok: true },
      ),
    ).toBe(true);
    expect(
      sameTarget(
        { kind: "excluded", ok: true },
        { kind: "excluded", ok: false, reason: "excluded" },
      ),
    ).toBe(false);
  });

  it("거부끼리는 사유도 같아야 참", () => {
    const at = { kind: "pages", documentId: "a", index: 1 } as const;
    expect(
      sameTarget(
        { ...at, ok: false, reason: "locked" },
        { ...at, ok: false, reason: "locked" },
      ),
    ).toBe(true);
    expect(
      sameTarget(
        { ...at, ok: false, reason: "locked" },
        { ...at, ok: false, reason: "unchanged" },
      ),
    ).toBe(false);
  });
});

describe("indexAfterRemovingPages", () => {
  it("화면 위치 앞에 있는 끄는 페이지 수만큼 당긴다", () => {
    expect(indexAfterRemovingPages(3, [])).toBe(3);
    expect(indexAfterRemovingPages(3, [0, 1])).toBe(1);
    expect(indexAfterRemovingPages(3, [4, 5])).toBe(3);
    expect(indexAfterRemovingPages(3, [0, 3, 5])).toBe(2);
    expect(indexAfterRemovingPages(0, [0, 1])).toBe(0);
    expect(indexAfterRemovingPages(6, [5, 1, 3])).toBe(3);
  });

  it("한 장이면 indexAfterRemoval 과 같다", () => {
    for (let from = 0; from < 5; from += 1) {
      for (let to = 0; to <= 5; to += 1) {
        expect(indexAfterRemovingPages(to, [from])).toBe(
          indexAfterRemoval(from, to),
        );
      }
    }
  });
});

describe("gatherUnchanged", () => {
  it("이어진 덩어리 안·바로 뒤·바로 앞에 모으면 그대로", () => {
    expect(gatherUnchanged([2, 3, 4], 2)).toBe(true);
    expect(gatherUnchanged([2, 3, 4], 3)).toBe(true);
    expect(gatherUnchanged([2, 3, 4], 5)).toBe(true);
    expect(gatherUnchanged([4, 2, 3], 4)).toBe(true);
  });

  it("떨어진 자리는 바뀐다", () => {
    expect(gatherUnchanged([2, 3, 4], 1)).toBe(false);
    expect(gatherUnchanged([2, 3, 4], 6)).toBe(false);
    expect(gatherUnchanged([2, 3, 4], 0)).toBe(false);
  });

  it("이어지지 않은 페이지는 어디에 모아도 바뀐다", () => {
    expect(gatherUnchanged([1, 3], 1)).toBe(false);
    expect(gatherUnchanged([1, 3], 2)).toBe(false);
    expect(gatherUnchanged([1, 3], 4)).toBe(false);
  });

  it("빈 목록은 참", () => {
    expect(gatherUnchanged([], 0)).toBe(true);
    expect(gatherUnchanged([], 4)).toBe(true);
  });

  it("한 장이면 indexAfterRemoval 이 제자리인지와 같다", () => {
    for (let from = 0; from < 5; from += 1) {
      for (let to = 0; to <= 5; to += 1) {
        expect(gatherUnchanged([from], to)).toBe(
          indexAfterRemoval(from, to) === from,
        );
      }
    }
  });
});

describe("expandDrag", () => {
  const page = (key: string) => ({
    key,
    fileRef: "f1",
    page: 1,
    thumbnailUrl: null,
  });
  const documents: readonly StructureDocument[] = [
    {
      documentId: "a",
      label: null,
      groupId: "g1",
      pages: [page("a0"), page("a1"), page("a2")],
    },
    {
      documentId: "b",
      label: null,
      groupId: "g1",
      pages: [page("b0"), page("dup"), page("b2")],
    },
    {
      documentId: "c",
      label: null,
      groupId: "g2",
      pages: [page("dup"), page("c1")],
    },
  ];
  const grab = (
    documentId: string | null,
    pageKey: string,
    index: number,
  ): DragPayload => ({
    kind: "page",
    documentId,
    pageKey,
    groupId: "g1",
    index,
  });

  it("선택에 든 문서 셀을 잡으면 선택 전부를 문서 순 → 문서 안 순으로 모은다", () => {
    const drag = grab("b", "b2", 2);
    const expanded = expandDrag(
      drag,
      new Set(["c1", "b2", "a2", "a0"]),
      documents,
    );
    expect(expanded).toEqual({
      ...drag,
      multi: [
        { documentId: "a", pageKey: "a0", groupId: "g1", index: 0 },
        { documentId: "a", pageKey: "a2", groupId: "g1", index: 2 },
        { documentId: "b", pageKey: "b2", groupId: "g1", index: 2 },
        { documentId: "c", pageKey: "c1", groupId: "g2", index: 1 },
      ],
    });
    expect(isMultiDrag(expanded)).toBe(true);
  });

  it("같은 키가 두 문서에 있으면 앞 문서 것만 센다", () => {
    const expanded = expandDrag(
      grab("a", "a0", 0),
      new Set(["a0", "dup"]),
      documents,
    );
    expect(expanded.multi).toEqual([
      { documentId: "a", pageKey: "a0", groupId: "g1", index: 0 },
      { documentId: "b", pageKey: "dup", groupId: "g1", index: 1 },
    ]);
  });

  it("선택 밖 셀·제외 칸 셀·선택 1 장·선택 없음은 같은 객체를 돌려준다", () => {
    const outside = grab("a", "a1", 1);
    expect(expandDrag(outside, new Set(["a0", "a2"]), documents)).toBe(outside);
    const loose = grab(null, "a0", 0);
    expect(expandDrag(loose, new Set(["a0", "a2"]), documents)).toBe(loose);
    const single = grab("a", "a0", 0);
    expect(expandDrag(single, new Set(["a0"]), documents)).toBe(single);
    expect(expandDrag(single, undefined, documents)).toBe(single);
    expect(isMultiDrag(single)).toBe(false);
    expect(isMultiDrag({ ...single, multi: [] })).toBe(false);
  });
});

describe("dropOk 여러 장", () => {
  const documents: readonly DropDocument[] = [
    { documentId: "a", groupId: "g1" },
    { documentId: "b", groupId: "g1" },
    { documentId: "locked", groupId: "g1", locked: true },
    { documentId: "other", groupId: "g2" },
  ];
  const multiOf = (
    pages: readonly [string, number, string?][],
  ): DragPayload => {
    const multi = pages.map(([documentId, index, groupId = "g1"]) => ({
      documentId,
      pageKey: `${documentId}${index}`,
      groupId,
      index,
    }));
    return { kind: "page", ...multi[0]!, multi };
  };
  const spot = (documentId: string, index: number) =>
    ({ kind: "pages", documentId, index }) as const;

  it("그룹 섞인 여러 장은 어느 문서에도 놓을 수 없고 제외 칸에는 놓을 수 있다", () => {
    const mixed = multiOf([
      ["a", 0],
      ["other", 1, "g2"],
    ]);
    expect(dropOk(mixed, spot("a", 3), documents)).toBe(false);
    expect(dropOk(mixed, spot("b", 0), documents)).toBe(false);
    expect(dropOk(mixed, spot("other", 0), documents)).toBe(false);
    expect(dropOk(mixed, { kind: "excluded" }, documents)).toBe(true);
  });

  it("다른 그룹·잠긴 문서·없는 문서는 거부한다", () => {
    const drag = multiOf([
      ["a", 0],
      ["b", 2],
    ]);
    expect(dropOk(drag, spot("other", 0), documents)).toBe(false);
    expect(dropOk(drag, spot("locked", 0), documents)).toBe(false);
    expect(dropOk(drag, spot("missing", 0), documents)).toBe(false);
  });

  it("모두 같은 문서이면 모아도 자리가 그대로일 때 거부한다", () => {
    const block = multiOf([
      ["a", 1],
      ["a", 2],
    ]);
    expect(dropOk(block, spot("a", 1), documents)).toBe(false);
    expect(dropOk(block, spot("a", 2), documents)).toBe(false);
    expect(dropOk(block, spot("a", 3), documents)).toBe(false);
    expect(dropOk(block, spot("a", 0), documents)).toBe(true);
    expect(dropOk(block, spot("a", 4), documents)).toBe(true);
    const apart = multiOf([
      ["a", 1],
      ["a", 3],
    ]);
    expect(dropOk(apart, spot("a", 1), documents)).toBe(true);
    expect(dropOk(apart, spot("a", 2), documents)).toBe(true);
  });

  it("같은 문서 일부 + 다른 문서 페이지는 그 문서 어느 자리든 받는다", () => {
    const drag = multiOf([
      ["a", 1],
      ["a", 2],
      ["b", 0],
    ]);
    expect(dropOk(drag, spot("a", 1), documents)).toBe(true);
    expect(dropOk(drag, spot("a", 2), documents)).toBe(true);
  });

  it("다른 문서 끝·제외 칸은 받는다", () => {
    const drag = multiOf([
      ["a", 1],
      ["a", 2],
    ]);
    expect(dropOk(drag, spot("b", 3), documents)).toBe(true);
    expect(dropOk(drag, { kind: "excluded" }, documents)).toBe(true);
  });
});

describe("dropVerdict", () => {
  const documents: readonly DropDocument[] = [
    { documentId: "a", groupId: "g1" },
    { documentId: "b", groupId: "g1" },
    { documentId: "locked", groupId: "g1", locked: true },
    { documentId: "other", groupId: "g2" },
  ];
  const fromA = (index: number): DragPayload => ({
    kind: "page",
    documentId: "a",
    pageKey: `f1:${index + 1}`,
    groupId: "g1",
    index,
  });
  const fromExcluded: DragPayload = {
    kind: "page",
    documentId: null,
    pageKey: "f1:9",
    groupId: "g1",
    index: 0,
  };
  const multiOf = (
    pages: readonly [string, number, string?][],
  ): DragPayload => {
    const multi = pages.map(([documentId, index, groupId = "g1"]) => ({
      documentId,
      pageKey: `${documentId}${index}`,
      groupId,
      index,
    }));
    return { kind: "page", ...multi[0]!, multi };
  };
  const spot = (documentId: string, index: number) =>
    ({ kind: "pages", documentId, index }) as const;

  it("한 장: 받는 자리와 거부 사유", () => {
    expect(dropVerdict(fromA(1), spot("b", 0), documents)).toEqual({
      ok: true,
    });
    expect(dropVerdict(fromA(1), spot("a", 1), documents)).toEqual({
      ok: false,
      reason: "unchanged",
    });
    expect(dropVerdict(fromA(1), spot("a", 2), documents)).toEqual({
      ok: false,
      reason: "unchanged",
    });
    expect(dropVerdict(fromA(1), spot("other", 0), documents)).toEqual({
      ok: false,
      reason: "group",
    });
    expect(dropVerdict(fromA(1), spot("locked", 0), documents)).toEqual({
      ok: false,
      reason: "locked",
    });
    expect(dropVerdict(fromA(1), spot("missing", 0), documents)).toEqual({
      ok: false,
      reason: "locked",
    });
    expect(dropVerdict(fromA(1), { kind: "excluded" }, documents)).toEqual({
      ok: true,
    });
    expect(dropVerdict(fromExcluded, { kind: "excluded" }, documents)).toEqual({
      ok: false,
      reason: "excluded",
    });
  });

  it("잠긴 다른 그룹 문서는 잠김이 먼저다", () => {
    expect(
      dropVerdict(fromA(0), spot("x", 0), [
        { documentId: "x", groupId: "g2", locked: true },
      ]),
    ).toEqual({ ok: false, reason: "locked" });
  });

  it("여러 장: 제자리 모음은 unchanged, 그룹 섞임은 group", () => {
    const block = multiOf([
      ["a", 1],
      ["a", 2],
    ]);
    expect(dropVerdict(block, spot("a", 1), documents)).toEqual({
      ok: false,
      reason: "unchanged",
    });
    expect(dropVerdict(block, spot("a", 3), documents)).toEqual({
      ok: false,
      reason: "unchanged",
    });
    expect(dropVerdict(block, spot("a", 0), documents)).toEqual({ ok: true });
    const mixed = multiOf([
      ["a", 0],
      ["other", 1, "g2"],
    ]);
    expect(dropVerdict(mixed, spot("a", 3), documents)).toEqual({
      ok: false,
      reason: "group",
    });
    expect(dropVerdict(mixed, { kind: "excluded" }, documents)).toEqual({
      ok: true,
    });
  });
});
