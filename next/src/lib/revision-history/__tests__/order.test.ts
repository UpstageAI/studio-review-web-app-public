import { describe, expect, it } from "vitest";

import { compareRevisions, mergeRevisionPages } from "../order";
import { revision } from "./helpers";

const row = (id: string, published_at: number, version = 1) =>
  revision({ id, published_at, version });

describe("compareRevisions", () => {
  it("published_at → version → id 내림차순", () => {
    const rows = [
      row("a", 10, 1),
      row("b", 20, 1),
      row("c", 20, 2),
      row("d", 20, 2),
    ];
    expect([...rows].sort(compareRevisions).map(r => r.id)).toEqual([
      "d",
      "c",
      "b",
      "a",
    ]);
    expect(compareRevisions(rows[0]!, rows[0]!)).toBe(0);
  });
});

describe("mergeRevisionPages", () => {
  it("이미 있는 id 는 건너뛰고 받은 순서를 지킨다", () => {
    const merged = mergeRevisionPages(
      [row("a", 3), row("b", 2)],
      [row("b", 2), row("c", 1), row("c", 1)],
    );
    expect(merged.map(r => r.id)).toEqual(["a", "b", "c"]);
  });
});
