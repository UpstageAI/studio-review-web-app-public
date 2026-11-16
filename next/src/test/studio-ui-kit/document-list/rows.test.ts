import {
  buildRows,
  listWindow,
  scrollTopToReveal,
} from "@/components/studio-ui-kit/document-list/rows";

const item = (
  id: string,
  extra: { ordinal?: number; groupLabel?: string } = {},
) => ({
  id,
  label: id,
  pageCount: 1,
  ...extra,
});

describe("buildRows", () => {
  it("그룹 머리는 groupLabel 이 직전과 다른 자리에만 들어가고, 연속 그룹은 머리 하나", () => {
    const rows = buildRows([
      item("a", { groupLabel: "G1" }),
      item("b", { groupLabel: "G1" }),
      item("c", { groupLabel: "G2" }),
      item("d", { groupLabel: "G1" }),
    ]);
    expect(rows.map(row => row.kind)).toEqual([
      "header",
      "item",
      "item",
      "header",
      "item",
      "header",
      "item",
    ]);
    expect(
      rows.filter(row => row.kind === "header").map(row => row.key),
    ).toEqual(["header:a", "header:c", "header:d"]);
  });

  it("groupLabel 이 없으면 머리가 없다", () => {
    const rows = buildRows([item("a"), item("b")]);
    expect(rows.map(row => row.kind)).toEqual(["item", "item"]);
  });

  it("ordinal 은 넘긴 값, 없으면 배열 위치 + 1", () => {
    const rows = buildRows([item("a", { ordinal: 7 }), item("b")]);
    expect(
      rows.flatMap(row => (row.kind === "item" ? [row.ordinal] : [])),
    ).toEqual([7, 2]);
  });

  it("제외 페이지가 있으면 맨 끝에 제외 행, 0 이거나 없으면 생략", () => {
    expect(buildRows([item("a")], { pageCount: 3 }).at(-1)).toEqual({
      kind: "excluded",
      key: "excluded",
      pageCount: 3,
    });
    expect(buildRows([item("a")], { pageCount: 0 })).toHaveLength(1);
    expect(buildRows([item("a")], null)).toHaveLength(1);
    expect(buildRows([item("a")])).toHaveLength(1);
  });

  it("문서 id 가 excluded·header:… 여도 행 키가 겹치지 않는다", () => {
    const rows = buildRows(
      [
        item("excluded", { groupLabel: "G1" }),
        item("header:excluded", { groupLabel: "G2" }),
      ],
      { pageCount: 1 },
    );
    const keys = rows.map(row => row.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual([
      "header:excluded",
      "item:excluded",
      "header:header:excluded",
      "item:header:excluded",
      "excluded",
    ]);
  });

  it("문서가 없고 제외만 있으면 제외 행 하나", () => {
    expect(buildRows([], { pageCount: 2 }).map(row => row.kind)).toEqual([
      "excluded",
    ]);
  });
});

describe("listWindow", () => {
  const base = { count: 200, rowHeight: 40, viewportHeight: 400 };

  it("맨 위: 보이는 행 + 1 + overscan 만 그리고 위 스페이서는 0", () => {
    const view = listWindow({ ...base, scrollTop: 0, overscan: 5 });
    expect(view).toEqual({
      start: 0,
      end: 16,
      topSpacer: 0,
      bottomSpacer: (200 - 16) * 40,
    });
  });

  it("가운데: 앞뒤로 overscan 만큼 더 그리고 스페이서가 나머지를 채운다", () => {
    const view = listWindow({ ...base, scrollTop: 100 * 40, overscan: 5 });
    expect(view.start).toBe(95);
    expect(view.end).toBe(100 + 11 + 5);
    expect(view.topSpacer).toBe(95 * 40);
    expect(view.bottomSpacer).toBe((200 - view.end) * 40);
    expect(
      view.topSpacer + (view.end - view.start) * 40 + view.bottomSpacer,
    ).toBe(200 * 40);
  });

  it("끝: end 는 count 를 넘지 않고 아래 스페이서는 0", () => {
    const view = listWindow({ ...base, scrollTop: 190 * 40, overscan: 5 });
    expect(view.end).toBe(200);
    expect(view.bottomSpacer).toBe(0);
    expect(view.start).toBe(185);
  });

  it("scrollTop 이 목록 끝을 넘어도 마지막 행은 그린다", () => {
    const view = listWindow({ ...base, scrollTop: 10_000 * 40, overscan: 5 });
    expect(view.start).toBe(194);
    expect(view.end).toBe(200);
  });

  it("overscan 기본은 5, 0 이면 보이는 범위만", () => {
    expect(listWindow({ ...base, scrollTop: 0 }).end).toBe(16);
    expect(listWindow({ ...base, scrollTop: 0, overscan: 0 })).toMatchObject({
      start: 0,
      end: 11,
    });
  });

  it("count 0 이나 rowHeight 0 이면 빈 창", () => {
    expect(listWindow({ ...base, count: 0, scrollTop: 0 })).toEqual({
      start: 0,
      end: 0,
      topSpacer: 0,
      bottomSpacer: 0,
    });
    expect(listWindow({ ...base, rowHeight: 0, scrollTop: 0 })).toEqual({
      start: 0,
      end: 0,
      topSpacer: 0,
      bottomSpacer: 0,
    });
  });

  it("viewport 0(아직 못 잼)은 행 10 개 높이로 본다", () => {
    const view = listWindow({
      count: 200,
      rowHeight: 40,
      viewportHeight: 0,
      scrollTop: 0,
      overscan: 5,
    });
    expect(view.end).toBe(10 + 1 + 5);
  });

  it("행 수가 창보다 적으면 전부 그린다", () => {
    expect(listWindow({ ...base, count: 5, scrollTop: 0 })).toEqual({
      start: 0,
      end: 5,
      topSpacer: 0,
      bottomSpacer: 0,
    });
  });
});

describe("scrollTopToReveal", () => {
  const base = { rowHeight: 40, viewportHeight: 400 };

  it("이미 다 보이면 null", () => {
    expect(scrollTopToReveal({ ...base, index: 3, scrollTop: 0 })).toBeNull();
    expect(scrollTopToReveal({ ...base, index: 9, scrollTop: 0 })).toBeNull();
    expect(scrollTopToReveal({ ...base, index: 10, scrollTop: 40 })).toBeNull();
  });

  it("위로 벗어났으면 행 위를 창 위에 맞춘다", () => {
    expect(scrollTopToReveal({ ...base, index: 2, scrollTop: 200 })).toBe(80);
    expect(scrollTopToReveal({ ...base, index: 0, scrollTop: 1 })).toBe(0);
  });

  it("아래로 벗어났으면 행 아래를 창 아래에 맞춘다", () => {
    expect(scrollTopToReveal({ ...base, index: 10, scrollTop: 0 })).toBe(40);
    expect(scrollTopToReveal({ ...base, index: 50, scrollTop: 0 })).toBe(
      51 * 40 - 400,
    );
  });

  it("반쯤 걸친 행도 보이게 옮긴다", () => {
    expect(scrollTopToReveal({ ...base, index: 5, scrollTop: 210 })).toBe(200);
    expect(scrollTopToReveal({ ...base, index: 10, scrollTop: 30 })).toBe(40);
  });

  it("viewport 0 은 행 10 개로 보고, 음수 index 나 rowHeight 0 은 null", () => {
    expect(
      scrollTopToReveal({
        index: 10,
        rowHeight: 40,
        scrollTop: 0,
        viewportHeight: 0,
      }),
    ).toBe(40);
    expect(scrollTopToReveal({ ...base, index: -1, scrollTop: 0 })).toBeNull();
    expect(
      scrollTopToReveal({
        index: 3,
        rowHeight: 0,
        scrollTop: 0,
        viewportHeight: 400,
      }),
    ).toBeNull();
  });
});
