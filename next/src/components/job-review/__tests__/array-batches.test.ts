import { describe, expect, it } from "vitest";

import { ARRAY_BATCH as LARGE_JOB_ARRAY_BATCH } from "../large-job";
import {
  ARRAY_BATCH,
  autoOpenKey,
  batchLimitFor,
  firstItemUnder,
  itemIndexUnder,
  shouldAutoOpen,
} from "../array-batches";

describe("ARRAY_BATCH", () => {
  it("large-job 의 상수를 재수출한다", () => {
    expect(ARRAY_BATCH).toBe(LARGE_JOB_ARRAY_BATCH);
    expect(ARRAY_BATCH).toBe(50);
  });
});

describe("itemIndexUnder", () => {
  it("배열 아래 pointer 의 항목 index", () => {
    expect(itemIndexUnder("/items", "/items/120/name")).toBe(120);
    expect(itemIndexUnder("/items", "/items/0")).toBe(0);
    expect(itemIndexUnder("/0/items", "/0/items/7/qty")).toBe(7);
  });

  it("다른 배열·배열 자체·없음은 null", () => {
    expect(itemIndexUnder("/items", "/items2/1")).toBeNull();
    expect(itemIndexUnder("/items", "/items")).toBeNull();
    expect(itemIndexUnder("/items", "/other/1")).toBeNull();
    expect(itemIndexUnder("/items", null)).toBeNull();
    expect(itemIndexUnder("/items", "/items/x/qty")).toBeNull();
    expect(itemIndexUnder("/items", "/items/01")).toBeNull();
  });

  it("루트 배열은 빈 pointer", () => {
    expect(itemIndexUnder("", "/3")).toBe(3);
    expect(itemIndexUnder("", "/3/name")).toBe(3);
    expect(itemIndexUnder("", "")).toBeNull();
  });
});

describe("batchLimitFor", () => {
  it("보이는 위치면 그대로, 아니면 묶음 단위로 늘린다", () => {
    expect(batchLimitFor(50, null, 50)).toBe(50);
    expect(batchLimitFor(50, 49, 50)).toBe(50);
    expect(batchLimitFor(50, 50, 50)).toBe(100);
    expect(batchLimitFor(50, 99, 50)).toBe(100);
    expect(batchLimitFor(50, 100, 50)).toBe(150);
    expect(batchLimitFor(70, 70, 50)).toBe(120);
  });

  it("묶음이 0 이하면 1 로 본다", () => {
    expect(batchLimitFor(3, 5, 0)).toBe(6);
  });
});

describe("autoOpenKey", () => {
  it("선택·오류가 둘 다 배열 밖이면 null", () => {
    expect(autoOpenKey("/items", null, [])).toBeNull();
    expect(autoOpenKey("/items", "/invoice_no", ["/other/1/qty"])).toBeNull();
    expect(autoOpenKey("/items", "/items", [])).toBeNull();
  });

  it("오류만·선택만·둘 다는 서로 다른 key", () => {
    const errorOnly = autoOpenKey("/items", null, ["/items/2/qty"]);
    const selectedOnly = autoOpenKey("/items", "/items/2/qty", []);
    const both = autoOpenKey("/items", "/items/2/qty", ["/items/2/qty"]);
    expect(errorOnly).not.toBeNull();
    expect(selectedOnly).not.toBeNull();
    expect(both).not.toBeNull();
    expect(new Set([errorOnly, selectedOnly, both]).size).toBe(3);
  });

  it("배열 밖 pointer 는 key 에 들어가지 않는다", () => {
    expect(autoOpenKey("/items", "/invoice_no", ["/items/2/qty"])).toBe(
      autoOpenKey("/items", null, ["/items/2/qty"]),
    );
  });

  it("같은 입력은 같은 key", () => {
    expect(autoOpenKey("/items", "/items/1/name", ["/items/2/qty"])).toBe(
      autoOpenKey("/items", "/items/1/name", ["/items/2/qty"]),
    );
  });

  it("같은 항목의 다른 필드는 다른 key", () => {
    expect(autoOpenKey("/items", null, ["/items/2/qty"])).not.toBe(
      autoOpenKey("/items", null, ["/items/2/price"]),
    );
    expect(autoOpenKey("/items", "/items/2/qty", [])).not.toBe(
      autoOpenKey("/items", "/items/2/price", []),
    );
  });

  it("오류가 여럿이면 첫 오류 항목만 key 에 들어간다", () => {
    expect(autoOpenKey("/items", null, ["/items/9/qty", "/items/2/qty"])).toBe(
      autoOpenKey("/items", null, ["/items/2/qty"]),
    );
    expect(autoOpenKey("/items", null, ["/items/2/qty", "/items/40/qty"])).toBe(
      autoOpenKey("/items", null, ["/items/2/qty", "/items/41/qty"]),
    );
  });

  it("루트 배열은 빈 pointer", () => {
    expect(autoOpenKey("", "/3/name", [])).not.toBeNull();
    expect(autoOpenKey("", null, ["/0"])).not.toBeNull();
    expect(autoOpenKey("", "", [])).toBeNull();
  });
});

