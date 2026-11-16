import {
  dropIndexFromX,
  hiddenCounts,
  neighborhoodStrips,
  pageMenuItems,
  pageWindow,
  recenterViewport,
  THUMBNAIL_CENTER,
  THUMBNAIL_PITCH,
} from "@/components/studio-ui-kit/structure-editor/filmstrip/window";

const strip = (documentId: string, pages: number) => ({
  documentId,
  pages: Array.from({ length: pages }, (_, i) => `${documentId}:${i + 1}`),
});

const strips = [
  strip("a", 5),
  strip("b", 2),
  strip("c", 40),
  strip("d", 7),
  strip("e", 1),
];

describe("neighborhoodStrips", () => {
  it("가운데 문서: 앞 띠는 끝 3 쪽, 선택 띠는 펼침, 뒤 띠는 앞 3 쪽", () => {
    expect(neighborhoodStrips(strips, "c", 3)).toEqual([
      {
        index: 1,
        presentation: {
          kind: "collapsed",
          side: "end",
          offset: 0,
          visible: 2,
          hidden: 0,
        },
      },
      { index: 2, presentation: { kind: "windowed" } },
      {
        index: 3,
        presentation: {
          kind: "collapsed",
          side: "start",
          offset: 0,
          visible: 3,
          hidden: 4,
        },
      },
    ]);
  });

  it("긴 앞 문서는 끝 쪽만 보이고 offset 이 그 위치", () => {
    expect(neighborhoodStrips(strips, "d", 3)?.[0]).toEqual({
      index: 2,
      presentation: {
        kind: "collapsed",
        side: "end",
        offset: 37,
        visible: 3,
        hidden: 37,
      },
    });
  });

  it("첫 문서는 앞 띠가 없고, 마지막 문서는 뒤 띠가 없다", () => {
    expect(neighborhoodStrips(strips, "a", 3)?.map(s => s.index)).toEqual([
      0, 1,
    ]);
    expect(neighborhoodStrips(strips, "e", 3)?.map(s => s.index)).toEqual([
      3, 4,
    ]);
  });

  it("이웃 쪽수 0 이면 칩만 남고, 소수·음수는 정리한다", () => {
    expect(neighborhoodStrips(strips, "c", 0)?.[2]?.presentation).toEqual({
      kind: "collapsed",
      side: "start",
      offset: 0,
      visible: 0,
      hidden: 7,
    });
    expect(neighborhoodStrips(strips, "c", 2.9)?.[2]?.presentation).toEqual(
      expect.objectContaining({ visible: 2, hidden: 5 }),
    );
    expect(neighborhoodStrips(strips, "c", -1)?.[0]?.presentation).toEqual(
      expect.objectContaining({ visible: 0, hidden: 2, offset: 2 }),
    );
  });

  it("선택 문서가 없으면 null, 문서가 하나면 그 띠만", () => {
    expect(neighborhoodStrips(strips, "zzz", 3)).toBeNull();
    expect(neighborhoodStrips([], "a", 3)).toBeNull();
    expect(neighborhoodStrips([strip("a", 9)], "a", 3)).toEqual([
      { index: 0, presentation: { kind: "windowed" } },
    ]);
  });
});

describe("hiddenCounts", () => {
  it("보이는 띠 앞·뒤의 수", () => {
    expect(hiddenCounts(31, [9, 10, 11])).toEqual({ before: 9, after: 19 });
    expect(hiddenCounts(31, [0, 1])).toEqual({ before: 0, after: 29 });
    expect(hiddenCounts(31, [29, 30])).toEqual({ before: 29, after: 0 });
    expect(hiddenCounts(1, [0])).toEqual({ before: 0, after: 0 });
  });

  it("보이는 띠가 없으면 전부 before, 범위 밖 index 는 자른다", () => {
    expect(hiddenCounts(5, [])).toEqual({ before: 5, after: 0 });
    expect(hiddenCounts(0, [])).toEqual({ before: 0, after: 0 });
    expect(hiddenCounts(5, [-3, 99])).toEqual({ before: 0, after: 0 });
  });
});

