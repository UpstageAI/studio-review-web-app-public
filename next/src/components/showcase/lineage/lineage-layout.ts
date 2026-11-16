// Collection 관계 그림의 배치(순수). 왼쪽이 원본, 오른쪽이 결과인 층 구조로 놓는다.
//
// 이어진 Collection 끼리 한 묶음이고 묶음은 위아래로 쌓는다. 묶음 안에서는 가장 긴 경로로 열을
// 정해 원본이 항상 왼쪽에 오고, 카드는 부모 높이에 맞춰 놓되 겹치면 아래로 민다. 두 열 이상 건너뛰는
// 연결은 사이 열에 빈 자리를 잡아 다른 카드 뒤로 지나가지 않게 한다. 순환이 있으면 한 연결을
// 뒤집어 배치하고 화살표 방향만 되돌린다.

import type {
  CollectionLineageEdge,
  CollectionLineageNode,
} from "@/lib/review-api/types";

export interface LineageMetrics {
  nodeWidth: number;
  nodeHeight: number;
  /** 열 사이 간격. 연결 이름이 여기에 들어간다 */
  columnGap: number;
  rowGap: number;
  /** 묶음 사이 간격 */
  groupGap: number;
  padding: number;
  /** 카드를 건너뛰는 연결이 사이 열에서 차지하는 높이 */
  laneHeight: number;
  labelHeight: number;
}

export const LINEAGE_METRICS: LineageMetrics = {
  nodeWidth: 240,
  nodeHeight: 112,
  columnGap: 104,
  rowGap: 20,
  groupGap: 40,
  padding: 24,
  laneHeight: 8,
  labelHeight: 18,
};

export interface PlacedNode {
  id: string;
  x: number;
  y: number;
}

export interface PlacedEdge {
  from: string;
  to: string;
  /** SVG `d` */
  path: string;
}

/** 연결 이름. 같은 도착점에 같은 종류로 들어오는 연결은 이름 하나로 합친다. */
export interface PlacedLabel {
  to: string;
  kind: CollectionLineageEdge["kind"];
  workflows: string[];
  x: number;
  y: number;
  width: number;
}

export interface LineageLayout {
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  labels: PlacedLabel[];
  width: number;
  height: number;
}

type LinkPair = Pick<CollectionLineageEdge, "from" | "to">;

/** 배치 방향의 연결. `reversed` 면 그릴 때 원래 방향으로 되돌린다. */
interface Link extends LinkPair {
  reversed: boolean;
}

interface Slot {
  id: string;
  height: number;
  parents: string[];
  center: number;
}

const pairKey = (from: string, to: string) => JSON.stringify([from, to]);

function uniqueLinks(edges: readonly LinkPair[]): LinkPair[] {
  const seen = new Map<string, LinkPair>();
  for (const { from, to } of edges) seen.set(pairKey(from, to), { from, to });
  return [...seen.values()];
}

/** 연결로 이어진 묶음. 묶음 순서와 묶음 안 순서는 `ids` 순서를 따른다. */
function connectedGroups(
  ids: readonly string[],
  links: readonly LinkPair[],
): string[][] {
  const neighbors = new Map<string, string[]>(ids.map(id => [id, []]));
  for (const { from, to } of links) {
    neighbors.get(from)?.push(to);
    neighbors.get(to)?.push(from);
  }
  const groupOf = new Map<string, number>();
  ids.forEach((id, group) => {
    if (groupOf.has(id)) return;
    const stack = [id];
    while (stack.length > 0) {
      const current = stack.pop() as string;
      if (groupOf.has(current)) continue;
      groupOf.set(current, group);
      stack.push(...(neighbors.get(current) ?? []));
    }
  });
  const groups = new Map<number, string[]>();
  for (const id of ids) {
    const group = groupOf.get(id) as number;
    groups.set(group, [...(groups.get(group) ?? []), id]);
  }
  return [...groups.values()];
}

/** 깊이 우선으로 돌며 방문 중인 곳으로 돌아가는 연결을 뒤집어 순환을 끊는다. 원본 없는 곳부터 돈다. */
function orientLinks(
  ids: readonly string[],
  links: readonly LinkPair[],
): Link[] {
  const outgoing = new Map<string, LinkPair[]>(ids.map(id => [id, []]));
  const targets = new Set(links.map(link => link.to));
  for (const link of links) outgoing.get(link.from)?.push(link);

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const backward = new Set<string>();
  const visit = (id: string) => {
    visiting.add(id);
    for (const link of outgoing.get(id) ?? []) {
      if (visiting.has(link.to)) backward.add(pairKey(link.from, link.to));
      else if (!visited.has(link.to)) visit(link.to);
    }
    visiting.delete(id);
    visited.add(id);
  };
  const roots = ids.filter(id => !targets.has(id));
  for (const id of [...roots, ...ids]) {
    if (!visited.has(id)) visit(id);
  }

  return links.map(link =>
    backward.has(pairKey(link.from, link.to))
      ? { from: link.to, to: link.from, reversed: true }
      : { ...link, reversed: false },
  );
}