describe("firstItemUnder", () => {
  it("배열 항목을 가리키는 pointer 중 index 가 가장 작은 것", () => {
    expect(
      firstItemUnder("/items", [
        "/items/7/qty",
        "/items/2/name",
        "/items/2/qty",
      ]),
    ).toEqual({ index: 2, pointer: "/items/2/name" });
  });

  it("배열 밖 pointer·배열 자신은 무시", () => {
    expect(
      firstItemUnder("/items", ["/invoice_no", "/items", "/other/0"]),
    ).toBeNull();
    expect(firstItemUnder("/items", [])).toBeNull();
  });

  it("루트 배열은 빈 pointer 를 접두로", () => {
    expect(firstItemUnder("", ["/3/name", "/1"])).toEqual({
      index: 1,
      pointer: "/1",
    });
  });
});

describe("shouldAutoOpen", () => {
  const errorKey = autoOpenKey("/items", null, ["/items/2/qty"]);
  const selectKey = autoOpenKey("/items", "/items/3/name", ["/items/2/qty"]);
  const otherSelectKey = autoOpenKey("/items", "/items/4/name", [
    "/items/2/qty",
  ]);

  it("오류 항목 배열을 접으면 접힌 채 — 같은 이유로는 다시 펼치지 않는다", () => {
    expect(shouldAutoOpen(null, errorKey)).toBe(true);
    // 사용자가 접은 뒤 재렌더(같은 key)
    expect(shouldAutoOpen(errorKey, errorKey)).toBe(false);
  });

  it("새 오류가 같은 항목의 다른 필드를 가리키면 다시 펼친다", () => {
    const nextError = autoOpenKey("/items", null, ["/items/2/price"]);
    expect(shouldAutoOpen(errorKey, nextError)).toBe(true);
  });

  it("선택이 그 배열 안 다른 항목으로 바뀌면 다시 펼친다", () => {
    expect(shouldAutoOpen(errorKey, selectKey)).toBe(true);
    expect(shouldAutoOpen(selectKey, otherSelectKey)).toBe(true);
  });

  it("선택이 나가고 오류만 남으면 다시 펼친다(새 이유)", () => {
    expect(shouldAutoOpen(otherSelectKey, errorKey)).toBe(true);
  });

  it("필요 없어진 뒤 다시 필요해지면 펼친다", () => {
    expect(shouldAutoOpen(errorKey, null)).toBe(false);
    expect(shouldAutoOpen(null, errorKey)).toBe(true);
  });

  it("필요 없으면 펼치지 않는다", () => {
    expect(shouldAutoOpen(null, null)).toBe(false);
  });
});
