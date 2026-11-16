import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { domStubCalls } from "../../setup-dom";
import { snapshotHtml } from "../../dom-snapshot";
import {
  DocumentList,
  type DocumentListItem,
  type DocumentListLabels,
} from "@/components/studio-ui-kit/document-list/document-list";

const LABELS: DocumentListLabels = {
  list: "문서 목록",
  untitled: "라벨 없음",
  excluded: "제외한 페이지",
  pageCount: count => `${count}쪽`,
  status: {
    changed: "바뀜",
    recheck: "재확인 필요",
    locked: "편집 불가",
    excluded: "제외",
  },
  flags: { danger: "실패", warning: "경고" },
  unvisited: "열어 보지 않음",
  hints: {
    danger: "검증 실패가 있다",
    changed: "고친 값이 있다",
    unvisited: "아직 열어 보지 않은 문서",
  },
};

const TEST_ID = "dl";

function selectButtons() {
  return screen.queryAllByTestId(`${TEST_ID}-button-select`);
}

function buttonOf(id: string) {
  const button = document.querySelector<HTMLButtonElement>(
    `[data-testid="${TEST_ID}-button-select"][data-document-id="${id}"]`,
  );
  if (!button) throw new Error(`no row button for ${id}`);
  return button;
}

/** 프레임 하나를 흘려 rAF 콜백(스크롤 → 상태)과 그 뒤 렌더를 끝낸다. */
async function flushFrame() {
  await act(
    () =>
      new Promise<void>(resolve =>
        requestAnimationFrame(() => setTimeout(resolve, 0)),
      ),
  );
}

const SMALL_ITEMS: DocumentListItem[] = [
  {
    id: "doc-1",
    label: "청구서",
    pageCount: 2,
    flag: "danger",
    status: "changed",
    groupLabel: "1 묶음",
  },
  {
    id: "doc-2",
    label: null,
    pageCount: 1,
    visited: false,
    groupLabel: "1 묶음",
  },
  {
    id: "doc-3",
    label: "영수증",
    pageCount: 3,
    status: "recheck",
    flag: "warning",
    visited: true,
    ordinal: 7,
    groupLabel: "2 묶음",
  },
  {
    id: "doc-4",
    label: "계약서",
    pageCount: 4,
    status: "excluded",
    groupLabel: "2 묶음",
  },
];

function manyItems(count: number): DocumentListItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `doc-${index + 1}`,
    label: `문서 ${index + 1}`,
    pageCount: 1,
  }));
}

