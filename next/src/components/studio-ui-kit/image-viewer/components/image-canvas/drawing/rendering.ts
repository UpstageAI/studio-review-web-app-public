import * as matrix from "./matrix";
import type { Degree, Matrix33, Radian, Transform } from "./types";

function matrixFromTranslationRotationScale(params: {
  tx: number;
  ty: number;
  rotation: Radian;
  scale: number;
}): Matrix33 {
  const { tx, ty, scale, rotation } = params;
  const S = matrix.scale(scale);
  const R = matrix.rotation(rotation);
  const T = matrix.translation(tx, ty);
  return matrix.multiply(T, R, S);
}

export function getImageTransform(
  screenw: number,
  screenh: number,
  imgw: number,
  imgh: number,
): Transform {
  const scaleH = screenh < imgh ? screenh / imgh : 1;
  const scaleW = screenw < imgw ? screenw / imgw : 1;
  const scale = Math.min(scaleH, scaleW, 1);

  const mappedw = imgw * scale;
  const mappedh = imgh * scale;
  // 스크린의 가운데 위치할 것이기 때문에 스크린의 중점을 기준으로 떨어진 거리만큼 이동시킨다.
  // 계산한 x,y가 이미지의 0,0이 화면에 떨어지는 점이다.
  const x = (screenw - mappedw) / 2;
  const y = (screenh - mappedh) / 2;

  const transform: Transform = {
    scale,
    rotation: 0,
    tx: x,
    ty: y,
    matrix: matrix.identity(),
  };

  const m = matrixFromTranslationRotationScale(transform);
  transform.matrix = m;

  return transform;
}

/**
 * 이미지 좌표 `(centerx, centery)` 가 화면 한가운데 오도록 주어진 배율로 맞춘
 * transform 을 만든다. 인용 bbox 로 이동할 때처럼 목표 배율과 목표 지점이 이미
 * 정해진 경우에 쓴다 — fit → zoom → pan 을 순서대로 부르면 각 단계가 직전
 * transform 을 읽어야 해서 상태 갱신을 기다려야 하지만, 이 함수는 한 번에
 * 최종 transform 을 계산한다. 회전은 0 으로 되돌린다.
 */
export function getFocusTransform(params: {
  screenw: number;
  screenh: number;
  scale: number;
  centerx: number;
  centery: number;
}): Transform {
  const { screenw, screenh, scale, centerx, centery } = params;
  const tx = screenw / 2 - centerx * scale;
  const ty = screenh / 2 - centery * scale;

  const transform: Transform = {
    scale,
    rotation: 0,
    tx,
    ty,
    matrix: matrixFromTranslationRotationScale({ tx, ty, rotation: 0, scale }),
  };

  return transform;
}

/**
 * 배율은 그대로 두고 이미지 좌상단을 화면의 `(tx, ty)` 로 옮긴 transform.
 *
 * 휠로 페이지 안을 훑을 때 쓴다. 이동량(delta)을 누적해 적용하는 `panTo` 는 직전
 * transform 이 화면에 반영된 뒤여야 다음 이동을 계산할 수 있어서, 트랙패드처럼
 * 작은 이벤트가 빠르게 몰리면 이동이 뭉개진다(같은 위치에서 계속 계산해 화면이
 * 거의 안 움직이고, 페이지 끝에도 닿지 못한다). 목표 위치를 그대로 지정하면
 * 이벤트가 몰려 한 번만 반영되더라도 마지막 목표까지 한 번에 옮겨진다.
 * 회전은 0 으로 되돌린다 — 회전 중에는 화면 축과 이미지 축이 어긋난다.
 */
export function getTranslatedTransform(params: {
  scale: number;
  tx: number;
  ty: number;
}): Transform {
  const { scale, tx, ty } = params;
  return {
    scale,
    rotation: 0,
    tx,
    ty,
    matrix: matrixFromTranslationRotationScale({ tx, ty, rotation: 0, scale }),
  };
}

/**
 * 배율은 그대로 두고 페이지의 위/아래 끝을 화면에 맞춘 transform.
 * 확대한 채 페이지를 넘길 때 쓴다 — 넘길 때마다 fit 으로 되돌리면 읽던 배율이
 * 풀린다. 진행 방향의 첫 부분(아래로 넘기면 새 페이지 맨 위)이 보이게 둔다.
 */
