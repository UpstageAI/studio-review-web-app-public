import { describe, expect, it } from "vitest";

import { groupByOperation } from "../group";
import { revision } from "./helpers";

const row = (id: string, op: string, published_at = 1) =>
  revision({ id, published_at, operation: { id: op } });

describe("groupByOperation", () => {
  it("연속한 같은 작업만 묶는다", () => {
    const groups = groupByOperation([
      row("r5", "op_b", 50),
      row("r4", "op_b", 50),
      row("r3", "op_a", 40),
      row("r2", "op_b", 30),
    ]);
    expect(groups.map(group => [group.key, group.rows.map(r => r.id)])).toEqual(
      [
        ["op_b:r5", ["r5", "r4"]],
        ["op_a:r3", ["r3"]],
        ["op_b:r2", ["r2"]],
      ],
    );
    expect(groups[0]!.publishedAt).toBe(50);
    expect(groups[0]!.operation).toEqual({ id: "op_b" });
  });

  it("빈 목록은 빈 묶음", () => {
    expect(groupByOperation([])).toEqual([]);
  });
});
