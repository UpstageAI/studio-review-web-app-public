import {
  BLOCK_GAP,
  buildGridRows,
  CELL_GAP,
  CELL_SIZES,
  cellPitchOf,
  columnsFor,
  DEFAULT_COLUMNS,
  dropIndexInRow,
  EMPTY_BLOCK_HEIGHT,
  gridWindow,
  HEADER_HEIGHT,
  HEADER_ROW_HEIGHT,
  rowHeightOf,
  rowOfPage,
  scrollTopToRevealSpan,
  segmentSpacers,
  SPLIT_BUTTON_SIZE,
  splitButtonOffset,
  windowSegments,
  type GridRow,
} from "@/components/studio-ui-kit/structure-editor/page-grid/rows";
import type {
  StructureDocument,
  StructureLoosePage,
  StructurePage,
} from "@/components/studio-ui-kit/structure-editor/shared/types";

const pages = (prefix: string, count: number): StructurePage[] =>
  Array.from({ length: count }, (_, i) => ({
    key: `${prefix}:${i + 1}`,
    fileRef: "f1",
    page: i + 1,
    thumbnailUrl: null,
  }));

const loose = (prefix: string, count: number): StructureLoosePage[] =>
  pages(prefix, count).map(page => ({ ...page, groupId: "g1" }));

const doc = (
  documentId: string,
  count: number,
  extra: Partial<StructureDocument> = {},
): StructureDocument => ({
  documentId,
  label: documentId,
  groupId: "g1",
  pages: pages(documentId, count),
  ...extra,
});

const kinds = (rows: readonly GridRow[]) => rows.map(row => row.kind);
const spans = (rows: readonly GridRow[]) =>
  rows.flatMap(row => (row.kind === "cells" ? [[row.start, row.end]] : []));

describe("상수", () => {
  it("셀 행 높이는 썸네일 + 캡션 + 간격(S 108, M 172), 머리 행은 머리 + 블록 여백(52)", () => {
    expect(rowHeightOf("s")).toBe(108);
    expect(rowHeightOf("m")).toBe(172);
    expect(rowHeightOf("s")).toBe(CELL_SIZES.s.height + 20 + CELL_GAP);
    expect(HEADER_ROW_HEIGHT).toBe(HEADER_HEIGHT + BLOCK_GAP);
    expect(HEADER_ROW_HEIGHT).toBe(52);
    expect(EMPTY_BLOCK_HEIGHT).toBe(48);
  });

  it("셀 피치는 썸네일 폭 + 간격(S 72, M 120)", () => {
    expect(cellPitchOf("s")).toBe(72);
    expect(cellPitchOf("m")).toBe(120);
  });
});

describe("columnsFor", () => {
  it("폭을 아직 재지 못했으면(0 이하·NaN) 크기별 기본 열 수", () => {
    expect(columnsFor(0, "s")).toBe(DEFAULT_COLUMNS.s);
    expect(columnsFor(0, "m")).toBe(DEFAULT_COLUMNS.m);
    expect(columnsFor(0, "s")).toBe(8);
    expect(columnsFor(0, "m")).toBe(5);
    expect(columnsFor(-10, "s")).toBe(8);
    expect(columnsFor(Number.NaN, "m")).toBe(5);
  });

  it("마지막 셀 뒤 간격은 세지 않는다(S: 64 → 1, 135 → 1, 136 → 2)", () => {
    expect(columnsFor(64, "s")).toBe(1);
    expect(columnsFor(135, "s")).toBe(1);
    expect(columnsFor(136, "s")).toBe(2);
    expect(columnsFor(500, "s")).toBe(7);
    expect(columnsFor(112, "m")).toBe(1);
    expect(columnsFor(231, "m")).toBe(1);
    expect(columnsFor(232, "m")).toBe(2);
    expect(columnsFor(600, "m")).toBe(5);
  });

  it("폭이 셀 하나보다 좁아도 최소 1 열", () => {
    expect(columnsFor(10, "s")).toBe(1);
    expect(columnsFor(1, "m")).toBe(1);
  });
});