export function getAlignedTransform(params: {
  screenw: number;
  screenh: number;
  imgw: number;
  imgh: number;
  scale: number;
  align: "top" | "bottom";
}): Transform {
  const { screenw, screenh, imgw, imgh, scale, align } = params;
  const mappedw = imgw * scale;
  const mappedh = imgh * scale;

  const tx = (screenw - mappedw) / 2;
  // 넘치지 않으면 가운데, 넘치면 진행 방향 끝에 붙인다.
  const ty =
    mappedh <= screenh
      ? (screenh - mappedh) / 2
      : align === "top"
        ? 0
        : screenh - mappedh;

  const transform: Transform = {
    scale,
    rotation: 0,
    tx,
    ty,
    matrix: matrixFromTranslationRotationScale({ tx, ty, rotation: 0, scale }),
  };

  return transform;
}

export function getCssTransform(transform: Transform): string {
  const m = transform.matrix;
  return `matrix(${m[0][0]}, ${m[1][0]}, ${m[0][1]}, ${m[1][1]}, ${m[0][2]}, ${m[1][2]})`;
}

/**
 * `anchorx`와 `anchory`를 기준으로해서 주어진 `ratio`만큼 추가로 확대/축소한다. `ratio=0.2`이면 20%더 확대하자는 의미이다.
 * 반대로 `ratio=-0.2`이면 20% 축소하는 의미이다. 좌표변환시 확대/축소가 제약에 걸리게되면 값에 따라서 조정된다.
 */
export function zoomBy(params: {
  ratio: number;
  anchorx: number;
  anchory: number;
  xform: Transform;
}): Transform {
  const { ratio, xform } = params;

  const curScale = xform.scale;
  const newScale = curScale * (1 + ratio);

  return zoomTo({
    ...params,
    newScale,
  });
}

export function zoomTo(params: {
  newScale: number;
  anchorx: number;
  anchory: number;
  xform: Transform;
}): Transform {
  const { newScale, anchorx, anchory, xform } = params;

  const inv = matrix.inverse(xform.matrix);
  const { x: basex, y: basey } = matrix.mulxy(inv, anchorx, anchory);

  // 특정점을 기준으로 확대를 만들어내는 매트릭스계산이다.
  // 먼저 기준점을 원점으로 이동하고 확대/축소 한후에 다시 기준점만큼 이동시킨다.
  const S = matrix.scale(newScale);
  const R = matrix.rotation(toRadian(xform.rotation));
  const M = matrix.multiply(R, S);

  const { x: newx, y: newy } = matrix.mulxy(M, basex, basey);
  const dx = anchorx - newx;
  const dy = anchory - newy;

  const OUT = matrix.multiply(matrix.translation(dx, dy), M);

  const newTransform: Transform = {
    ...xform,
    scale: newScale,
    matrix: OUT,
  };
  return newTransform;
}

export function panTo(params: {
  x: number;
  y: number;
  xform: Transform;
}): Transform {
  const { x, y, xform } = params;
  const T = matrix.translation(x, y);
  const m = matrix.multiply(T, xform.matrix);
  const newTransform = {
    ...xform,
    matrix: m,
  };
  return newTransform;
}

function toRadian(degree: Degree): Radian {
  return (Math.PI * absDegree(degree)) / 180;
}

function absDegree(degree: Degree): Degree {
  while (degree < 0) degree += 360;
  return degree % 360;
}

/**
 * 화면을 주어진 각도 `degree`만큼 추가로 회전시킨다.
 *
 * NOTE:
 * 매트릭스 변환이 렌더링된 매트릭스 `xform`에 적용된다. 의미는 anchorx, anchory 좌표계는
 * `xform` 좌표계에 맞춰졌다는 뜻이다. `xform`이 화면에 해당 엘리먼트를 렌더링하는데 사용하고 있다면
 * 좌표계는 화면에서 보고있는 좌표계가 된다. 예를들면, 왼쪽, 위에가 0,0이 되고, 오른쪽 아래가 캔바스
 * 너비, 높이가 되는 좌표계이다.
 */
export function rotateBy(params: {
  anchorx: number;
  anchory: number;
  degree: Degree;
  xform: Transform;
}): Transform {
  const { degree, anchorx, anchory, xform } = params;

  const T1 = matrix.translation(-anchorx, -anchory);
  const R = matrix.rotation(toRadian(degree));
  const T2 = matrix.translation(anchorx, anchory);
  const M = matrix.multiply(T2, R, T1, xform.matrix);

  const newTransform: Transform = {
    ...xform,
    rotation: absDegree(xform.rotation + degree),
    matrix: M,
  };
  return newTransform;
}