/** 가장 긴 경로로 열을 정한다. 연결은 항상 오른쪽으로 간다. */
function assignColumns(
  ids: readonly string[],
  links: readonly Link[],
): Map<string, number> {
  const column = new Map(ids.map(id => [id, 0]));
  const incoming = new Map(ids.map(id => [id, 0]));
  for (const { to } of links) incoming.set(to, (incoming.get(to) ?? 0) + 1);
  const queue = ids.filter(id => incoming.get(id) === 0);
  for (let at = 0; at < queue.length; at += 1) {
    const id = queue[at];
    for (const link of links) {
      if (link.from !== id) continue;
      column.set(
        link.to,
        Math.max(column.get(link.to) ?? 0, (column.get(id) ?? 0) + 1),
      );
      const left = (incoming.get(link.to) ?? 0) - 1;
      incoming.set(link.to, left);
      if (left === 0) queue.push(link.to);
    }
  }
  return column;
}

const laneId = (link: Link, column: number) =>
  JSON.stringify([link.from, link.to, column]);

/** 한 묶음을 그 안의 좌표(세로 중심)로 놓는다. 위쪽이 0 이다. */
function placeGroup(
  ids: readonly string[],
  links: readonly Link[],
  metrics: LineageMetrics,
) {
  const columnOf = assignColumns(ids, links);
  const slots = new Map<string, Slot>(
    ids.map(id => [
      id,
      { id, height: metrics.nodeHeight, parents: [], center: 0 },
    ]),
  );
  const columns: Slot[][] = [];
  const addToColumn = (slot: Slot, column: number) => {
    (columns[column] ??= []).push(slot);
  };
  for (const id of ids) {
    addToColumn(slots.get(id) as Slot, columnOf.get(id) ?? 0);
  }

  // 사이 열마다 빈 자리를 하나씩 넣어, 한 열씩만 건너는 연결로 바꾼다.
  for (const link of links) {
    const start = columnOf.get(link.from) ?? 0;
    const end = columnOf.get(link.to) ?? 0;
    let previous = link.from;
    for (let column = start + 1; column < end; column += 1) {
      const id = laneId(link, column);
      const lane: Slot = {
        id,
        height: metrics.laneHeight,
        parents: [previous],
        center: 0,
      };
      slots.set(id, lane);
      addToColumn(lane, column);
      previous = id;
    }
    slots.get(link.to)?.parents.push(previous);
  }

  const centerOf = (id: string) => slots.get(id)?.center ?? 0;
  const desired = (slot: Slot) =>
    slot.parents.length === 0
      ? 0
      : slot.parents.reduce((sum, parent) => sum + centerOf(parent), 0) /
        slot.parents.length;
  for (const column of columns) {
    // 빈 열은 없다: 연결은 오른쪽으로 이어지므로 사이 열은 빈 자리나 카드로 채워진다.
    const ordered = column
      .map(slot => ({ slot, wanted: desired(slot) }))
      .sort((a, b) => a.wanted - b.wanted);
    let bottom = 0;
    for (const { slot, wanted } of ordered) {
      slot.center = Math.max(wanted, bottom + slot.height / 2);
      bottom = slot.center + slot.height / 2 + metrics.rowGap;
    }
  }

  const height = Math.max(
    ...[...slots.values()].map(slot => slot.center + slot.height / 2),
  );
  return { columnOf, centerOf, height, columnCount: columns.length };
}

function pathThrough(points: readonly (readonly [number, number])[]): string {
  const [first, ...rest] = points;
  let path = `M ${first[0]} ${first[1]}`;
  let [x, y] = first;
  for (const [nextX, nextY] of rest) {
    if (y === nextY) {
      path += ` L ${nextX} ${nextY}`;
    } else {
      const middle = (x + nextX) / 2;
      path += ` C ${middle} ${y}, ${middle} ${nextY}, ${nextX} ${nextY}`;
    }
    x = nextX;
    y = nextY;
  }
  return path;
}