describe("buildGridRows", () => {
  const documents = [doc("a", 5), doc("b", 4), doc("c", 1)];

  it("문서마다 머리 행 + 열 수로 끊은 셀 행, 끝에 빈 제외 칸(머리 + 안내 행), 빠진 칸은 없으면 생략", () => {
    const { rows, offsets, total } = buildGridRows({
      documents,
      excluded: [],
      columns: 4,
      size: "s",
    });
    expect(kinds(rows)).toEqual([
      "header",
      "cells",
      "cells",
      "header",
      "cells",
      "header",
      "cells",
      "header",
      "empty",
    ]);
    expect(spans(rows)).toEqual([
      [0, 4],
      [4, 5],
      [0, 4],
      [0, 1],
    ]);
    expect(rows.map(row => row.key)).toEqual([
      "document:a#header",
      "document:a#row0",
      "document:a#row1",
      "document:b#header",
      "document:b#row0",
      "document:c#header",
      "document:c#row0",
      "excluded#header",
      "excluded#empty",
    ]);
    expect(rows.map(row => row.height)).toEqual([
      52, 108, 108, 52, 108, 52, 108, 52, 48,
    ]);
    expect(offsets).toEqual([0, 52, 160, 268, 320, 428, 480, 588, 640, 688]);
    expect(total).toBe(688);
    expect(offsets).toHaveLength(rows.length + 1);
  });

  it("셀 행의 rowIndex 와 블록 정보가 들어 있다", () => {
    const { rows } = buildGridRows({
      documents,
      excluded: [],
      columns: 4,
      size: "s",
    });
    const second = rows[2];
    expect(second).toMatchObject({
      kind: "cells",
      rowIndex: 1,
      start: 4,
      end: 5,
      block: { kind: "document", index: 0 },
    });
    if (second?.kind === "cells" && second.block.kind === "document") {
      expect(second.block.document.documentId).toBe("a");
    }
    expect(rows[3]).toMatchObject({
      kind: "header",
      block: { kind: "document", index: 1 },
    });
  });

  it("M 크기는 셀 행만 높아진다", () => {
    const { rows, total } = buildGridRows({
      documents,
      excluded: [],
      columns: 4,
      size: "m",
    });
    expect(rows.map(row => row.height)).toEqual([
      52, 172, 172, 52, 172, 52, 172, 52, 48,
    ]);
    expect(total).toBe(52 * 4 + 172 * 4 + 48);
  });

  it("그룹 경계: boundariesAfter 에 든 문서 바로 뒤 머리 행만 boundaryBefore", () => {
    const flags = (boundaries: number[]) =>
      buildGridRows({
        documents,
        excluded: [],
        groupBoundariesAfter: boundaries,
        columns: 4,
        size: "s",
      })
        .rows.filter(row => row.kind === "header")
        .map(row => row.kind === "header" && row.boundaryBefore);
    expect(flags([0])).toEqual([false, true, false, false]);
    expect(flags([0, 1])).toEqual([false, true, true, false]);
    // 마지막 문서 뒤·범위 밖은 어느 머리에도 붙지 않고, 제외 칸 머리는 늘 false.
    expect(flags([2, -1, 99])).toEqual([false, false, false, false]);
    expect(flags([])).toEqual([false, false, false, false]);
  });

  it("제외·빠진 페이지가 있으면 각각 머리 + 셀 행이고 안내 행은 없다", () => {
    const { rows } = buildGridRows({
      documents: [doc("a", 2)],
      excluded: loose("x", 5),
      unplaced: loose("u", 1),
      columns: 4,
      size: "s",
    });
    expect(kinds(rows)).toEqual([
      "header",
      "cells",
      "header",
      "cells",
      "cells",
      "header",
      "cells",
    ]);
    expect(rows.map(row => row.key).slice(2)).toEqual([
      "excluded#header",
      "excluded#row0",
      "excluded#row1",
      "unplaced#header",
      "unplaced#row0",
    ]);
    expect(rows[3]).toMatchObject({ block: { kind: "excluded" }, end: 4 });
    expect(rows[6]).toMatchObject({ block: { kind: "unplaced" }, end: 1 });
  });

  it("문서가 없으면 제외 칸만, 페이지 없는 문서는 머리 행만", () => {
    expect(
      kinds(
        buildGridRows({ documents: [], excluded: [], columns: 4, size: "s" })
          .rows,
      ),
    ).toEqual(["header", "empty"]);
    expect(
      kinds(
        buildGridRows({
          documents: [doc("empty", 0), doc("b", 1)],
          excluded: [],
          columns: 4,
          size: "s",
        }).rows,
      ),
    ).toEqual(["header", "header", "cells", "header", "empty"]);
  });

  it("열 수가 쓸모없으면(0·소수·NaN) 1 열로 본다", () => {
    const one = buildGridRows({
      documents: [doc("a", 3)],
      excluded: [],
      columns: 0,
      size: "s",
    });
    expect(spans(one.rows)).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
    expect(
      spans(
        buildGridRows({
          documents: [doc("a", 3)],
          excluded: [],
          columns: Number.NaN,
          size: "s",
        }).rows,
      ),
    ).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
    expect(
      spans(
        buildGridRows({
          documents: [doc("a", 3)],
          excluded: [],
          columns: 2.9,
          size: "s",
        }).rows,
      ),
    ).toEqual([
      [0, 2],
      [2, 3],
    ]);
  });
});

