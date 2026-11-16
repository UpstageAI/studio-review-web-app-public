export const EDGE_FLIP_DELTA = 30;

/**
 * 마우스 휠 한 눈금으로 보려면 delta 가 이만큼은 되어야 한다(px).
 *
 * 휠은 눈금마다 큰 delta 를 띄엄띄엄 보내고, 계속 굴리는 것은 계속 넘기겠다는
 * 뜻이다 — 그래서 "한 제스처에 한 장" 잠금을 적용하지 않는다. 반대로 트랙패드는
 * 손을 떼도 관성으로 이어지므로 잠가야 한 번에 여러 장이 지나가지 않는다.
 */
export const WHEEL_NOTCH_MIN_DELTA = 40;

/**
 * 마우스 휠 한 눈금으로 보려면 직전 이벤트와 이만큼은 떨어져 있어야 한다(ms).
 *
 * 크기만으로 가르면 안 된다 — 트랙패드도 빠르게 밀면 delta 가 40~120px 까지
 * 커져서 휠 눈금으로 오인되고, 그러면 잠금이 풀려 한 번에 두세 장이 넘어간다.
 * 휠은 눈금 사이가 뜨고(수십~수백 ms), 트랙패드는 프레임마다(10~16ms) 쏟아진다.
 */
export const WHEEL_NOTCH_MIN_GAP_MS = 40;

/**
 * 마우스 휠 한 눈금인지 — 크기가 크고(WHEEL_NOTCH_MIN_DELTA) 직전 이벤트와
 * 떨어져 있어야(WHEEL_NOTCH_MIN_GAP_MS) 한다. 빠른 트랙패드 스크롤과 구분하는
 * 것이 목적이다.
 */
export function isWheelNotch(
  delta: number,
  prevAt: number | null = null,
  now: number = 0,
): boolean {
  if (Math.abs(delta) < WHEEL_NOTCH_MIN_DELTA) return false;
  if (prevAt === null) return true;
  return now - prevAt >= WHEEL_NOTCH_MIN_GAP_MS;
}
/** 스크롤이 이만큼 멎으면 누적을 버린다(ms) — 관성 스크롤 꼬리로 넘어가지 않게. */
export const EDGE_FLIP_RESET_MS = 400;

/** 이만큼 휠이 멎으면 다음 스크롤은 새 제스처로 본다(ms) */
export const GESTURE_END_MS = 300;

export interface GestureFlipLock {
  /**
   * 휠 이벤트마다 부른다 — 제스처가 끊겼으면 잠금을 푼다.
   * @returns 이번 이벤트로 새 제스처가 시작됐으면 true
   */
  observe: (now: number) => boolean;
  /**
   * 시각만 갱신하고 잠금 해제는 미룬다. 넘긴 페이지의 이미지를 그리는 동안처럼
   * 아직 전환이 끝나지 않은 구간에 쓴다 — 그 사이 화면이 한참 멈춰 이벤트 간격이
   * 벌어져도 "손을 뗐다"고 오해하지 않는다.
   */
  hold: (now: number) => void;
  /** 이 제스처에서 이미 한 장 넘겼는지 */
  isLocked: () => boolean;
  /** 한 장 넘겼음을 기록한다 */
  lock: () => void;
}

/**
 * 한 번의 트랙패드 제스처에 페이지 한 장만 넘기게 잠근다.
 *
 * 트랙패드는 손을 떼도 관성으로 한참 더 이벤트를 흘린다. 그때마다 넘기면 한 번
 * 밀었는데 여러 장이 지나가 어디를 읽고 있었는지 놓친다. 스크롤이 멎으면
 * (`idleMs`) 잠금을 풀고 다음 한 장을 허용한다.
 *
 * 페이지 끝에 닿는 순간에도 잠근다 — 세게 밀어 끝까지 내려간 그 힘 그대로 다음
 * 장까지 넘어가면, 페이지 아래쪽을 볼 새가 없다. 끝에서 한 번 걸리고, 한 번 더
 * 밀어야 넘어간다.
 *
 * 마우스 휠 눈금(`isWheelNotch`)에는 적용하지 않는다 — 계속 굴리는 것은 계속
 * 넘기겠다는 뜻이라, 잠그면 한 장마다 손을 멈춰야 한다.
 */
export function createGestureFlipLock({
  idleMs = GESTURE_END_MS,
}: { idleMs?: number } = {}): GestureFlipLock {
  let locked = false;
  let lastAt: number | null = null;

  return {
    observe(now) {
      const started = lastAt === null || now - lastAt >= idleMs;
      if (started) locked = false;
      lastAt = now;
      return started;
    },
    hold(now) {
      lastAt = now;
    },
    isLocked() {
      return locked;
    },
    lock() {
      locked = true;
    },
  };
}

export interface EdgeScrollAccumulator {
  /** @returns 이번 스크롤로 페이지를 넘겨야 하면 true */
  push: (delta: number, now: number) => boolean;
  reset: () => void;
}

/**
 * 확대 상태에서 페이지 끝에 닿았을 때, 이어서 굴린 양이 문턱을 넘으면 페이지를
 * 넘긴다.
 *
 * 끝에 닿은 첫 이벤트에 바로 넘기면 인용을 읽는 도중 관성 스크롤 꼬리에 페이지가
 * 휙 넘어간다. 같은 방향으로 이어서 굴린 양이 문턱을 넘을 때만 넘기고, 손을 떼
 * 스크롤이 멎으면(resetMs) 처음부터 다시 센다.
 */
export function createEdgeScrollAccumulator({
  threshold = EDGE_FLIP_DELTA,
  resetMs = EDGE_FLIP_RESET_MS,
}: { threshold?: number; resetMs?: number } = {}): EdgeScrollAccumulator {
  let amount = 0;
  let direction = 0;
  let lastAt = 0;

  return {
    push(delta, now) {
      const nextDirection = Math.sign(delta);
      if (nextDirection === 0) return false;

      // 방향이 바뀌었거나 한동안 멎었으면 처음부터 다시 센다.
      const continuous = direction === nextDirection && now - lastAt < resetMs;
      amount = (continuous ? amount : 0) + Math.abs(delta);
      direction = nextDirection;
      lastAt = now;

      if (amount < threshold) return false;
      amount = 0;
      return true;
    },
    reset() {
      amount = 0;
      direction = 0;
      lastAt = 0;
    },
  };
}

/**
 * 현재 배율에서 페이지가 캔버스를 넘치는지 (넘쳐야 페이지 안 이동이 의미 있다).
 *
 * 크기를 아직 모르는 동안(0 이하 — 마운트 직후엔 음수도 보고된다)은 확대 상태로
 * 보지 않는다. 여기서 잘못 true 를 주면 호출부가 기본 fit 을 건너뛰어 뷰어가
 * 깨진 배율에 갇힌다.
 */
export function isPageOverflowing(params: {
  shownWidth: number;
  shownHeight: number;
  canvas: { width: number; height: number };
}): boolean {
  const { shownWidth, shownHeight, canvas } = params;
  if (canvas.width <= 0 || canvas.height <= 0) return false;
  if (shownWidth <= 0 || shownHeight <= 0) return false;
  return shownWidth > canvas.width + 1 || shownHeight > canvas.height + 1;
}