describe("pageWindow", () => {
  const pitch = THUMBNAIL_PITCH;

  it("보이는 칸 ± overscan, 스페이서는 가려진 칸 폭의 합", () => {
    // 10 칸째부터 창 폭 600(≈ 6.8 칸) → 보이는 10‥17, overscan 4 → 6‥21.
    const win = pageWindow({
      count: 60,
      viewportStart: 10 * pitch,
      viewportEnd: 10 * pitch + 600,
      pitch,
    });
    expect(win).toEqual({
      start: 6,
      end: 21,
      leadWidth: 6 * pitch,
      trailWidth: 39 * pitch,
    });
    expect(win.leadWidth + (win.end - win.start) * pitch + win.trailWidth).toBe(
      60 * pitch,
    );
  });

  it("시작·끝에서 클램프한다", () => {
    expect(
      pageWindow({ count: 60, viewportStart: 0, viewportEnd: 600, pitch }),
    ).toEqual({ start: 0, end: 11, leadWidth: 0, trailWidth: 49 * pitch });
    expect(
      pageWindow({
        count: 60,
        viewportStart: 59 * pitch,
        viewportEnd: 59 * pitch + 600,
        pitch,
      }),
    ).toEqual({ start: 55, end: 60, leadWidth: 55 * pitch, trailWidth: 0 });
  });

  it("띠가 창보다 오른쪽에서 시작하면(음수) 앞 칸만, 창이 띠 끝을 넘으면 끝 칸만", () => {
    expect(
      pageWindow({ count: 60, viewportStart: -2000, viewportEnd: -1400, pitch })
        .end,
    ).toBe(4);
    const past = pageWindow({
      count: 60,
      viewportStart: 100 * pitch,
      viewportEnd: 100 * pitch + 600,
      pitch,
    });
    expect(past).toEqual({
      start: 55,
      end: 60,
      leadWidth: 55 * pitch,
      trailWidth: 0,
    });
  });

  it("창을 아직 재지 못했으면(end ≤ start) 칸 8 개 폭으로 본다", () => {
    expect(
      pageWindow({ count: 60, viewportStart: 0, viewportEnd: 0, pitch }),
    ).toEqual({ start: 0, end: 12, leadWidth: 0, trailWidth: 48 * pitch });
    expect(
      pageWindow({ count: 60, viewportStart: 500, viewportEnd: 100, pitch })
        .end,
    ).toBe(Math.ceil((500 + 8 * pitch) / pitch) + 4);
  });

  it("count 0·pitch 0 은 빈 창, overscan 0·소수도 받는다", () => {
    const empty = { start: 0, end: 0, leadWidth: 0, trailWidth: 0 };
    expect(
      pageWindow({ count: 0, viewportStart: 0, viewportEnd: 600, pitch }),
    ).toEqual(empty);
    expect(
      pageWindow({ count: 5, viewportStart: 0, viewportEnd: 600, pitch: 0 }),
    ).toEqual(empty);
    expect(
      pageWindow({
        count: 60,
        viewportStart: 0,
        viewportEnd: 600,
        pitch,
        overscan: 0,
      }),
    ).toEqual({ start: 0, end: 7, leadWidth: 0, trailWidth: 53 * pitch });
    const win = pageWindow({
      count: 3,
      viewportStart: 0,
      viewportEnd: 600,
      pitch,
      overscan: 1.7,
    });
    expect(win.end).toBeGreaterThanOrEqual(win.start);
    expect(win).toEqual({ start: 0, end: 3, leadWidth: 0, trailWidth: 0 });
  });
});