describe("DocumentList (비가상)", () => {
  it("행 버튼을 누르면 그 문서 id 로 onSelect 를 부른다", () => {
    const selected: string[] = [];
    render(
      <DocumentList
        items={SMALL_ITEMS}
        selectedId="doc-1"
        onSelect={id => selected.push(id)}
        labels={LABELS}
        testId={TEST_ID}
      />,
    );

    fireEvent.click(buttonOf("doc-3"));
    fireEvent.click(buttonOf("doc-1"));
    expect(selected).toEqual(["doc-3", "doc-1"]);
  });

  it("선택 행만 aria-current=true 이고 라벨이 없으면 untitled 문구, 번호는 ordinal 또는 위치 + 1", () => {
    render(
      <DocumentList
        items={SMALL_ITEMS}
        selectedId="doc-2"
        onSelect={() => {}}
        labels={LABELS}
        testId={TEST_ID}
      />,
    );

    const current = selectButtons().filter(
      button => button.getAttribute("aria-current") === "true",
    );
    expect(current).toEqual([buttonOf("doc-2")]);
    expect(buttonOf("doc-2")).toHaveTextContent("라벨 없음");
    expect(buttonOf("doc-1")).toHaveTextContent(/^1청구서/);
    expect(buttonOf("doc-3")).toHaveTextContent(/^7영수증/);
    expect(buttonOf("doc-4")).toHaveTextContent(/^4계약서/);
  });

  it("hints 문구가 있는 표식만 aria-describedby 로 숨은 설명을 잇는다(판정 → 상태 → 안 읽음 순)", () => {
    render(
      <DocumentList
        items={SMALL_ITEMS}
        selectedId={null}
        onSelect={() => {}}
        labels={LABELS}
        testId={TEST_ID}
      />,
    );

    const describedText = (id: string) =>
      (buttonOf(id).getAttribute("aria-describedby") ?? "")
        .split(" ")
        .filter(Boolean)
        .map(hintId => {
          const hint = document.getElementById(hintId);
          expect(hint).not.toBeNull();
          expect(hint).toHaveAttribute("hidden");
          return hint!.textContent;
        });

    // doc-1: danger(힌트 있음) + changed(힌트 있음)
    expect(describedText("doc-1")).toEqual([
      "검증 실패가 있다",
      "고친 값이 있다",
    ]);
    // doc-2: 안 읽음(힌트 있음)
    expect(describedText("doc-2")).toEqual(["아직 열어 보지 않은 문서"]);
    // doc-3: warning·recheck 는 힌트 문구가 없어 설명을 잇지 않는다
    expect(buttonOf("doc-3")).not.toHaveAttribute("aria-describedby");
    expect(buttonOf("doc-4")).not.toHaveAttribute("aria-describedby");
  });

  it("표식 이름은 sr-only 로 행 이름에 들어가고 안 읽음 점은 visited=false 일 때만 그린다", () => {
    render(
      <DocumentList
        items={SMALL_ITEMS}
        selectedId={null}
        onSelect={() => {}}
        labels={LABELS}
        testId={TEST_ID}
      />,
    );

    const markersOf = (id: string) =>
      Array.from(buttonOf(id).querySelectorAll("[data-marker]")).map(el =>
        el.getAttribute("data-marker"),
      );
    expect(markersOf("doc-1")).toEqual(["danger", "changed"]);
    expect(markersOf("doc-2")).toEqual(["unvisited"]);
    expect(markersOf("doc-3")).toEqual(["warning", "recheck"]);
    expect(markersOf("doc-4")).toEqual(["excluded"]);
    expect(buttonOf("doc-1")).toHaveAccessibleName("1청구서실패바뀜2쪽");
    expect(buttonOf("doc-2")).toHaveAccessibleName(
      "2라벨 없음열어 보지 않음1쪽",
    );
    expect(buttonOf("doc-4")).toHaveClass("opacity-60");
  });

  it("groupLabel 이 바뀌는 자리에 그룹 머리를 넣고 제외 묶음은 맨 끝에 둔다", () => {
    render(
      <DocumentList
        items={SMALL_ITEMS}
        excluded={{ pageCount: 5 }}
        selectedId={null}
        onSelect={() => {}}
        labels={LABELS}
        testId={TEST_ID}
      />,
    );

    const headers = screen.getAllByTestId(`${TEST_ID}-group-header`);
    expect(headers.map(header => header.textContent)).toEqual([
      "1 묶음",
      "2 묶음",
    ]);
    expect(headers[0]).toHaveAttribute("role", "presentation");

    const list = screen.getByRole("list");
    const lastRow = list.lastElementChild!;
    expect(lastRow).toHaveTextContent("제외한 페이지5쪽");
    expect(lastRow.querySelector("button")).toBeNull();
    expect(screen.queryByTestId(`${TEST_ID}-viewport`)).toBeNull();
  });

  it("제외 페이지 수가 0 이면 제외 묶음을 그리지 않는다", () => {
    render(
      <DocumentList
        items={SMALL_ITEMS}
        excluded={{ pageCount: 0 }}
        selectedId={null}
        onSelect={() => {}}
        labels={LABELS}
        testId={TEST_ID}
      />,
    );
    expect(screen.queryByText("제외한 페이지")).toBeNull();
  });

  it("선택이 실제로 바뀔 때만 선택 행에 scrollIntoView(nearest) 를 부르고 처음 열 때·같은 선택 재렌더에는 부르지 않는다", () => {
    const scrolls = () =>
      domStubCalls.filter(call => call.api === "scrollIntoView");
    const { rerender } = render(
      <DocumentList
        items={SMALL_ITEMS}
        selectedId="doc-1"
        onSelect={() => {}}
        labels={LABELS}
        testId={TEST_ID}
      />,
    );
    expect(scrolls()).toHaveLength(0);

    rerender(
      <DocumentList
        items={SMALL_ITEMS}
        selectedId="doc-3"
        onSelect={() => {}}
        labels={LABELS}
        testId={TEST_ID}
      />,
    );
    expect(scrolls()).toHaveLength(1);
    expect(scrolls()[0].target).toBe(buttonOf("doc-3"));
    expect(scrolls()[0].args).toEqual([
      { block: "nearest", inline: "nearest" },
    ]);

    // 상태만 바뀐 재렌더
    rerender(
      <DocumentList
        items={SMALL_ITEMS.map(item =>
          item.id === "doc-3" ? { ...item, status: "changed" } : item,
        )}
        selectedId="doc-3"
        onSelect={() => {}}
        labels={LABELS}
        testId={TEST_ID}
      />,
    );
    expect(scrolls()).toHaveLength(1);

    // 선택 해제
    rerender(
      <DocumentList
        items={SMALL_ITEMS}
        selectedId={null}
        onSelect={() => {}}
        labels={LABELS}
        testId={TEST_ID}
      />,
    );
    expect(scrolls()).toHaveLength(1);
  });

  it("호출자 속성(className·data-*)을 nav 루트에 전달한다", () => {
    render(
      <DocumentList
        items={SMALL_ITEMS}
        selectedId={null}
        onSelect={() => {}}
        labels={LABELS}
        testId={TEST_ID}
        className="extra"
        data-extra="yes"
      />,
    );
    const root = screen.getByTestId(TEST_ID);
    expect(root.tagName).toBe("NAV");
    expect(root).toHaveAttribute("aria-label", "문서 목록");
    expect(root).toHaveAttribute("data-extra", "yes");
    expect(root).toHaveClass("min-w-0", "extra");
  });

  it("루트 DOM 스냅샷", () => {
    render(
      <DocumentList
        items={SMALL_ITEMS}
        excluded={{ pageCount: 5 }}
        selectedId="doc-1"
        onSelect={() => {}}
        labels={LABELS}
        testId={TEST_ID}
        markerClassNames={{ warning: "host-warning-tone" }}
      />,
    );
    expect(snapshotHtml(screen.getByTestId(TEST_ID))).toMatchSnapshot();
  });
});