describe("gridWindow", () => {
  // a(5)·b(4)·c(1) × 4 열, S: 머리 52 · 셀 108 · 빈 제외 48 → 전체 688.
  const { rows, offsets, total } = buildGridRows({
    documents: [doc("a", 5), doc("b", 4), doc("c", 1)],
    excluded: [],
    columns: 4,
    size: "s",
  });
  const heightBetween = (start: number, end: number) =>
    rows.slice(start, end).reduce((sum, row) => sum + row.height, 0);

  it("맨 위: 창에 걸치는 행까지, 위 스페이서 0", () => {
    const win = gridWindow({ offsets, scrollTop: 0, viewportHeight: 300 });
    expect(win).toEqual({ start: 0, end: 4, topSpacer: 0, bottomSpacer: 368 });
    expect(
      win.topSpacer + heightBetween(win.start, win.end) + win.bottomSpacer,
    ).toBe(total);
  });

  it("overscan 은 픽셀로 위·아래에 더한다", () => {
    const win = gridWindow({
      offsets,
      scrollTop: 0,
      viewportHeight: 300,
      overscanPx: 60,
    });
    expect(win).toEqual({ start: 0, end: 5, topSpacer: 0, bottomSpacer: 260 });
  });

  it("가운데: scrollTop 이 든 행부터 창 아래가 든 행까지, 스페이서가 나머지를 채운다", () => {
    const win = gridWindow({ offsets, scrollTop: 300, viewportHeight: 200 });
    expect(win).toEqual({
      start: 3,
      end: 7,
      topSpacer: 268,
      bottomSpacer: 100,
    });
    expect(
      win.topSpacer + heightBetween(win.start, win.end) + win.bottomSpacer,
    ).toBe(total);
  });

  it("경계: 창 아래와 정확히 같은 y 에서 시작하는 행은 그리지 않고, scrollTop 이 행 위와 같으면 그 행부터", () => {
    expect(gridWindow({ offsets, scrollTop: 0, viewportHeight: 320 }).end).toBe(
      4,
    );
    expect(gridWindow({ offsets, scrollTop: 0, viewportHeight: 321 }).end).toBe(
      5,
    );
    expect(
      gridWindow({ offsets, scrollTop: 52, viewportHeight: 100 }).start,
    ).toBe(1);
    expect(
      gridWindow({ offsets, scrollTop: 51, viewportHeight: 100 }).start,
    ).toBe(0);
  });

  it("끝: end 는 행 수를 넘지 않고 아래 스페이서는 0", () => {
    const win = gridWindow({ offsets, scrollTop: 600, viewportHeight: 300 });
    expect(win).toEqual({ start: 7, end: 9, topSpacer: 588, bottomSpacer: 0 });
  });

  it("scrollTop 이 끝을 넘어도(격자가 줄어든 직후) 마지막 행은 그린다", () => {
    const win = gridWindow({ offsets, scrollTop: 5000, viewportHeight: 300 });
    expect(win).toEqual({ start: 8, end: 9, topSpacer: 640, bottomSpacer: 0 });
  });

  it("음수 scrollTop(튕김)은 첫 행부터, 아래는 실제 창 아래(y 250)가 든 행까지", () => {
    expect(
      gridWindow({ offsets, scrollTop: -50, viewportHeight: 300 }),
    ).toEqual({ start: 0, end: 3, topSpacer: 0, bottomSpacer: 420 });
  });

  it("창 높이 0(아직 못 잼)은 S 셀 행 10 개 높이(1080)로 본다", () => {
    const uniform = Array.from({ length: 31 }, (_, i) => i * 108);
    expect(
      gridWindow({ offsets: uniform, scrollTop: 0, viewportHeight: 0 }),
    ).toEqual({ start: 0, end: 10, topSpacer: 0, bottomSpacer: 20 * 108 });
    expect(gridWindow({ offsets, scrollTop: 0, viewportHeight: 0 })).toEqual({
      start: 0,
      end: 9,
      topSpacer: 0,
      bottomSpacer: 0,
    });
  });

  it("행이 없거나 전체 높이가 0 이면 전부 0", () => {
    const empty = { start: 0, end: 0, topSpacer: 0, bottomSpacer: 0 };
    expect(
      gridWindow({ offsets: [0], scrollTop: 0, viewportHeight: 300 }),
    ).toEqual(empty);
    expect(
      gridWindow({ offsets: [], scrollTop: 0, viewportHeight: 300 }),
    ).toEqual(empty);
    expect(
      gridWindow({ offsets: [0, 0], scrollTop: 0, viewportHeight: 300 }),
    ).toEqual(empty);
  });

  it("음수 overscan 은 0 으로 본다", () => {
    expect(
      gridWindow({
        offsets,
        scrollTop: 0,
        viewportHeight: 300,
        overscanPx: -99,
      }),
    ).toEqual(gridWindow({ offsets, scrollTop: 0, viewportHeight: 300 }));
  });
});

