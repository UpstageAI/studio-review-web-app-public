import { describe, expect, it } from "vitest";

import {
  isGutterOnlyOverflow,
  syncHorizontalOverflow,
} from "../viewer-horizontal-overflow";

describe("isGutterOnlyOverflow", () => {
  it("넘침이 세로 스크롤바 폭과 같으면 숨긴다", () => {
    expect(
      isGutterOnlyOverflow({
        scrollWidth: 625,
        clientWidth: 610,
        offsetWidth: 625,
      }),
    ).toBe(true);
  });

  it("넘침이 없으면 숨겨도 된다", () => {
    expect(
      isGutterOnlyOverflow({
        scrollWidth: 610,
        clientWidth: 610,
        offsetWidth: 625,
      }),
    ).toBe(true);
  });

  it("확대해 스크롤바 폭보다 넓어지면 숨기지 않는다", () => {
    expect(
      isGutterOnlyOverflow({
        scrollWidth: 900,
        clientWidth: 610,
        offsetWidth: 625,
      }),
    ).toBe(false);
  });

  it("스크롤바가 자리를 차지하지 않으면 반올림 1 px 만 허용한다", () => {
    const base = { clientWidth: 625, offsetWidth: 625 };
    expect(isGutterOnlyOverflow({ ...base, scrollWidth: 626 })).toBe(true);
    expect(isGutterOnlyOverflow({ ...base, scrollWidth: 640 })).toBe(false);
  });
});

describe("syncHorizontalOverflow", () => {
  it("상태가 바뀔 때만 overflow-x 를 쓴다", () => {
    const el = {
      scrollWidth: 625,
      clientWidth: 610,
      offsetWidth: 625,
      style: { overflowX: "" },
    };
    expect(syncHorizontalOverflow(el)).toBe(true);
    expect(el.style.overflowX).toBe("hidden");
    expect(syncHorizontalOverflow(el)).toBe(false);

    el.scrollWidth = 900;
    expect(syncHorizontalOverflow(el)).toBe(true);
    expect(el.style.overflowX).toBe("");
  });
});