describe("DocumentList (가상, 행 > virtualizeAbove)", () => {
  const VIEWPORT_HEIGHT = 200; // rowHeight 40 → 5 행
  let restoreClientHeight: (() => void) | null = null;

  beforeEach(() => {
    // jsdom 은 레이아웃이 없어 clientHeight 가 0 이다. 윈도잉 창만 높이를 고정한다.
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return this.dataset.testid === `${TEST_ID}-viewport`
          ? VIEWPORT_HEIGHT
          : 0;
      },
    });
    // HTMLElement.prototype 에 둔 정의만 지우면 Element.prototype 의 원래 getter 로 돌아간다.
    restoreClientHeight = () => {
      delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
    };
  });

  afterEach(() => {
    restoreClientHeight?.();
    restoreClientHeight = null;
  });

  function viewport() {
    return screen.getByTestId(`${TEST_ID}-viewport`);
  }

  function renderedIds() {
    return selectButtons().map(button =>
      button.getAttribute("data-document-id"),
    );
  }

  it("101 행부터 가상 목록이 되고 창 범위(보이는 5 + 1 행 + 아래 여유 5 행)만 그리고 나머지는 스페이서로 채운다", () => {
    const items = manyItems(150);
    render(
      <DocumentList
        items={items}
        selectedId={null}
        onSelect={() => {}}
        labels={LABELS}
        testId={TEST_ID}
      />,
    );

    expect(renderedIds()).toEqual(
      Array.from({ length: 11 }, (_, i) => `doc-${i + 1}`),
    );
    const list = viewport();
    expect(list.style.maxHeight).toBe("60vh");
    const top = list.firstElementChild as HTMLElement;
    const bottom = list.lastElementChild as HTMLElement;
    expect(top.style.height).toBe("0px");
    expect(bottom.style.height).toBe(`${(150 - 11) * 40}px`);
    expect(buttonOf("doc-1").closest("li")!.style.height).toBe("40px");
    // 창 높이 측정에 ResizeObserver 를 붙인다
    expect(
      domStubCalls.some(
        call => call.api === "ResizeObserver.observe" && call.args[0] === list,
      ),
    ).toBe(true);
  });

  it("100 행까지는 가상 목록이 아니다(virtualizeAbove 기본 100, 머리·제외 행 포함해 센다)", () => {
    const { rerender } = render(
      <DocumentList
        items={manyItems(100)}
        selectedId={null}
        onSelect={() => {}}
        labels={LABELS}
        testId={TEST_ID}
      />,
    );
    expect(screen.queryByTestId(`${TEST_ID}-viewport`)).toBeNull();
    expect(selectButtons()).toHaveLength(100);

    rerender(
      <DocumentList
        items={manyItems(100)}
        excluded={{ pageCount: 1 }}
        selectedId={null}
        onSelect={() => {}}
        labels={LABELS}
        testId={TEST_ID}
      />,
    );
    expect(viewport()).toBeInTheDocument();
  });

  it("스크롤하면 다음 프레임에 창 범위를 다시 계산한다", async () => {
    render(
      <DocumentList
        items={manyItems(150)}
        selectedId={null}
        onSelect={() => {}}
        labels={LABELS}
        testId={TEST_ID}
      />,
    );

    const list = viewport();
    list.scrollTop = 40 * 50; // 51 번째 행이 맨 위
    fireEvent.scroll(list);
    // 같은 프레임 안에서는 아직 그대로다
    expect(renderedIds()[0]).toBe("doc-1");
    await flushFrame();

    expect(renderedIds()).toEqual(
      Array.from({ length: 16 }, (_, i) => `doc-${i + 46}`),
    );
    expect((list.firstElementChild as HTMLElement).style.height).toBe(
      `${45 * 40}px`,
    );
  });

  it("처음 붙을 때 창 밖의 선택 행이 보이도록 창의 scrollTop 을 옮긴다(scrollIntoView 는 쓰지 않는다)", () => {
    render(
      <DocumentList
        items={manyItems(150)}
        selectedId="doc-80"
        onSelect={() => {}}
        labels={LABELS}
        testId={TEST_ID}
      />,
    );

    // 80 번째 행(index 79)의 아래를 창 아래에 맞춘다: 80*40 - 200
    expect(viewport().scrollTop).toBe(80 * 40 - VIEWPORT_HEIGHT);
    expect(buttonOf("doc-80")).toHaveAttribute("aria-current", "true");
    expect(
      domStubCalls.filter(call => call.api === "scrollIntoView"),
    ).toHaveLength(0);
  });

  it("선택이 위로 벗어난 행으로 바뀌면 행 위를 창 위에 맞추고, 이미 보이는 행이면 옮기지 않는다", () => {
    const items = manyItems(150);
    const { rerender } = render(
      <DocumentList
        items={items}
        selectedId="doc-80"
        onSelect={() => {}}
        labels={LABELS}
        testId={TEST_ID}
      />,
    );
    const list = viewport();
    expect(list.scrollTop).toBe(3000);

    rerender(
      <DocumentList
        items={items}
        selectedId="doc-10"
        onSelect={() => {}}
        labels={LABELS}
        testId={TEST_ID}
      />,
    );
    expect(list.scrollTop).toBe(9 * 40);
    expect(renderedIds()).toContain("doc-10");

    rerender(
      <DocumentList
        items={items}
        selectedId="doc-12"
        onSelect={() => {}}
        labels={LABELS}
        testId={TEST_ID}
      />,
    );
    expect(list.scrollTop).toBe(9 * 40);
  });

  it("선택 행을 포커스한 채 창을 스크롤해 그 행이 창 범위 밖으로 나가면 행이 언마운트되어 포커스가 body 로 빠진다(되돌아와도 포커스는 복구되지 않는다)", async () => {
    const items = manyItems(150);
    render(
      <DocumentList
        items={items}
        selectedId="doc-3"
        onSelect={() => {}}
        labels={LABELS}
        testId={TEST_ID}
      />,
    );

    buttonOf("doc-3").focus();
    expect(document.activeElement).toBe(buttonOf("doc-3"));

    const list = viewport();
    list.scrollTop = 40 * 100;
    fireEvent.scroll(list);
    await flushFrame();

    expect(renderedIds()).not.toContain("doc-3");
    await waitFor(() => expect(document.activeElement).toBe(document.body));

    // 다시 위로 스크롤해 행이 다시 그려져도 새 요소라 포커스는 돌아오지 않는다
    list.scrollTop = 0;
    fireEvent.scroll(list);
    await flushFrame();
    expect(renderedIds()).toContain("doc-3");
    expect(document.activeElement).toBe(document.body);
  });

  it("창 안에서 스크롤해 포커스 행이 여유 행(overscan) 범위에 남아 있으면 포커스가 그대로다", async () => {
    render(
      <DocumentList
        items={manyItems(150)}
        selectedId="doc-3"
        onSelect={() => {}}
        labels={LABELS}
        testId={TEST_ID}
      />,
    );
    const focused = buttonOf("doc-3");
    focused.focus();

    const list = viewport();
    list.scrollTop = 40 * 6; // 첫 행 index 6 → 그리는 범위 index 1..
    fireEvent.scroll(list);
    await flushFrame();

    expect(renderedIds()[0]).toBe("doc-2");
    expect(document.activeElement).toBe(focused);
  });

  it("가상 목록에서는 머리 행도 rowHeight 높이 행으로 그린다", () => {
    const items = manyItems(120).map((item, index) => ({
      ...item,
      groupLabel: index < 2 ? "앞 묶음" : "뒤 묶음",
    }));
    render(
      <DocumentList
        items={items}
        selectedId={null}
        onSelect={() => {}}
        labels={LABELS}
        testId={TEST_ID}
        rowHeight={32}
        maxHeight="400px"
      />,
    );
    const header = screen.getAllByTestId(`${TEST_ID}-group-header`)[0];
    expect(header.style.height).toBe("32px");
    expect(header).toHaveClass("truncate", "whitespace-nowrap");
    expect(viewport().style.maxHeight).toBe("400px");
  });

  it("루트 DOM 스냅샷", () => {
    const items = manyItems(110).map((item, index) => ({
      ...item,
      groupLabel: index < 3 ? "앞 묶음" : "뒤 묶음",
      status: index === 4 ? ("changed" as const) : undefined,
      visited: index === 5 ? false : undefined,
    }));
    render(
      <DocumentList
        items={items}
        excluded={{ pageCount: 2 }}
        selectedId="doc-4"
        onSelect={() => {}}
        labels={LABELS}
        testId={TEST_ID}
      />,
    );
    expect(snapshotHtml(screen.getByTestId(TEST_ID))).toMatchSnapshot();
  });
});