describe("rowOfPage", () => {
  const { rows } = buildGridRows({
    documents: [doc("a", 5), doc("b", 4), doc("c", 1)],
    excluded: loose("x", 2),
    unplaced: loose("u", 1),
    columns: 4,
    size: "s",
  });

  it("문서 페이지가 든 셀 행", () => {
    expect(rowOfPage(rows, "a", "a:1")).toBe(1);
    expect(rowOfPage(rows, "a", "a:4")).toBe(1);
    expect(rowOfPage(rows, "a", "a:5")).toBe(2);
    expect(rowOfPage(rows, "b", "b:4")).toBe(4);
    expect(rowOfPage(rows, "c", "c:1")).toBe(6);
  });

  it("documentId null 은 제외 칸에서 찾는다", () => {
    expect(rowOfPage(rows, null, "x:2")).toBe(8);
    expect(rowOfPage(rows, null, "a:1")).toBe(-1);
  });

  it("없는 문서·다른 문서의 키·빠진 칸 페이지는 -1", () => {
    expect(rowOfPage(rows, "zzz", "a:1")).toBe(-1);
    expect(rowOfPage(rows, "a", "b:1")).toBe(-1);
    expect(rowOfPage(rows, "a", "nope")).toBe(-1);
    expect(rowOfPage(rows, null, "u:1")).toBe(-1);
    expect(rowOfPage([], "a", "a:1")).toBe(-1);
  });
});

