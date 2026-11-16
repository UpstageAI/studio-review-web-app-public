import {
  dropIndexAt,
  pageDropVerdict,
} from "@/components/studio-ui-kit/structure-editor/filmstrip/drag";

const strip = (
  documentId: string,
  pages: number,
  extra: { groupId?: string; locked?: boolean } = {},
) => ({
  documentId,
  groupId: extra.groupId ?? "g1",
  locked: extra.locked,
  pages: { length: pages },
});

const pageOf = (documentId: string | null, index: number, groupId = "g1") => ({
  documentId,
  groupId,
  index,
});

describe("pageDropVerdict — 접힌 이웃 띠", () => {
  it("앞 문서(side end)의 자기 페이지는 사유 없이 거부한다", () => {
    expect(
      pageDropVerdict({
        drag: pageOf("a", 3),
        strip: strip("a", 6),
        index: 0,
        side: "end",
      }),
    ).toEqual({ ok: false });
  });

  it("뒤 문서(side start)의 자기 페이지는 사유 없이 거부한다", () => {
    expect(
      pageDropVerdict({
        drag: pageOf("c", 1),
        strip: strip("c", 6),
        index: 5,
        side: "start",
      }),
    ).toEqual({ ok: false });
  });

  it("다른 문서 페이지는 앞 문서면 끝에 들어간다(포인터 위치 무시)", () => {
    expect(
      pageDropVerdict({
        drag: pageOf("b", 0),
        strip: strip("a", 6),
        index: 2,
        side: "end",
      }),
    ).toEqual({ ok: true, index: 6 });
  });

  it("다른 문서 페이지는 뒤 문서면 앞에 들어간다", () => {
    expect(
      pageDropVerdict({
        drag: pageOf("b", 4),
        strip: strip("c", 6),
        index: 3,
        side: "start",
      }),
    ).toEqual({ ok: true, index: 0 });
  });

  it("제외 띠 페이지는 접힌 띠에도 되돌릴 수 있다", () => {
    expect(
      pageDropVerdict({
        drag: pageOf(null, 0),
        strip: strip("a", 2),
        index: 0,
        side: "end",
      }),
    ).toEqual({ ok: true, index: 2 });
  });

  it("잠긴 접힌 띠는 locked 로 거부한다(같은 문서보다 먼저)", () => {
    expect(
      pageDropVerdict({
        drag: pageOf("a", 0),
        strip: strip("a", 3, { locked: true }),
        index: 0,
        side: "end",
      }),
    ).toEqual({ ok: false, reason: "locked" });
  });

  it("다른 그룹 접힌 띠는 group 으로 거부한다", () => {
    expect(
      pageDropVerdict({
        drag: pageOf("b", 0, "g2"),
        strip: strip("a", 3),
        index: 0,
        side: "start",
      }),
    ).toEqual({ ok: false, reason: "group" });
  });
});

describe("pageDropVerdict — 펼친 띠·전체 보기", () => {
  it("자기 자리(앞·뒤 틈)는 사유 없이 거부한다", () => {
    const drag = pageOf("a", 2);
    expect(pageDropVerdict({ drag, strip: strip("a", 5), index: 2 })).toEqual({
      ok: false,
    });
    expect(pageDropVerdict({ drag, strip: strip("a", 5), index: 3 })).toEqual({
      ok: false,
    });
  });

  it("같은 문서 다른 자리는 포인터 위치 그대로 받는다", () => {
    const drag = pageOf("a", 2);
    expect(pageDropVerdict({ drag, strip: strip("a", 5), index: 0 })).toEqual({
      ok: true,
      index: 0,
    });
    expect(pageDropVerdict({ drag, strip: strip("a", 5), index: 5 })).toEqual({
      ok: true,
      index: 5,
    });
  });

  it("띠 머리(끝 위치)에 놓으면 마지막 페이지만 제자리다", () => {
    expect(
      pageDropVerdict({
        drag: pageOf("a", 4),
        strip: strip("a", 5),
        index: 5,
      }),
    ).toEqual({ ok: false });
    expect(
      pageDropVerdict({
        drag: pageOf("a", 1),
        strip: strip("a", 5),
        index: 5,
      }),
    ).toEqual({ ok: true, index: 5 });
  });

  it("다른 문서로는 포인터 위치에 옮긴다", () => {
    expect(
      pageDropVerdict({
        drag: pageOf("b", 0),
        strip: strip("a", 5),
        index: 3,
      }),
    ).toEqual({ ok: true, index: 3 });
  });

  it("잠긴 문서는 locked, 다른 그룹은 group 으로 거부한다", () => {
    expect(
      pageDropVerdict({
        drag: pageOf("b", 0),
        strip: strip("a", 5, { locked: true, groupId: "g2" }),
        index: 1,
      }),
    ).toEqual({ ok: false, reason: "locked" });
    expect(
      pageDropVerdict({
        drag: pageOf(null, 0, "g2"),
        strip: strip("a", 5),
        index: 1,
      }),
    ).toEqual({ ok: false, reason: "group" });
  });
});

describe("dropIndexAt", () => {
  it("가운데가 포인터보다 왼쪽인 칸 수", () => {
    const item = (left: number) =>
      ({
        getBoundingClientRect: () => ({ left, width: 20 }),
      }) as unknown as Element;
    const items = [item(0), item(30), item(60)];
    expect(dropIndexAt(5, items)).toBe(0);
    expect(dropIndexAt(15, items)).toBe(1);
    expect(dropIndexAt(100, items)).toBe(3);
  });
});
