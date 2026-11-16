/**
 * jsdom 렌더 테스트(`*.test.tsx`) 공통 준비.
 *
 * jsdom 에 없는 브라우저 API 는 호출 기록만 남기는 stub 으로 채운다. 레이아웃·스크롤·포인터 캡처를
 * 흉내 내지 않으므로, 그 결과가 필요한 확인은 mock 스모크나 `mock:dom` 캡처로 한다.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

export interface DomStubCall {
  api: string;
  target: unknown;
  args: unknown[];
}

/** 테스트가 읽을 수 있는 stub 호출 기록. 테스트마다 비운다. */
export const domStubCalls: DomStubCall[] = [];

function record(api: string, target: unknown, args: unknown[]) {
  domStubCalls.push({ api, target, args });
}

class ResizeObserverStub {
  constructor(callback: ResizeObserverCallback) {
    record("ResizeObserver", this, [callback]);
  }
  observe(...args: unknown[]) {
    record("ResizeObserver.observe", this, args);
  }
  unobserve(...args: unknown[]) {
    record("ResizeObserver.unobserve", this, args);
  }
  disconnect() {
    record("ResizeObserver.disconnect", this, []);
  }
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver =
    ResizeObserverStub as unknown as typeof ResizeObserver;
}

const elementProto = Element.prototype as Element & {
  hasPointerCapture?: (pointerId: number) => boolean;
  setPointerCapture?: (pointerId: number) => void;
  releasePointerCapture?: (pointerId: number) => void;
};

if (typeof elementProto.scrollIntoView !== "function") {
  elementProto.scrollIntoView = function scrollIntoView(...args: unknown[]) {
    record("scrollIntoView", this, args);
  };
}
if (typeof elementProto.setPointerCapture !== "function") {
  elementProto.setPointerCapture = function setPointerCapture(
    pointerId: number,
  ) {
    record("setPointerCapture", this, [pointerId]);
  };
}
if (typeof elementProto.releasePointerCapture !== "function") {
  elementProto.releasePointerCapture = function releasePointerCapture(
    pointerId: number,
  ) {
    record("releasePointerCapture", this, [pointerId]);
  };
}
if (typeof elementProto.hasPointerCapture !== "function") {
  elementProto.hasPointerCapture = function hasPointerCapture(
    pointerId: number,
  ) {
    record("hasPointerCapture", this, [pointerId]);
    return false;
  };
}

if (typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string): MediaQueryList => {
    const list = {
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    } as MediaQueryList;
    record("matchMedia", window, [query]);
    return list;
  };
}

afterEach(() => {
  cleanup();
  domStubCalls.length = 0;
});
