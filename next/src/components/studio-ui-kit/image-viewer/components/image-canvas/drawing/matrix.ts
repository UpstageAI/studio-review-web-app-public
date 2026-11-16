import type { Matrix33, Point, Radian } from "./types";

/**
 * 매트릭스 a와 b곱하기. 새로운 매트릭스를 돌려준다.
 */
function multiplyAB(a: Matrix33, b: Matrix33): Matrix33 {
  return [
    [
      a[0][0] * b[0][0] + a[0][1] * b[1][0] + a[0][2] * b[2][0],
      a[0][0] * b[0][1] + a[0][1] * b[1][1] + a[0][2] * b[2][1],
      a[0][0] * b[0][2] + a[0][1] * b[1][2] + a[0][2] * b[2][2],
    ],
    [
      a[1][0] * b[0][0] + a[1][1] * b[1][0] + a[1][2] * b[2][0],
      a[1][0] * b[0][1] + a[1][1] * b[1][1] + a[1][2] * b[2][1],
      a[1][0] * b[0][2] + a[1][1] * b[1][2] + a[1][2] * b[2][2],
    ],
    [
      a[2][0] * b[0][0] + a[2][1] * b[1][0] + a[2][2] * b[2][0],
      a[2][0] * b[0][1] + a[2][1] * b[1][1] + a[2][2] * b[2][1],
      a[2][0] * b[0][2] + a[2][1] * b[1][2] + a[2][2] * b[2][2],
    ],
  ];
}

/**
 * 단위벡터를 생성해서 돌려준다
 */
export function identity(): Matrix33 {
  return [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
}

/**
 * 복수개의 매트릭스를 오른쪽 -> 왼쪽으로 곱한다. 모두 곱한 값을 결과로 돌려준다.
 */
export function multiply(...ms: Matrix33[]): Matrix33 {
  let out = identity();
  for (let i = ms.length - 1; i >= 0; --i) {
    out = multiplyAB(ms[i], out);
  }
  return out;
}

/**
 * 주어진 좌표만큼 이동시키는 matrix를 돌려준다
 */
export function translation(tx: number, ty: number): Matrix33 {
  return [
    [1, 0, tx],
    [0, 1, ty],
    [0, 0, 1],
  ];
}

/**
 * 주어진 `s`만큼 확대/축소 시키는 매트릭스를 돌려준다
 */
export function scale(s: number): Matrix33 {
  return [
    [s, 0, 0],
    [0, s, 0],
    [0, 0, 1],
  ];
}

/**
 * 주어진 `r`만큼 회전시키는 매트릭스를 돌려준다
 */
export function rotation(r: Radian): Matrix33 {
  const sinv = Math.sin(r);
  const cosv = Math.cos(r);
  return [
    [cosv, -sinv, 0],
    [sinv, cosv, 0],
    [0, 0, 1],
  ];
}

/**
 * 주어진 매트릭스 `m`에 대한 행렬식값을 돌려준다
 */
export function determinant(m: Matrix33): number {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}

/**
 * 주어진 매트릭스 `m`의 역행렬을 돌려준다
 */
export function inverse(m: Matrix33): Matrix33 {
  return times(
    [
      [
        m[1][1] * m[2][2] - m[1][2] * m[2][1],
        m[0][2] * m[2][1] - m[0][1] * m[2][2],
        m[0][1] * m[1][2] - m[0][2] * m[1][1],
      ],
      [
        m[1][2] * m[2][0] - m[1][0] * m[2][2],
        m[0][0] * m[2][2] - m[0][2] * m[2][0],
        m[0][2] * m[1][0] - m[0][0] * m[1][2],
      ],
      [
        m[1][0] * m[2][1] - m[1][1] * m[2][0],
        m[0][1] * m[2][0] - m[0][0] * m[2][1],
        m[0][0] * m[1][1] - m[0][1] * m[1][0],
      ],
    ],
    1 / determinant(m),
  );
}

/**
 * 주어진 행렬의 모든 요소에 대해서 `v`만큼 스칼라 곱한 행렬을 돌려준다
 */
export function times(m: Matrix33, v: number): Matrix33 {
  return m.map(row => row.map(x => x * v)) as Matrix33;
}

/**
 * `x`와 `y`에 행렬을 곱한다
 */
export function mulxy(m: Matrix33, x: number, y: number): Point {
  const xx = m[0][0] * x + m[0][1] * y + m[0][2];
  const yy = m[1][0] * x + m[1][1] * y + m[1][2];
  return { x: xx, y: yy };
}

/**
 * 행렬을 복제한다
 */
export function clone(m: Matrix33): Matrix33 {
  return [
    [m[0][0], m[0][1], m[0][2]],
    [m[1][0], m[1][1], m[1][2]],
    [m[2][0], m[2][1], m[2][2]],
  ];
}