describe("dropIndexFromX", () => {
  it("썸네일 가운데를 넘을 때마다 1 씩 늘고 0‥count 로 자른다", () => {
    const c = THUMBNAIL_CENTER;
    const p = THUMBNAIL_PITCH;
    expect(dropIndexFromX(-50, 10)).toBe(0);
    expect(dropIndexFromX(0, 10)).toBe(0);
    expect(dropIndexFromX(c - 1, 10)).toBe(0);
    expect(dropIndexFromX(c, 10)).toBe(1);
    expect(dropIndexFromX(c + p - 1, 10)).toBe(1);
    expect(dropIndexFromX(c + p, 10)).toBe(2);
    expect(dropIndexFromX(c + 9 * p, 10)).toBe(10);
    expect(dropIndexFromX(10_000, 10)).toBe(10);
  });

  it("count 0 이나 pitch 0 은 0, 다른 pitch·center 도 받는다", () => {
    expect(dropIndexFromX(500, 0)).toBe(0);
    expect(dropIndexFromX(500, 5, 0, 0)).toBe(0);
    expect(dropIndexFromX(150, 5, 100, 50)).toBe(2);
  });
});

describe("recenterViewport", () => {
  const pitch = THUMBNAIL_PITCH;
  // 창 폭 10 칸, 펼친 띠는 스크롤 내용 왼쪽에서 200 px.
  const viewport = { start: pitch * 10, end: pitch * 20 };
  const olLeft = 200;

  it("선택 칸 전체가 창 안이면 null(아무것도 하지 않는다)", () => {
    expect(recenterViewport({ position: 10, viewport, olLeft })).toBeNull();
    expect(recenterViewport({ position: 15, viewport, olLeft })).toBeNull();
    expect(recenterViewport({ position: 19, viewport, olLeft })).toBeNull();
  });

  it("칸이 창 끝에 걸치면 밖으로 본다(경계)", () => {
    const shifted = { start: viewport.start + 1, end: viewport.end + 1 };
    expect(
      recenterViewport({ position: 10, viewport: shifted, olLeft }),
    ).not.toBeNull();
    expect(
      recenterViewport({ position: 20, viewport: shifted, olLeft }),
    ).not.toBeNull();
    expect(
      recenterViewport({ position: 19, viewport: shifted, olLeft }),
    ).toBeNull();
  });

  it("창 뒤에 있으면 그 칸을 가운데로 옮기고 새 창을 함께 돌려준다", () => {
    const result = recenterViewport({ position: 40, viewport, olLeft });
    const width = viewport.end - viewport.start;
    const scrollLeft = olLeft + 40 * pitch - width / 2 + pitch / 2;
    expect(result).toEqual({
      scrollLeft,
      viewport: {
        start: scrollLeft - olLeft,
        end: scrollLeft - olLeft + width,
      },
    });
    // 새 창 가운데가 선택 칸 가운데다.
    const v = result!.viewport;
    expect((v.start + v.end) / 2).toBe(40 * pitch + pitch / 2);
  });

  it("창 앞에 있으면 앞으로 옮긴다", () => {
    const result = recenterViewport({ position: 6, viewport, olLeft });
    expect(result!.scrollLeft).toBe(olLeft + 6 * pitch - 5 * pitch + pitch / 2);
    expect(result!.viewport.start).toBeLessThan(6 * pitch);
  });

  it("scrollLeft 는 0 아래로 내려가지 않는다", () => {
    const result = recenterViewport({ position: 0, viewport, olLeft: 0 });
    expect(result).toEqual({
      scrollLeft: 0,
      viewport: { start: 0, end: pitch * 10 },
    });
  });

  it("pitch 를 받는다", () => {
    expect(
      recenterViewport({
        position: 2,
        pitch: 10,
        viewport: { start: 0, end: 30 },
        olLeft: 0,
      }),
    ).toBeNull();
    expect(
      recenterViewport({
        position: 3,
        pitch: 10,
        viewport: { start: 0, end: 30 },
        olLeft: 0,
      }),
    ).toEqual({ scrollLeft: 20, viewport: { start: 20, end: 50 } });
  });
});

describe("pageMenuItems", () => {
  it("접힌 띠는 다른 문서로·제외만", () => {
    expect(pageMenuItems("collapsed")).toEqual(["move", "exclude"]);
  });

  it("펼친 띠·전체 보기는 네 항목", () => {
    const all = ["left", "right", "move", "exclude"];
    expect(pageMenuItems("windowed")).toEqual(all);
    expect(pageMenuItems("full")).toEqual(all);
  });
});