/** Collection 들과 연결을 받아 좌표를 낸다. 묶음 순서는 `nodes` 순서를 따른다. */
export function layoutLineage(
  nodes: readonly Pick<CollectionLineageNode, "id">[],
  edges: readonly CollectionLineageEdge[],
  metrics: LineageMetrics = LINEAGE_METRICS,
): LineageLayout {
  const ids = nodes.map(node => node.id);
  const known = new Set(ids);
  const shown = edges.filter(
    edge => edge.from !== edge.to && known.has(edge.from) && known.has(edge.to),
  );
  const links = uniqueLinks(shown);
  const columnX = (column: number) =>
    metrics.padding + column * (metrics.nodeWidth + metrics.columnGap);

  const placedNodes: PlacedNode[] = [];
  const placedEdges: PlacedEdge[] = [];
  const labels = new Map<string, PlacedLabel>();
  const labelCounts = new Map<string, number>();
  let top = metrics.padding;
  let width = 0;

  for (const group of connectedGroups(ids, links)) {
    const inGroup = new Set(group);
    const oriented = orientLinks(
      group,
      links.filter(link => inGroup.has(link.from)),
    );
    const { columnOf, centerOf, height, columnCount } = placeGroup(
      group,
      oriented,
      metrics,
    );
    const yOf = (center: number) => top + center;

    for (const id of group) {
      placedNodes.push({
        id,
        x: columnX(columnOf.get(id) ?? 0),
        y: yOf(centerOf(id)) - metrics.nodeHeight / 2,
      });
    }

    for (const link of oriented) {
      const start = columnOf.get(link.from) ?? 0;
      const end = columnOf.get(link.to) ?? 0;
      const points: [number, number][] = [
        [columnX(start) + metrics.nodeWidth, yOf(centerOf(link.from))],
      ];
      for (let column = start + 1; column < end; column += 1) {
        const y = yOf(centerOf(laneId(link, column)));
        points.push(
          [columnX(column), y],
          [columnX(column) + metrics.nodeWidth, y],
        );
      }
      points.push([columnX(end), yOf(centerOf(link.to))]);
      if (link.reversed) points.reverse();
      placedEdges.push({
        from: link.reversed ? link.to : link.from,
        to: link.reversed ? link.from : link.to,
        path: pathThrough(points),
      });
    }

    // 이름은 도착 카드로 들어가는 선 바로 위에 둔다. 뒤집힌 연결은 카드 오른쪽으로 들어온다.
    const reversedTargets = new Set(
      oriented.filter(link => link.reversed).map(link => link.from),
    );
    for (const edge of shown) {
      if (!inGroup.has(edge.to)) continue;
      const key = JSON.stringify([edge.to, edge.kind]);
      const existing = labels.get(key);
      if (existing) {
        if (edge.workflow && !existing.workflows.includes(edge.workflow)) {
          existing.workflows.push(edge.workflow);
        }
        continue;
      }
      const stacked = labelCounts.get(edge.to) ?? 0;
      labelCounts.set(edge.to, stacked + 1);
      const nodeX = columnX(columnOf.get(edge.to) ?? 0);
      labels.set(key, {
        to: edge.to,
        kind: edge.kind,
        workflows: edge.workflow ? [edge.workflow] : [],
        x: reversedTargets.has(edge.to)
          ? nodeX + metrics.nodeWidth + 12
          : nodeX - metrics.columnGap + 4,
        y: yOf(centerOf(edge.to)) - metrics.labelHeight * (stacked + 1) - 4,
        width: metrics.columnGap - 8,
      });
    }

    width = Math.max(width, columnX(columnCount - 1) + metrics.nodeWidth);
    top += height + metrics.groupGap;
  }

  return {
    nodes: placedNodes,
    edges: placedEdges,
    labels: [...labels.values()],
    width: width + metrics.padding,
    height: top - metrics.groupGap + metrics.padding,
  };
}

/** 이 Collection 의 원본 쪽과 결과 쪽을 모두 따라간 Collection 들(자기 포함). 형제는 넣지 않는다. */
export function relatedCollections(
  id: string,
  edges: readonly LinkPair[],
): Set<string> {
  const walk = (next: (edge: LinkPair) => [string, string]) => {
    const seen = new Set([id]);
    const stack = [id];
    while (stack.length > 0) {
      const current = stack.pop();
      for (const edge of edges) {
        const [start, end] = next(edge);
        if (start === current && !seen.has(end)) {
          seen.add(end);
          stack.push(end);
        }
      }
    }
    return seen;
  };
  return new Set([
    ...walk(edge => [edge.from, edge.to]),
    ...walk(edge => [edge.to, edge.from]),
  ]);
}
