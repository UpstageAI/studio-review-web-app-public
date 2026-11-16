export type Radian = number;
export type Degree = number;

// 한 지점을 표현한다
export type Point = { x: number; y: number };

// 타잎정보를 이용해서 코드에서 좌표계를 명확하게 표현하려고 정의합니다.
// Typescript가 큰 도움은 주지 못하지만 간단한 힌트를 주기에는 좋다고 생각됩니다.
export type ScreenPoint = Point;
export type CanvasPoint = Point;

export type ScreenX = number;
export type ScreenY = number;
export type CanvasX = number;
export type CanvasY = number;
export type CanvasDelta = number;
export type ScreenDelta = number;

export type Rect = { x: number; y: number; w: number; h: number };

export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
  midx: number;
  midy: number;
}

export type Vec3 = [number, number, number];
export type Matrix33 = [Vec3, Vec3, Vec3];

/**
 * 변환에 대한 정보를 갖고 있다. scale/rotation/translation과 더불어 이 값들을 기반으로 생성한 `matrix`도 같이 유지한다.
 * `matrix`는 캐쉬된 값이다.
 */
export interface Transform {
  scale: number;
  tx: number;
  ty: number;
  rotation: Radian;

  /**
   * `scale`, `tx`, `ty`, `rotation`으로 생성한 매트릭스 값임.
   */
  matrix: Matrix33;
}

/**
 * 좌표계의 제약정보를 제공한다.
 */
export interface CoordConstraint {
  minScale: number; // 최소 확대
  maxScale: number; // 최대 확대
}
