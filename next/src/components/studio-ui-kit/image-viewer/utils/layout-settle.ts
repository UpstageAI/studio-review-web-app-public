export function layoutSettleKey(params: {
  readyImageKey: string | null;
  imageSize: { width: number; height: number };
  canvasSize: { width: number; height: number };
}): string | null {
  const { readyImageKey, imageSize, canvasSize } = params;
  if (!readyImageKey) return null;
  // 크기를 아직 모르면 정할 것이 없다 — 0 을 키에 섞으면 크기가 잠깐 0 으로
  // 튀는 동안 헛되이 배치를 다시 정하게 된다.
  if (imageSize.width <= 0 || imageSize.height <= 0) return null;
  if (canvasSize.width <= 0 || canvasSize.height <= 0) return null;
  return [
    readyImageKey,
    `${imageSize.width}x${imageSize.height}`,
    `${canvasSize.width}x${canvasSize.height}`,
  ].join("::");
}

export interface LayoutSettleGate {
  /** 이 키에 대해 배치를 정해야 하는지 */
  shouldSettle(key: string | null): boolean;
  /** 배치가 실제로 적용됐음을 기록한다 — 같은 키로는 다시 정하지 않는다 */
  markSettled(key: string): void;
}

export function createLayoutSettleGate(): LayoutSettleGate {
  let settledKey: string | null = null;
  return {
    shouldSettle(key) {
      if (!key) return false;
      return settledKey !== key;
    },
    markSettled(key) {
      settledKey = key;
    },
  };
}
