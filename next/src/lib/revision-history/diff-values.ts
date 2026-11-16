import {
  isJsonObject,
  jsonEquals,
  type JsonPath,
  type JsonValue,
} from "@/lib/review-model";

/**
 * 값 비교 한 행. `path` 는 표시 경로(after 쪽, `removed` 만 before 쪽)이고 `beforePath`·
 * `afterPath` 는 각 값 안의 실제 경로(없는 쪽은 `null`).
 */
export type ValueChange = {
  readonly kind: "changed" | "added" | "removed";
  readonly path: JsonPath;
  readonly beforePath: JsonPath | null;
  readonly afterPath: JsonPath | null;
  readonly before?: JsonValue;
  readonly after?: JsonValue;
};

export type ValueDiff = {
  readonly changes: readonly ValueChange[];
  /** 같은 항목끼리 짝지었는데 순서가 바뀐 배열(after 경로). */
  readonly reorderedArrays: readonly JsonPath[];
};

/** 이보다 큰 배열 쌍(`a.length × b.length`)은 같은 항목 짝 찾기 없이 위치별로만 비교한다. */
export const ARRAY_MATCH_LIMIT = 10_000;

type Kind = "array" | "object" | "scalar";

function kindOf(value: JsonValue): Kind {
  if (Array.isArray(value)) return "array";
  return isJsonObject(value) ? "object" : "scalar";
}

/** 하위 트리의 leaf. 빈 `{}`·`[]` 도 leaf 하나로 센다. */
function leaves(
  value: JsonValue,
  path: JsonPath,
  out: { path: JsonPath; value: JsonValue }[],
): void {
  if (Array.isArray(value) && value.length > 0) {
    value.forEach((item, index) => leaves(item, [...path, String(index)], out));
    return;
  }
  if (isJsonObject(value) && Object.keys(value).length > 0) {
    for (const key of Object.keys(value)) {
      leaves(value[key] ?? null, [...path, key], out);
    }
    return;
  }
  out.push({ path, value });
}

class Collector {
  readonly changes: ValueChange[] = [];
  readonly reorderedArrays: JsonPath[] = [];

  removed(value: JsonValue, path: JsonPath): void {
    const out: { path: JsonPath; value: JsonValue }[] = [];
    leaves(value, path, out);
    for (const leaf of out) {
      this.changes.push({
        kind: "removed",
        path: leaf.path,
        beforePath: leaf.path,
        afterPath: null,
        before: leaf.value,
      });
    }
  }

  added(value: JsonValue, path: JsonPath): void {
    const out: { path: JsonPath; value: JsonValue }[] = [];
    leaves(value, path, out);
    for (const leaf of out) {
      this.changes.push({
        kind: "added",
        path: leaf.path,
        beforePath: null,
        afterPath: leaf.path,
        after: leaf.value,
      });
    }
  }

  walk(a: JsonValue, b: JsonValue, beforePath: JsonPath, afterPath: JsonPath) {
    const kind = kindOf(a);
    if (kind !== kindOf(b) || kind === "scalar") {
      if (jsonEquals(a, b)) return;
      this.changes.push({
        kind: "changed",
        path: afterPath,
        beforePath,
        afterPath,
        before: a,
        after: b,
      });
      return;
    }
    if (kind === "object") {
      this.objects(
        a as { [key: string]: JsonValue },
        b as { [key: string]: JsonValue },
        beforePath,
        afterPath,
      );
      return;
    }
    this.arrays(
      a as readonly JsonValue[],
      b as readonly JsonValue[],
      beforePath,
      afterPath,
    );
  }

  objects(
    a: { [key: string]: JsonValue },
    b: { [key: string]: JsonValue },
    beforePath: JsonPath,
    afterPath: JsonPath,
  ) {
    for (const key of Object.keys(a)) {
      const was = a[key] ?? null;
      if (Object.hasOwn(b, key)) {
        this.walk(
          was,
          b[key] ?? null,
          [...beforePath, key],
          [...afterPath, key],
        );
      } else {
        this.removed(was, [...beforePath, key]);
      }
    }
    for (const key of Object.keys(b)) {
      if (!Object.hasOwn(a, key))
        this.added(b[key] ?? null, [...afterPath, key]);
    }
  }

  arrays(
    a: readonly JsonValue[],
    b: readonly JsonValue[],
    beforePath: JsonPath,
    afterPath: JsonPath,
  ) {
    const at = (path: JsonPath, index: number) => [...path, String(index)];
    const pairs: [number, number][] = [];
    const usedA = new Set<number>();
    const usedB = new Set<number>();
    if (a.length * b.length <= ARRAY_MATCH_LIMIT) {
      // ① 같은 항목끼리 짝(같은 위치를 먼저 본다).
      a.forEach((item, i) => {
        let j = -1;
        if (i < b.length && !usedB.has(i) && jsonEquals(item, b[i])) j = i;
        else
          j = b.findIndex(
            (other, k) => !usedB.has(k) && jsonEquals(item, other),
          );
        if (j < 0) return;
        usedA.add(i);
        usedB.add(j);
        pairs.push([i, j]);
      });
      // ④ 짝의 after 위치가 단조 증가가 아니면 순서가 바뀐 것.
      if (
        pairs.some(
          (pair, index) =>
            index > 0 && pair[1] < (pairs[index - 1] as [number, number])[1],
        )
      ) {
        this.reorderedArrays.push(afterPath);
      }
    }
    // ② 남은 항목은 남은 순서끼리 짝지어 재귀, ③ 짝 없는 나머지는 삭제·추가.
    const restA = a.map((_, i) => i).filter(i => !usedA.has(i));
    const restB = b.map((_, j) => j).filter(j => !usedB.has(j));
    const common = Math.min(restA.length, restB.length);
    for (let k = 0; k < common; k += 1) {
      const i = restA[k] as number;
      const j = restB[k] as number;
      this.walk(
        a[i] ?? null,
        b[j] ?? null,
        at(beforePath, i),
        at(afterPath, j),
      );
    }
    for (const i of restA.slice(common))
      this.removed(a[i] ?? null, at(beforePath, i));
    for (const j of restB.slice(common))
      this.added(b[j] ?? null, at(afterPath, j));
  }
}

/**
 * 두 값의 leaf 단위 차이. scalar 는 `jsonEquals`(숫자 표기 차이 무시), 종류가 다르면 그 경로에
 * `changed` 하나, 객체는 키 합집합(before 키 순서 + after 에만 있는 키), 배열은 같은 항목끼리 먼저
 * 짝짓고 남은 것을 위치 순으로 짝지어 비교한다. 한쪽에만 있는 하위 트리는 leaf 마다 `added`·
 * `removed`.
 */
export function diffValues(before: JsonValue, after: JsonValue): ValueDiff {
  const collector = new Collector();
  collector.walk(before, after, [], []);
  return {
    changes: collector.changes,
    reorderedArrays: collector.reorderedArrays,
  };
}
