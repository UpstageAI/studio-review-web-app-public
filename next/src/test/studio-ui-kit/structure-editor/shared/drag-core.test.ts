import {
  EDGE_MAX_SPEED,
  EDGE_ZONE,
  edgeScrollVelocity,
  indexAfterRemoval,
  watchStaleDrag,
} from "@/components/studio-ui-kit/structure-editor/shared/drag-core";

describe("indexAfterRemoval", () => {
  it("끌던 것이 앞에 있었으면 하나 당기고, 뒤거나 같으면 그대로", () => {
    expect(indexAfterRemoval(0, 3)).toBe(2);
    expect(indexAfterRemoval(1, 2)).toBe(1);
    expect(indexAfterRemoval(3, 0)).toBe(0);
    expect(indexAfterRemoval(2, 2)).toBe(2);
    expect(indexAfterRemoval(5, 3)).toBe(3);
  });

  it("앞에서 뒤로 옮기면 한 칸 당겨진다", () => {
    expect(indexAfterRemoval(1, 4)).toBe(3);
    expect(indexAfterRemoval(4, 1)).toBe(1);
  });
});

describe("edgeScrollVelocity", () => {
  it("시작 쪽 가장자리(왼쪽·위)는 음수, 끝 쪽(오른쪽·아래)은 양수, 가운데는 0", () => {
    expect(edgeScrollVelocity(500, 0, 1000, 40, 16)).toBe(0);
    expect(edgeScrollVelocity(0, 0, 1000, 40, 16)).toBe(-16);
    expect(edgeScrollVelocity(20, 0, 1000, 40, 16)).toBe(-8);
    expect(edgeScrollVelocity(40, 0, 1000, 40, 16)).toBe(0);
    expect(edgeScrollVelocity(960, 0, 1000, 40, 16)).toBe(0);
    expect(edgeScrollVelocity(980, 0, 1000, 40, 16)).toBe(8);
    expect(edgeScrollVelocity(1000, 0, 1000, 40, 16)).toBe(16);
  });

  it("창 밖은 ±max 로 자르고, 창이 좁으면 가장자리 폭을 반으로 줄인다", () => {
    expect(edgeScrollVelocity(-500, 0, 1000, 40, 16)).toBe(-16);
    expect(edgeScrollVelocity(5000, 0, 1000, 40, 16)).toBe(16);
    expect(edgeScrollVelocity(25, 0, 50, 40, 16)).toBe(0);
    expect(edgeScrollVelocity(10, 0, 50, 40, 16)).toBeCloseTo(-9.6);
    expect(edgeScrollVelocity(40, 0, 50, 40, 16)).toBeCloseTo(9.6);
  });

  it("창이 화면 안쪽(오른쪽·아래)에 있어도 창 기준으로 센다", () => {
    expect(edgeScrollVelocity(610, 600, 1000, 40, 16)).toBe(-12);
    expect(edgeScrollVelocity(990, 600, 1000, 40, 16)).toBe(12);
  });

  it("zone·max 기본값은 40·16", () => {
    expect(EDGE_ZONE).toBe(40);
    expect(EDGE_MAX_SPEED).toBe(16);
    expect(edgeScrollVelocity(0, 0, 1000)).toBe(-16);
    expect(edgeScrollVelocity(20, 0, 1000)).toBe(-8);
    expect(edgeScrollVelocity(1000, 0, 1000)).toBe(16);
  });

  it("쓸모없는 입력은 0", () => {
    expect(edgeScrollVelocity(10, 0, 1000, 0, 16)).toBe(0);
    expect(edgeScrollVelocity(10, 0, 1000, 40, 0)).toBe(0);
    expect(edgeScrollVelocity(10, 100, 100, 40, 16)).toBe(0);
    expect(edgeScrollVelocity(10, 200, 100, 40, 16)).toBe(0);
  });
});

describe("watchStaleDrag", () => {
  it("포인터 이벤트가 오면 한 번만 정리하고 리스너를 뗀다", () => {
    const target = new EventTarget();
    let calls = 0;
    watchStaleDrag(target, () => {
      calls += 1;
    });
    target.dispatchEvent(new Event("pointermove"));
    target.dispatchEvent(new Event("pointerdown"));
    target.dispatchEvent(new Event("pointermove"));
    expect(calls).toBe(1);
  });

  it("pointerdown 으로도 정리한다", () => {
    const target = new EventTarget();
    let calls = 0;
    watchStaleDrag(target, () => {
      calls += 1;
    });
    target.dispatchEvent(new Event("pointerdown"));
    expect(calls).toBe(1);
  });

  it("해제한 뒤에는 부르지 않는다(drag 이벤트는 무시)", () => {
    const target = new EventTarget();
    let calls = 0;
    const dispose = watchStaleDrag(target, () => {
      calls += 1;
    });
    target.dispatchEvent(new Event("dragover"));
    dispose();
    dispose();
    target.dispatchEvent(new Event("pointermove"));
    expect(calls).toBe(0);
  });

  it("drag 이벤트로는 정리하지 않고 포인터 이벤트에 한 번만 정리한다", () => {
    const target = new EventTarget();
    let calls = 0;
    watchStaleDrag(target, () => {
      calls += 1;
    });
    target.dispatchEvent(new Event("dragover"));
    expect(calls).toBe(0);
    target.dispatchEvent(new Event("pointermove"));
    target.dispatchEvent(new Event("pointerdown"));
    expect(calls).toBe(1);
  });

  it("해제한 뒤에는 pointerdown 이 와도 부르지 않는다", () => {
    const target = new EventTarget();
    let calls = 0;
    const dispose = watchStaleDrag(target, () => {
      calls += 1;
    });
    dispose();
    target.dispatchEvent(new Event("pointerdown"));
    expect(calls).toBe(0);
  });
});