/**
 * Studio UI Kit item 문서의 "DOM 계약" 중 `document-list` 행. `data-document-id`·`data-marker` 는 위 테스트가
 * 값까지 본다(`buttonOf`, "표식 이름은 sr-only …"). 여기서는 표에 있는 속성이 모두 그려지는지와
 * 따로 단언이 없던 `data-flag` 를 본다.
 */
const DOM_CONTRACT = [
  { attribute: "data-document-id", on: "행 버튼(`-button-select`)" },
  { attribute: "data-marker", on: "표식" },
  { attribute: "data-flag", on: "판정·상태 표식 묶음" },
] as const;

describe("DocumentList DOM 계약", () => {
  function renderSmall() {
    return render(
      <DocumentList
        items={SMALL_ITEMS}
        selectedId={null}
        onSelect={() => {}}
        labels={LABELS}
        testId={TEST_ID}
      />,
    );
  }

  it.each(DOM_CONTRACT)("$attribute 가 $on 에 붙는다", ({ attribute }) => {
    const { container } = renderSmall();
    expect(container.querySelector(`[${attribute}]`)).not.toBeNull();
  });

  it("data-flag 는 표식 묶음에 판정 값으로 붙고, 판정이 없으면 속성이 없다", () => {
    renderSmall();
    const flagOf = (id: string) => {
      const group = buttonOf(id).querySelector("[data-marker]")?.parentElement;
      return group ? group.getAttribute("data-flag") : undefined;
    };
    expect(flagOf("doc-1")).toBe("danger");
    expect(flagOf("doc-3")).toBe("warning");
    // 상태 표식만 있는 행: 묶음은 있지만 data-flag 는 없다.
    expect(flagOf("doc-4")).toBeNull();
    expect(
      Array.from(document.querySelectorAll("[data-flag]")).map(el => [
        el.closest("[data-document-id]")?.getAttribute("data-document-id"),
        el.getAttribute("data-flag"),
      ]),
    ).toEqual([
      ["doc-1", "danger"],
      ["doc-3", "warning"],
    ]);
  });
});