describe("scrollTopToRevealSpan", () => {
  const base = { height: 108, viewportHeight: 400 };

  it("이미 다 보이면 null(경계에 딱 맞아도)", () => {
    expect(
      scrollTopToRevealSpan({ ...base, top: 100, scrollTop: 50 }),
    ).toBeNull();
    expect(
      scrollTopToRevealSpan({ ...base, top: 50, scrollTop: 50 }),
    ).toBeNull();
    expect(
      scrollTopToRevealSpan({ ...base, top: 342, scrollTop: 50 }),
    ).toBeNull();
  });

  it("위로 벗어났으면 구간 위를 창 위에 맞춘다", () => {
    expect(scrollTopToRevealSpan({ ...base, top: 20, scrollTop: 50 })).toBe(20);
    expect(scrollTopToRevealSpan({ ...base, top: 0, scrollTop: 1 })).toBe(0);
    expect(scrollTopToRevealSpan({ ...base, top: 49, scrollTop: 50 })).toBe(49);
  });

  it("아래로 벗어났으면 구간 아래를 창 아래에 맞춘다", () => {
    expect(scrollTopToRevealSpan({ ...base, top: 400, scrollTop: 0 })).toBe(
      108,
    );
    expect(scrollTopToRevealSpan({ ...base, top: 343, scrollTop: 50 })).toBe(
      51,
    );
    expect(
      scrollTopToRevealSpan({
        top: 0,
        height: 10,
        scrollTop: -500,
        viewportHeight: 400,
      }),
    ).toBe(0);
  });

  it("창 높이 0 은 S 셀 행 10 개(1080)로 본다", () => {
    expect(
      scrollTopToRevealSpan({
        top: 1000,
        height: 108,
        scrollTop: 0,
        viewportHeight: 0,
      }),
    ).toBe(28);
    expect(
      scrollTopToRevealSpan({
        top: 900,
        height: 108,
        scrollTop: 0,
        viewportHeight: 0,
      }),
    ).toBeNull();
  });
});

describe("dropIndexInRow", () => {
  // S: 피치 72, 썸네일 64 → 셀 c 의 가운데는 72c + 32. 행은 화면 x 100 에서 시작.
  const row = {
    rowLeft: 100,
    columns: 4,
    size: "s" as const,
    rowStart: 0,
    count: 8,
  };

  it("셀 가운데보다 왼쪽이면 그 셀 앞, 오른쪽이면 뒤", () => {
    expect(dropIndexInRow({ ...row, clientX: 100 })).toBe(0);
    expect(dropIndexInRow({ ...row, clientX: 132 })).toBe(0);
    expect(dropIndexInRow({ ...row, clientX: 133 })).toBe(1);
    expect(dropIndexInRow({ ...row, clientX: 172 })).toBe(1);
    expect(dropIndexInRow({ ...row, clientX: 205 })).toBe(2);
    expect(dropIndexInRow({ ...row, clientX: 100 + 3 * 72 + 33 })).toBe(4);
  });

  it("셀 사이 간격은 앞 셀의 뒤로 본다", () => {
    expect(dropIndexInRow({ ...row, clientX: 168 })).toBe(1);
    expect(dropIndexInRow({ ...row, clientX: 171 })).toBe(1);
  });

  it("행의 마지막 셀보다 오른쪽(빈 자리·행 밖)은 그 행의 끝", () => {
    expect(dropIndexInRow({ ...row, clientX: 100 + 4 * 72 })).toBe(4);
    expect(dropIndexInRow({ ...row, clientX: 10_000 })).toBe(4);
  });

  it("행 왼쪽 밖은 그 행의 처음", () => {
    expect(dropIndexInRow({ ...row, clientX: 50 })).toBe(0);
    expect(dropIndexInRow({ ...row, clientX: 50, rowStart: 4 })).toBe(4);
  });

  it("마지막 행은 남은 셀 수만큼만 세고 count 를 넘지 않는다", () => {
    const last = { ...row, rowStart: 4, count: 5 };
    expect(dropIndexInRow({ ...last, clientX: 110 })).toBe(4);
    expect(dropIndexInRow({ ...last, clientX: 140 })).toBe(5);
    expect(dropIndexInRow({ ...last, clientX: 300 })).toBe(5);
    expect(
      dropIndexInRow({ ...row, rowStart: 4, count: 4, clientX: 300 }),
    ).toBe(4);
    expect(
      dropIndexInRow({ ...row, rowStart: 9, count: 4, clientX: 300 }),
    ).toBe(4);
  });

  it("M 크기는 피치 120·가운데 56", () => {
    const m = { ...row, size: "m" as const };
    expect(dropIndexInRow({ ...m, clientX: 156 })).toBe(0);
    expect(dropIndexInRow({ ...m, clientX: 157 })).toBe(1);
    expect(dropIndexInRow({ ...m, clientX: 230 })).toBe(1);
    expect(dropIndexInRow({ ...m, clientX: 277 })).toBe(2);
  });

  it("열 수가 쓸모없으면 1 열로 본다", () => {
    expect(dropIndexInRow({ ...row, columns: 0, clientX: 300 })).toBe(1);
    expect(dropIndexInRow({ ...row, columns: 0, clientX: 110 })).toBe(0);
  });
});

