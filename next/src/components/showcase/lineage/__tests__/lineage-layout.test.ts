import { describe, expect, it } from "vitest";

import type { CollectionLineageEdge } from "@/lib/review-api/types";

import {
  LINEAGE_METRICS,
  layoutLineage,
  relatedCollections,
  type LineageLayout,
} from "../lineage-layout";

const { nodeWidth, nodeHeight } = LINEAGE_METRICS;

const nodes = (...ids: string[]) => ids.map(id => ({ id }));

const edge = (
  from: string,
  to: string,
  overrides: Partial<CollectionLineageEdge> = {},
): CollectionLineageEdge => ({
  from,
  to,
  kind: "import",
  workflow: null,
  ...overrides,
});

function at(layout: LineageLayout, id: string) {
  const node = layout.nodes.find(item => item.id === id);
  if (!node) throw new Error(`no node ${id}`);
  return node;
}

function overlaps(layout: LineageLayout): boolean {
  return layout.nodes.some((a, index) =>
    layout.nodes
      .slice(index + 1)
      .some(
        b =>
          Math.abs(a.x - b.x) < nodeWidth && Math.abs(a.y - b.y) < nodeHeight,
      ),
  );
}

describe("layoutLineage", () => {
  it("이어진 Collection 은 왼쪽에서 오른쪽으로 한 줄에 놓는다", () => {
    const layout = layoutLineage(nodes("c", "b", "a"), [
      edge("a", "b"),
      edge("b", "c"),
    ]);
    expect(at(layout, "a").x).toBeLessThan(at(layout, "b").x);
    expect(at(layout, "b").x).toBeLessThan(at(layout, "c").x);
    expect(at(layout, "a").y).toBe(at(layout, "b").y);
    expect(at(layout, "b").y).toBe(at(layout, "c").y);
  });

  it("한 원본에서 갈라진 Collection 은 겹치지 않는다", () => {
    const layout = layoutLineage(nodes("a", "b", "c", "d"), [
      edge("a", "b"),
      edge("a", "c"),
      edge("a", "d"),
    ]);
    expect(overlaps(layout)).toBe(false);
    expect(at(layout, "b").x).toBe(at(layout, "c").x);
    expect(layout.height).toBeGreaterThanOrEqual(
      at(layout, "d").y + nodeHeight,
    );
  });

  it("합쳐지는 Collection 은 원본들 다음 열에 놓는다", () => {
    const layout = layoutLineage(nodes("a", "b", "c"), [
      edge("a", "c"),
      edge("b", "c"),
    ]);
    expect(at(layout, "a").x).toBe(at(layout, "b").x);
    expect(at(layout, "c").x).toBeGreaterThan(at(layout, "a").x);
    expect(overlaps(layout)).toBe(false);
  });

  it("열을 건너뛰는 연결은 사이 카드를 피해 지나간다", () => {
    const layout = layoutLineage(nodes("a", "b", "c"), [
      edge("a", "b"),
      edge("b", "c"),
      edge("a", "c"),
    ]);
    const skip = layout.edges.find(
      item => item.from === "a" && item.to === "c",
    );
    const middle = at(layout, "b");
    const lane = /L [\d.]+ ([\d.]+)/.exec(skip?.path ?? "");
    expect(lane).not.toBeNull();
    const y = Number(lane?.[1]);
    expect(y < middle.y || y > middle.y + nodeHeight).toBe(true);
  });

  it("이어지지 않은 묶음은 위아래로 쌓고 nodes 순서를 따른다", () => {
    const layout = layoutLineage(nodes("x", "y", "a", "b"), [
      edge("a", "b"),
      edge("x", "y"),
    ]);
    expect(overlaps(layout)).toBe(false);
    expect(at(layout, "x").y).toBeLessThan(at(layout, "a").y);
    expect(at(layout, "a").x).toBe(at(layout, "x").x);
  });

  it("순환이 있어도 끝나고 화살표 방향은 그대로다", () => {
    const layout = layoutLineage(nodes("a", "b"), [
      edge("a", "b"),
      edge("b", "a"),
    ]);
    expect(layout.nodes).toHaveLength(2);
    expect(at(layout, "a").x).not.toBe(at(layout, "b").x);
    expect(layout.edges.map(item => [item.from, item.to])).toEqual(
      expect.arrayContaining([
        ["a", "b"],
        ["b", "a"],
      ]),
    );
    const start = (from: string) =>
      /^M ([\d.]+)/.exec(
        layout.edges.find(item => item.from === from)?.path ?? "",
      )?.[1];
    expect(start("a")).not.toBe(start("b"));
  });

  it("자기 자신을 잇는 연결과 모르는 Collection 연결은 그리지 않는다", () => {
    const layout = layoutLineage(nodes("a", "b"), [
      edge("a", "a"),
      edge("a", "b"),
      edge("gone", "b"),
    ]);
    expect(layout.edges).toHaveLength(1);
    expect(layout.labels).toHaveLength(1);
  });

  it("같은 도착점의 같은 종류 연결은 이름 하나로 합친다", () => {
    const layout = layoutLineage(nodes("a", "b", "c"), [
      edge("a", "c", { workflow: "W1" }),
      edge("b", "c", { workflow: "W1" }),
      edge("b", "c", { workflow: "W2" }),
      edge("b", "c", { kind: "result_import" }),
    ]);
    expect(layout.labels).toHaveLength(2);
    expect(layout.labels[0]).toMatchObject({
      to: "c",
      kind: "import",
      workflows: ["W1", "W2"],
    });
    // 같은 도착점의 이름은 겹치지 않게 쌓는다.
    expect(layout.labels[0].y).not.toBe(layout.labels[1].y);
    expect(layout.edges).toHaveLength(2);
  });

  it("연결이 없으면 카드도 없다", () => {
    const layout = layoutLineage([], []);
    expect(layout.nodes).toEqual([]);
    expect(layout.edges).toEqual([]);
  });
});

describe("relatedCollections", () => {
  const edges = [
    edge("a", "b"),
    edge("b", "c"),
    edge("b", "d"),
    edge("x", "y"),
  ];

  it("원본 쪽과 결과 쪽을 끝까지 따라간다", () => {
    expect(relatedCollections("b", edges)).toEqual(
      new Set(["a", "b", "c", "d"]),
    );
  });

  it("같은 원본에서 갈라진 형제는 넣지 않는다", () => {
    expect(relatedCollections("c", edges)).toEqual(new Set(["a", "b", "c"]));
  });

  it("순환이 있어도 끝난다", () => {
    expect(relatedCollections("a", [edge("a", "b"), edge("b", "a")])).toEqual(
      new Set(["a", "b"]),
    );
  });
});
