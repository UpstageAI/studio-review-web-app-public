// 결정적 난수(mulberry32). 같은 seed 면 언제나 같은 수열을 내므로 mock 데이터가 재현된다.

/** 여러 정수를 하나의 32-bit seed 로 섞는다(파일·페이지별 sub-seed 용). */
export function mixSeed(...parts) {
  let h = 0x811c9dc5;
  for (const part of parts) {
    h ^= Math.trunc(Number(part)) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
    h ^= h >>> 13;
  }
  return h >>> 0;
}

/**
 * `{ next, int, pick, chance }` 를 가진 난수기.
 * - `next()` 0 ≤ x < 1
 * - `int(min, max)` 양끝 포함 정수
 * - `pick(list)` 목록에서 하나
 * - `chance(p)` 확률 p 로 true
 */
export function createRng(seed) {
  let state = Math.trunc(Number(seed)) >>> 0 || 0x9e3779b9;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    pick(list) {
      return list[Math.floor(next() * list.length)];
    },
    chance(probability) {
      return next() < probability;
    },
  };
}
