type PrimitiveValue = string | number | boolean;
type Coordinate = { x: number; y: number };

/**
 * 이미지 뷰어가 하이라이트를 렌더링하는 데 필요한 데이터 계약.
 * 런타임 검증은 데이터를 소유한 소비처에서 담당한다.
 */
export interface HighlightValue {
  _value: PrimitiveValue | PrimitiveValue[];
  page: number;
  coordinates: Coordinate[];
  /**
   * (선택) Word 단위 coordinates 배열
   * - API에서 제공되지 않을 수 있음
   * - 각 word의 bbox를 개별적으로 렌더링할 때 사용
   */
  word_coordinates?: Coordinate[][];
  /**
   * (선택) 하이라이트를 칠할 CSS 색 (예: "#2563eb", "oklch(0.6 0.2 250)")
   * - SVG fill·stroke 에 그대로 쓴다. 테마 토큰 이름은 풀지 않는다
   * - 없으면 뷰어의 `highlightColor`를 쓴다
   */
  color?: string;
  /**
   * (선택) Word coordinates를 칠할 CSS 색
   * - color와 다른 색상을 사용하여 시각적 구분 가능
   * - 없으면 뷰어의 `wordHighlightColor`를 쓴다
   */
  word_coordinates_color?: string;
}

/**
 * 하이라이트 값에 고유 ID를 추가한 타입
 * 여러 기능(IE, DP, Image Viewer)에서 공통으로 사용되는 타입
 *
 * @example
 * {
 *   id: "highlight-123",
 *   _value: "2021",
 *   page: 1,
 *   coordinates: [{"x": 100, "y": 100}, {"x": 200, "y": 200}],
 *   word_coordinates: [[{"x": 100, "y": 100}, {"x": 120, "y": 120}]],
 *   document_id: "7f26abce-35c0-4a82-865e-78349cffab2c",
 *   color: "#2563eb",
 *   word_coordinates_color: "#f97316"
 * }
 */
export interface HighlightValueWithId extends HighlightValue {
  /** 하이라이트를 구분하기 위한 고유 ID (value가 동일할 때 이를 구분하기 위해 추가) */
  id: string;
  /** 하이라이트가 속한 문서의 ID (다른 문서로 이동 시 사용) */
  document_id?: string;
  /** Word 단위 coordinates 배열 (optional) - API에서 제공되지 않을 수 있음 */
  word_coordinates?: Array<Array<{ x: number; y: number }>>;
  /** Main coordinates bbox 색 (CSS 색, 없으면 뷰어 기본 색) */
  color?: string;
  /** Word coordinates bbox 색 (CSS 색, 없으면 뷰어 기본 색) */
  word_coordinates_color?: string;
}
