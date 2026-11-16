import { describe, expect, it } from "vitest";

import {
  resyncViewerScroll,
  VIEWER_TESTID,
  viewerScrollSelector,
} from "../viewer-scroll-sync";

function fakeRoot(hasScroller: boolean) {
  const events: Event[] = [];
  const queries: string[] = [];
  const scroller = {
    dispatchEvent(event: Event) {
      events.push(event);
      return true;
    },
  };
  return {
    events,
    queries,
    querySelector(selectors: string) {
      queries.push(selectors);
      return hasScroller ? scroller : null;
    },
  };
}

describe("viewerScrollSelector", () => {
  it("뷰어 item 의 스크롤 요소 testid 를 가리킨다", () => {
    expect(viewerScrollSelector(VIEWER_TESTID)).toBe(
      '[data-testid="job-review-viewer-scroll"]',
    );
  });
});

describe("resyncViewerScroll", () => {
  it("스크롤 요소가 있으면 scroll 이벤트를 한 번 보내고 true", () => {
    const root = fakeRoot(true);
    expect(resyncViewerScroll(root, VIEWER_TESTID)).toBe(true);
    expect(root.events).toHaveLength(1);
    expect(root.events[0].type).toBe("scroll");
  });

  it("보내는 이벤트는 bubble 하지 않는다", () => {
    const root = fakeRoot(true);
    resyncViewerScroll(root, VIEWER_TESTID);
    expect(root.events[0].bubbles).toBe(false);
  });

  it("선택자로 스크롤 요소를 찾는다", () => {
    const root = fakeRoot(true);
    resyncViewerScroll(root, "other-viewer");
    expect(root.queries).toEqual(['[data-testid="other-viewer-scroll"]']);
  });

  it("스크롤 요소가 없으면(한 장씩 모드) 아무것도 보내지 않고 false", () => {
    const root = fakeRoot(false);
    expect(resyncViewerScroll(root, VIEWER_TESTID)).toBe(false);
    expect(root.events).toHaveLength(0);
  });

  it("root 가 null 이면 false 이고 throw 하지 않는다", () => {
    expect(() => resyncViewerScroll(null, VIEWER_TESTID)).not.toThrow();
    expect(resyncViewerScroll(null, VIEWER_TESTID)).toBe(false);
  });
});