describe("windowSegments · segmentSpacers", () => {
  // 행 높이 10 씩 10 행.
  const offsets = Array.from({ length: 11 }, (_, i) => i * 10);
  const window = { start: 3, end: 6, topSpacer: 30, bottomSpacer: 40 };

  it("고정할 행이 없거나(-1·범위 밖) 창 안이면 창 범위 하나", () => {
    expect(windowSegments(window, -1, 10)).toEqual([{ start: 3, end: 6 }]);
    expect(windowSegments(window, 10, 10)).toEqual([{ start: 3, end: 6 }]);
    expect(windowSegments(window, 3, 10)).toEqual([{ start: 3, end: 6 }]);
    expect(windowSegments(window, 5, 10)).toEqual([{ start: 3, end: 6 }]);
    expect(windowSegments(window, Number.NaN, 10)).toEqual([
      { start: 3, end: 6 },
    ]);
  });

  it("창 위의 행은 앞에, 창 아래의 행은 뒤에 따로 둔다", () => {
    expect(windowSegments(window, 1, 10)).toEqual([
      { start: 1, end: 2 },
      { start: 3, end: 6 },
    ]);
    expect(windowSegments(window, 8, 10)).toEqual([
      { start: 3, end: 6 },
      { start: 8, end: 9 },
    ]);
  });

  it("빈 창은 구간이 없다", () => {
    expect(
      windowSegments(
        { start: 0, end: 0, topSpacer: 0, bottomSpacer: 0 },
        2,
        10,
      ),
    ).toEqual([]);
  });

  it("스페이서는 첫 구간 위·구간 사이·마지막 구간 아래 순이고 합이 전체 높이와 맞는다", () => {
    expect(segmentSpacers(offsets, [{ start: 3, end: 6 }])).toEqual([30, 40]);
    expect(
      segmentSpacers(offsets, [
        { start: 1, end: 2 },
        { start: 3, end: 6 },
      ]),
    ).toEqual([10, 10, 40]);
    expect(
      segmentSpacers(offsets, [
        { start: 3, end: 6 },
        { start: 8, end: 9 },
      ]),
    ).toEqual([30, 20, 10]);
    expect(segmentSpacers(offsets, [])).toEqual([100]);
    expect(segmentSpacers([0], [])).toEqual([0]);
  });
});

describe("splitButtonOffset", () => {
  it("행 중간 셀은 앞 셀과의 틈 가운데에 칩 중심을 둔다", () => {
    const { left } = splitButtonOffset("m", false);
    expect(left + SPLIT_BUTTON_SIZE / 2).toBe(-CELL_GAP / 2);
  });

  it("행의 첫 셀은 셀 안쪽(왼쪽 끝 2px)에 둔다", () => {
    expect(splitButtonOffset("s", true).left).toBe(2);
    expect(splitButtonOffset("m", true).left).toBe(2);
  });

  it("세로는 크기별 썸네일 가운데에 칩 중심을 둔다", () => {
    for (const size of ["s", "m"] as const) {
      const { top } = splitButtonOffset(size, false);
      expect(top + SPLIT_BUTTON_SIZE / 2).toBe(CELL_SIZES[size].height / 2);
    }
  });
});
