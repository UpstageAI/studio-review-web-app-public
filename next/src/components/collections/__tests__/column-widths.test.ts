import { describe, expect, it } from "vitest";

import { DEFAULT_HIDDEN, HIDEABLE_COLUMNS } from "../column-visibility";
import {
  COLUMN_WIDTH_REM,
  MENU_COLUMN_REM,
  NAME_MIN_REM,
  tableMinWidthRem,
} from "../column-widths";

describe("tableMinWidthRem", () => {
  it("숨길 수 있는 열이 모두 숨겨지면 이름 최소 폭과 메뉴 열 폭만 남는다", () => {
    expect(tableMinWidthRem([])).toBe(NAME_MIN_REM + MENU_COLUMN_REM);
  });

  it("보이는 열의 폭을 더한다", () => {
    expect(tableMinWidthRem(["source", "jobs"])).toBe(
      NAME_MIN_REM +
        MENU_COLUMN_REM +
        COLUMN_WIDTH_REM.source +
        COLUMN_WIDTH_REM.jobs,
    );
  });

  it("기본 숨김 상태와 모든 열이 보이는 상태의 차이는 숨긴 열 폭의 합이다", () => {
    const all = tableMinWidthRem(HIDEABLE_COLUMNS);
    const defaults = tableMinWidthRem(
      HIDEABLE_COLUMNS.filter(column => !DEFAULT_HIDDEN.includes(column)),
    );
    const hiddenSum = DEFAULT_HIDDEN.reduce(
      (sum, column) => sum + COLUMN_WIDTH_REM[column],
      0,
    );
    expect(all - defaults).toBe(hiddenSum);
  });

  it("열 순서와 무관하고 같은 열을 두 번 세지 않는다", () => {
    expect(tableMinWidthRem(["review", "source", "review"])).toBe(
      tableMinWidthRem(["source", "review"]),
    );
  });

  it("모르는 열 이름(이름 열·메뉴 열 포함)은 무시한다", () => {
    expect(tableMinWidthRem(["name", "menu", "unknown", "jobs"])).toBe(
      tableMinWidthRem(["jobs"]),
    );
  });

  it("모든 숨길 수 있는 열에 폭이 있다", () => {
    for (const column of HIDEABLE_COLUMNS) {
      expect(COLUMN_WIDTH_REM[column]).toBeGreaterThan(0);
    }
  });
});
