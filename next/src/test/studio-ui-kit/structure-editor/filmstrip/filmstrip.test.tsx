import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createRef } from "react";
import { snapshotHtml } from "../../../dom-snapshot";
import {
  Filmstrip,
  type FilmstripLabels,
  type FilmstripProps,
} from "@/components/studio-ui-kit/structure-editor/filmstrip/filmstrip";
import { structureEditPairsFor } from "@/components/studio-ui-kit/structure-editor/shared/pairs";
import type {
  StructureDocument,
  StructureLoosePage,
  StructureMenuButtons,
  StructurePage,
} from "@/components/studio-ui-kit/structure-editor/shared/types";

const TEST_ID = "fs";

/** 보조 키 없이 누른 썸네일 클릭의 `modifiers`. */
const NO_KEYS = { shift: false, toggle: false };

const labels: FilmstripLabels = {
  region: "필름스트립",
  document: index => `문서 ${index}`,
  untitled: "라벨 없음",
  label: "라벨",
  noLabel: "(라벨 없음)",
  notInConfigOption: label => `${label} (설정에 없음)`,
  notInConfigBadge: "설정에 없음",
  notInConfigHint: "설정에 없는 라벨",
  pageCount: count => `${count}쪽`,
  page: page => `${page.fileRef} p${page.page}`,
  noImage: "이미지 없음",
  pageMenu: page => `${page.fileRef} p${page.page} 메뉴`,
  movePageEarlier: "왼쪽으로",
  movePageLater: "오른쪽으로",
  moveToDocument: "다른 문서로",
  documentOption: (index, label) => `문서 ${index} · ${label ?? "-"}`,
  noOtherDocument: "옮길 문서 없음",
  excludePage: "페이지 제외",
  restorePage: "문서로 되돌리기",
  splitAfter: page => `p${page.page} 뒤에서 나누기`,
  documentMenu: index => `문서 ${index} 메뉴`,
  dragDocument: "문서 끌기",
  mergeWithPrevious: "앞 문서와 합치기",
  moveDocumentEarlier: "앞으로",
  moveDocumentLater: "뒤로",
  excluded: "제외",
  excludedEmpty: "제외한 페이지 없음",
  unplaced: "빠진 페이지",
  missing: "빈 자리",
  overlap: "겹침",
  dropRejected: "다른 그룹",
  dropRejectedLocked: "잠긴 문서",
  groupBoundary: "그룹 경계",
  documentExclusion: {
    exclude: "문서 제외",
    restore: "문서 복귀",
    badge: "제외됨",
  },
  restoreToNewDocument: "새 문서로",
  unplacedMenu: page => `${page.fileRef} p${page.page} 빠진 페이지 메뉴`,
  neighborhood: {
    collapsedPages: count => `…${count}쪽`,
    focusDocument: index => `문서 ${index} 펼치기`,
    hiddenBefore: count => `앞 문서 ${count}개`,
    hiddenAfter: count => `뒤 문서 ${count}개`,
    expand: "펼치기",
    collapse: "접기",
  },
  moveDocumentTo: "위치 지정…",
};

function page(
  key: string,
  overrides: Partial<StructurePage> = {},
): StructurePage {
  return {
    key,
    fileRef: "a.pdf",
    page: Number(key.replace(/\D/g, "")) || 1,
    thumbnailUrl: null,
    ...overrides,
  };
}

function pages(prefix: string, count: number): StructurePage[] {
  return Array.from({ length: count }, (_, i) => page(`${prefix}${i + 1}`));
}

/** 콜백 호출을 이름과 인자로 쌓는다. */
function callbackLog() {
  const calls: [string, ...unknown[]][] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  const callbacks = {
    onReorderPage: record("onReorderPage"),
    onMovePage: record("onMovePage"),
    onSplit: record("onSplit"),
    onMergeInto: record("onMergeInto"),
    onReorderDocument: record("onReorderDocument"),
    onExcludePage: record("onExcludePage"),
    onRestorePage: record("onRestorePage"),
    onLabelChange: record("onLabelChange"),
    onExcludeDocument: record("onExcludeDocument"),
    onRestoreDocument: record("onRestoreDocument"),
    onRestoreToNewDocument: record("onRestoreToNewDocument"),
    onThumbnailClick: record("onThumbnailClick"),
    onFocusDocument: record("onFocusDocument"),
    onRequestDocumentPosition: record("onRequestDocumentPosition"),
  };
  return { calls, callbacks };
}

const STRIPS: StructureDocument[] = [
  {
    documentId: "d1",
    label: "invoice",
    labelChoices: ["invoice", "receipt"],
    groupId: "g1",
    pages: [
      page("p1", { thumbnailUrl: "/img/p1.png" }),
      page("p2", { issue: "overlap" }),
      page("p3"),
    ],
  },
  {
    documentId: "d2",
    label: null,
    groupId: "g1",
    pages: [page("p4"), page("p5", { issue: "missing" })],
  },
  {
    documentId: "d3",
    label: "memo",
    labelNotInConfig: true,
    groupId: "g1",
    excluded: true,
    pages: [page("p6")],
  },
  {
    documentId: "d4",
    label: "other",
    groupId: "g2",
    locked: true,
    pages: [page("p7", { fileRef: "b.pdf" })],
  },
];

const EXCLUDED: StructureLoosePage[] = [
  { ...page("p8"), groupId: "g1" },
  { ...page("p9", { fileRef: "b.pdf" }), groupId: "g2" },
];

const UNPLACED: StructureLoosePage[] = [{ ...page("p10"), groupId: "g1" }];

function renderFilmstrip(overrides: Partial<FilmstripProps> = {}) {
  const log = callbackLog();
  const props: FilmstripProps = {
    documents: STRIPS,
    excluded: EXCLUDED,
    unplaced: UNPLACED,
    groupBoundariesAfter: [2],
    selectedPage: { documentId: "d1", pageKey: "p2" },
    labels,
    labelMaxLength: 40,
    testId: TEST_ID,
    ...log.callbacks,
    ...overrides,
  };
  const result = render(<Filmstrip {...props} />);
  return { ...result, calls: log.calls, props };
}

function stripSection(index: number): HTMLElement {
  return screen.getByRole("region", { name: `문서 ${index}` });
}

/** Radix 메뉴를 키보드로 연다(jsdom 에서 pointer 로 여는 것보다 안정적이다). */
function openMenu(trigger: HTMLElement): HTMLElement {
  fireEvent.keyDown(trigger, { key: "Enter" });
  return screen.getByRole("menu");
}

function menuItemTexts(menu: HTMLElement): [string, boolean][] {
  return within(menu)
    .getAllByRole("menuitem")
    .map(item => [
      item.textContent ?? "",
      item.getAttribute("aria-disabled") === "true",
    ]);
}

function openSubMenu(trigger: HTMLElement): HTMLElement {
  fireEvent.keyDown(trigger, { key: "ArrowRight" });
  const menus = screen.getAllByRole("menu");
  return menus[menus.length - 1]!;
}

/** jsdom 에 없는 `DataTransfer` 의 최소 stub. 끌기 시작 때 넣은 형식만 `types` 에 남긴다. */
function dataTransferStub() {
  const data = new Map<string, string>();
  return {
    types: [] as string[],
    effectAllowed: "none",
    dropEffect: "none",
    setData(type: string, value: string) {
      if (!data.has(type)) this.types.push(type);
      data.set(type, value);
    },
    getData(type: string) {
      return data.get(type) ?? "";
    },
  };
}

describe("Filmstrip — 띠(문서) 메뉴", () => {
  it("가운데 문서: 합치기·앞으로·뒤로·위치 지정·문서 제외 순서, 모두 활성", () => {
    const { calls } = renderFilmstrip();
    const menu = openMenu(
      within(stripSection(2)).getByRole("button", { name: "문서 2 메뉴" }),
    );
    expect(menuItemTexts(menu)).toEqual([
      ["앞 문서와 합치기", false],
      ["앞으로", false],
      ["뒤로", false],
      ["위치 지정…", false],
      ["문서 제외", false],
    ]);
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map(item => item.getAttribute("data-testid")),
    ).toEqual([
      "fs-strip-menu-merge",
      "fs-strip-menu-earlier",
      "fs-strip-menu-later",
      "fs-strip-menu-position",
      "fs-strip-menu-exclude",
    ]);

    fireEvent.click(within(menu).getByText("앞 문서와 합치기"));
    expect(calls).toEqual([["onMergeInto", "d2", "d1"]]);
  });

  it("첫 문서는 합치기·앞으로가 비활성이다", () => {
    renderFilmstrip();
    const menu = openMenu(
      within(stripSection(1)).getByRole("button", { name: "문서 1 메뉴" }),
    );
    expect(menuItemTexts(menu)).toEqual([
      ["앞 문서와 합치기", true],
      ["앞으로", true],
      ["뒤로", false],
      ["위치 지정…", false],
      ["문서 제외", false],
    ]);
  });

  it("뒤 문서가 잠겨 있거나 다른 그룹이면 뒤로가 비활성이고, 제외 문서는 문서 복귀를 보인다", () => {
    const { calls } = renderFilmstrip();
    const menu = openMenu(
      within(stripSection(3)).getByRole("button", { name: "문서 3 메뉴" }),
    );
    expect(menuItemTexts(menu)).toEqual([
      ["앞 문서와 합치기", false],
      ["앞으로", false],
      ["뒤로", true],
      ["위치 지정…", false],
      ["문서 복귀", false],
    ]);
    fireEvent.click(within(menu).getByText("문서 복귀"));
    expect(calls).toEqual([["onRestoreDocument", "d3"]]);
  });

  it("앞으로·뒤로·위치 지정 콜백 인자", () => {
    const { calls } = renderFilmstrip();
    const trigger = within(stripSection(2)).getByRole("button", {
      name: "문서 2 메뉴",
    });
    fireEvent.click(within(openMenu(trigger)).getByText("앞으로"));
    fireEvent.click(within(openMenu(trigger)).getByText("뒤로"));
    fireEvent.click(within(openMenu(trigger)).getByText("위치 지정…"));
    fireEvent.click(within(openMenu(trigger)).getByText("문서 제외"));
    expect(calls).toEqual([
      ["onReorderDocument", "d2", 0],
      ["onReorderDocument", "d2", 2],
      ["onRequestDocumentPosition", "d2", 1],
      ["onExcludeDocument", "d2"],
    ]);
  });

  it("선택 콜백·문구가 없으면 위치 지정·제외 항목이 빠진다", () => {
    renderFilmstrip({
      onRequestDocumentPosition: undefined,
      onExcludeDocument: undefined,
    });
    const menu = openMenu(
      within(stripSection(2)).getByRole("button", { name: "문서 2 메뉴" }),
    );
    expect(menuItemTexts(menu).map(([text]) => text)).toEqual([
      "앞 문서와 합치기",
      "앞으로",
      "뒤로",
    ]);
  });

  it("잠긴 문서는 메뉴 버튼·라벨 입력·✂ 이 비활성이다", () => {
    renderFilmstrip();
    const locked = stripSection(4);
    expect(
      within(locked).getByRole("button", { name: "문서 4 메뉴" }),
    ).toBeDisabled();
    expect(
      within(locked).getByRole("textbox", { name: "라벨" }),
    ).toBeDisabled();
    expect(locked.querySelector("[data-filmstrip-page]")).toHaveAttribute(
      "draggable",
      "false",
    );
  });
});

describe("Filmstrip — 썸네일 메뉴", () => {
  it("펼친 띠는 왼쪽·오른쪽·다른 문서로·제외 4 항목, 끝에서 비활성", () => {
    const { calls } = renderFilmstrip();
    const trigger = within(stripSection(1)).getByRole("button", {
      name: "a.pdf p1 메뉴",
    });
    const menu = openMenu(trigger);
    expect(menuItemTexts(menu)).toEqual([
      ["왼쪽으로", true],
      ["오른쪽으로", false],
      ["다른 문서로", false],
      ["페이지 제외", false],
    ]);
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map(item => item.getAttribute("data-testid")),
    ).toEqual([
      "fs-page-menu-left",
      "fs-page-menu-right",
      "fs-page-menu-move",
      "fs-page-menu-exclude",
    ]);

    fireEvent.click(within(menu).getByText("오른쪽으로"));
    fireEvent.click(within(openMenu(trigger)).getByText("페이지 제외"));
    expect(calls).toEqual([
      ["onReorderPage", "d1", "p1", 1],
      ["onExcludePage", "d1", "p1"],
    ]);
  });

  it("마지막 페이지는 오른쪽으로가 비활성이다", () => {
    renderFilmstrip();
    const menu = openMenu(
      within(stripSection(1)).getByRole("button", { name: "a.pdf p3 메뉴" }),
    );
    expect(menuItemTexts(menu).slice(0, 2)).toEqual([
      ["왼쪽으로", false],
      ["오른쪽으로", true],
    ]);
  });

  it("다른 문서로 하위 메뉴는 같은 그룹·잠기지 않은 다른 문서만, 끝에 붙인다", () => {
    const { calls } = renderFilmstrip();
    const menu = openMenu(
      within(stripSection(1)).getByRole("button", { name: "a.pdf p1 메뉴" }),
    );
    const sub = openSubMenu(within(menu).getByText("다른 문서로"));
    expect(menuItemTexts(sub)).toEqual([
      ["문서 2 · -", false],
      ["문서 3 · memo", false],
    ]);
    expect(
      within(sub)
        .getAllByRole("menuitem")
        .every(
          item =>
            item.getAttribute("data-testid") === "fs-page-menu-move-select",
        ),
    ).toBe(true);
    fireEvent.click(within(sub).getByText("문서 3 · memo"));
    expect(calls).toEqual([["onMovePage", "d1", "p1", "d3", 1]]);
  });

  it("옮길 문서가 없으면 하위 메뉴에 비활성 안내 한 줄", () => {
    renderFilmstrip({
      documents: [STRIPS[0]!],
      groupBoundariesAfter: [],
    });
    const menu = openMenu(
      within(stripSection(1)).getByRole("button", { name: "a.pdf p1 메뉴" }),
    );
    const sub = openSubMenu(within(menu).getByText("다른 문서로"));
    expect(menuItemTexts(sub)).toEqual([["옮길 문서 없음", true]]);
  });

  it("✂ 는 앞 페이지 뒤에서 자른다", () => {
    const { calls } = renderFilmstrip();
    fireEvent.click(
      within(stripSection(1)).getByRole("button", { name: "p1 뒤에서 나누기" }),
    );
    expect(calls).toEqual([["onSplit", "d1", "p1"]]);
  });

  it("썸네일 클릭은 문서·페이지·띠 안 위치를 알린다", () => {
    const { calls } = renderFilmstrip();
    fireEvent.click(
      within(stripSection(1)).getByRole("button", { name: "a.pdf p3" }),
    );
    expect(calls).toEqual([["onThumbnailClick", "d1", "p3", 2, NO_KEYS]]);
  });

  it("썸네일 클릭은 보조 키(shift, ⌘ 또는 Ctrl)도 알린다", () => {
    const { calls } = renderFilmstrip();
    const strip = within(stripSection(1));
    fireEvent.click(strip.getByRole("button", { name: "a.pdf p1" }), {
      shiftKey: true,
    });
    fireEvent.click(strip.getByRole("button", { name: "a.pdf p3" }), {
      metaKey: true,
    });
    fireEvent.click(
      within(screen.getByTestId("fs-excluded")).getByRole("button", {
        name: "a.pdf p8",
      }),
      { ctrlKey: true },
    );
    expect(calls).toEqual([
      ["onThumbnailClick", "d1", "p1", 0, { shift: true, toggle: false }],
      ["onThumbnailClick", "d1", "p3", 2, { shift: false, toggle: true }],
      ["onThumbnailClick", null, "p8", 0, { shift: false, toggle: true }],
    ]);
  });

  it("선택·겹침·빈 자리 표시", () => {
    renderFilmstrip();
    const selected = within(stripSection(1)).getByRole("button", {
      name: "a.pdf p2 · 겹침",
    });
    expect(selected).toHaveAttribute("aria-current", "true");
    expect(selected).toHaveAttribute("title", "겹침");
    expect(
      within(stripSection(2)).getByRole("button", {
        name: "a.pdf p5 · 빈 자리",
      }),
    ).not.toHaveAttribute("aria-current");
  });
});

describe("Filmstrip — 제외·빠진 페이지 띠", () => {
  it("제외 페이지 메뉴: 문서로 되돌리기(같은 그룹·잠기지 않은 문서) · 새 문서로", () => {
    const { calls } = renderFilmstrip();
    const lane = screen.getByTestId("fs-excluded");
    const trigger = within(lane).getByRole("button", { name: "a.pdf p8 메뉴" });
    const menu = openMenu(trigger);
    expect(menuItemTexts(menu)).toEqual([
      ["문서로 되돌리기", false],
      ["새 문서로", false],
    ]);
    const sub = openSubMenu(within(menu).getByText("문서로 되돌리기"));
    expect(menuItemTexts(sub)).toEqual([
      ["문서 1 · invoice", false],
      ["문서 2 · -", false],
      ["문서 3 · memo", false],
    ]);
    fireEvent.click(within(sub).getByText("문서 2 · -"));
    fireEvent.click(within(openMenu(trigger)).getByText("새 문서로"));
    expect(calls).toEqual([
      ["onRestorePage", "p8", "d2", 2],
      ["onRestoreToNewDocument", "p8"],
    ]);
  });

  it("되돌릴 문서가 잠긴 문서뿐이면 비활성 안내, 새 문서로 콜백이 없으면 항목이 빠진다", () => {
    renderFilmstrip({ onRestoreToNewDocument: undefined });
    const lane = screen.getByTestId("fs-excluded");
    const menu = openMenu(
      within(lane).getByRole("button", { name: "b.pdf p9 메뉴" }),
    );
    expect(menuItemTexts(menu)).toEqual([["문서로 되돌리기", false]]);
    const sub = openSubMenu(within(menu).getByText("문서로 되돌리기"));
    expect(menuItemTexts(sub)).toEqual([["옮길 문서 없음", true]]);
  });

  it("제외 페이지 클릭은 documentId null 로 알린다", () => {
    const { calls } = renderFilmstrip();
    fireEvent.click(
      within(screen.getByTestId("fs-excluded")).getByRole("button", {
        name: "b.pdf p9",
      }),
    );
    expect(calls).toEqual([["onThumbnailClick", null, "p9", 1, NO_KEYS]]);
  });

  it("제외 띠가 비면 안내 문구", () => {
    renderFilmstrip({ excluded: [] });
    expect(screen.getByTestId("fs-excluded")).toHaveTextContent(
      "제외한 페이지 없음",
    );
  });

  it("빠진 페이지 메뉴는 새 문서로 한 항목", () => {
    const { calls } = renderFilmstrip();
    const trigger = screen.getByTestId("fs-unplaced-menu-open");
    expect(trigger).toHaveAccessibleName("a.pdf p10 빠진 페이지 메뉴");
    const menu = openMenu(trigger);
    expect(menuItemTexts(menu)).toEqual([["새 문서로", false]]);
    fireEvent.click(within(menu).getByTestId("fs-unplaced-menu-new-document"));
    expect(calls).toEqual([["onRestoreToNewDocument", "p10"]]);
  });

  it("새 문서로 콜백이 없으면 빠진 페이지는 메뉴 없는 칸이다", () => {
    renderFilmstrip({ onRestoreToNewDocument: undefined });
    expect(screen.queryByTestId("fs-unplaced-menu-open")).toBeNull();
    expect(screen.getByTestId("fs-unplaced")).toHaveTextContent("?");
  });

  it("빠진 페이지가 없으면 빠진 페이지 띠를 그리지 않는다", () => {
    renderFilmstrip({ unplaced: [] });
    expect(screen.queryByTestId("fs-unplaced")).toBeNull();
  });
});

describe("Filmstrip — 라벨", () => {
  it("설정 라벨이 있으면 select, 바꾸면 값을 알린다", () => {
    const { calls } = renderFilmstrip();
    const select = within(stripSection(1)).getByRole("combobox", {
      name: "라벨",
    });
    expect(select).toHaveValue("invoice");
    expect(
      within(select)
        .getAllByRole("option")
        .map(option => option.textContent),
    ).toEqual(["invoice", "receipt"]);
    fireEvent.change(select, { target: { value: "receipt" } });
    expect(calls).toEqual([["onLabelChange", "d1", "receipt"]]);
  });

  it("라벨이 없으면 '라벨 없음' 항목을, 설정에 없는 라벨이면 그 항목을 앞에 둔다", () => {
    const { calls } = renderFilmstrip({
      documents: [
        { ...STRIPS[0]!, label: null },
        { ...STRIPS[1]!, label: "legacy", labelChoices: ["invoice"] },
      ],
      groupBoundariesAfter: [],
    });
    const empty = within(stripSection(1)).getByRole("combobox");
    expect(
      within(empty)
        .getAllByRole("option")
        .map(option => option.textContent),
    ).toEqual(["(라벨 없음)", "invoice", "receipt"]);
    const outside = within(stripSection(2)).getByRole("combobox");
    expect(outside).toHaveValue("legacy");
    expect(
      within(outside)
        .getAllByRole("option")
        .map(option => option.textContent),
    ).toEqual(["legacy (설정에 없음)", "invoice"]);
    fireEvent.change(empty, { target: { value: "\u0000" } });
    fireEvent.change(empty, { target: { value: "invoice" } });
    expect(calls).toEqual([
      ["onLabelChange", "d1", null],
      ["onLabelChange", "d1", "invoice"],
    ]);
  });

  it("자유 입력은 포커스를 잃으면 확정한다(앞뒤 공백 제거)", () => {
    const { calls } = renderFilmstrip();
    const input = within(stripSection(2)).getByRole("textbox", {
      name: "라벨",
    });
    expect(input).toHaveAttribute("placeholder", "라벨 없음");
    expect(input).toHaveAttribute("maxLength", "40");
    fireEvent.change(input, { target: { value: "  receipt  " } });
    fireEvent.blur(input);
    expect(calls).toEqual([["onLabelChange", "d2", "receipt"]]);
    expect(input).toHaveValue("receipt");
  });

  it("Enter 로 확정하고, 같은 값이면 알리지 않는다", () => {
    const { calls } = renderFilmstrip();
    const input = within(stripSection(3)).getByRole("textbox", {
      name: "라벨",
    });
    fireEvent.change(input, { target: { value: " memo " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(calls).toEqual([]);
    expect(input).toHaveValue("memo");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(calls).toEqual([["onLabelChange", "d3", null]]);
  });

  it("Esc 는 입력을 지금 라벨로 되돌리고 알리지 않는다", () => {
    const { calls } = renderFilmstrip();
    const input = within(stripSection(3)).getByRole("textbox", {
      name: "라벨",
    });
    fireEvent.change(input, { target: { value: "draft" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue("memo");
    fireEvent.blur(input);
    expect(calls).toEqual([]);
  });

  it("언마운트 때 편집 중인 라벨을 확정하지 않는다", () => {
    const { calls, unmount } = renderFilmstrip();
    const input = within(stripSection(2)).getByRole("textbox", {
      name: "라벨",
    });
    input.focus();
    fireEvent.change(input, { target: { value: "unsaved" } });
    unmount();
    expect(calls).toEqual([]);
  });

  it("commitLabelOnUnmount 를 켜면 언마운트 때 편집 중인 라벨을 확정한다", () => {
    const { calls, unmount } = renderFilmstrip({ commitLabelOnUnmount: true });
    const input = within(stripSection(2)).getByRole("textbox", {
      name: "라벨",
    });
    input.focus();
    fireEvent.change(input, { target: { value: "unsaved" } });
    unmount();
    expect(calls).toEqual([["onLabelChange", "d2", "unsaved"]]);
  });

  it("라벨이 밖에서 바뀌면 편집 중인 내용을 새 값으로 다시 채운다", () => {
    const { rerender, props } = renderFilmstrip();
    const input = within(stripSection(2)).getByRole("textbox", {
      name: "라벨",
    });
    fireEvent.change(input, { target: { value: "draft" } });
    rerender(
      <Filmstrip
        {...props}
        documents={STRIPS.map(strip =>
          strip.documentId === "d2" ? { ...strip, label: "outside" } : strip,
        )}
      />,
    );
    expect(input).toHaveValue("outside");
  });

  it("설정에 없는 라벨·제외 문서 배지", () => {
    renderFilmstrip();
    const section = stripSection(3);
    expect(within(section).getByText("제외됨")).toBeInTheDocument();
    expect(within(section).getByText("설정에 없음")).toHaveAttribute(
      "title",
      "설정에 없는 라벨",
    );
  });
});

describe("Filmstrip — disabled", () => {
  it("편집 조작은 막고 썸네일 클릭은 그대로 받는다", () => {
    const { calls } = renderFilmstrip({ disabled: true });
    const first = stripSection(1);
    expect(
      within(first).getByRole("button", { name: "문서 1 메뉴" }),
    ).toBeDisabled();
    expect(
      within(first).getByRole("button", { name: "a.pdf p1 메뉴" }),
    ).toBeDisabled();
    expect(
      within(first).getByRole("button", { name: "p1 뒤에서 나누기" }),
    ).toBeDisabled();
    expect(within(first).getByRole("combobox")).toBeDisabled();
    expect(
      within(stripSection(2)).getByRole("textbox", { name: "라벨" }),
    ).toBeDisabled();
    expect(screen.getByTestId("fs-unplaced-menu-open")).toBeDisabled();
    for (const item of document.querySelectorAll("[data-filmstrip-page]")) {
      expect(item).toHaveAttribute("draggable", "false");
    }
    expect(within(first).getByTitle("문서 끌기")).toHaveAttribute(
      "draggable",
      "false",
    );

    fireEvent.click(within(first).getByRole("button", { name: "a.pdf p1" }));
    fireEvent.click(
      within(screen.getByTestId("fs-excluded")).getByRole("button", {
        name: "a.pdf p8",
      }),
    );
    expect(calls).toEqual([
      ["onThumbnailClick", "d1", "p1", 0, NO_KEYS],
      ["onThumbnailClick", null, "p8", 0, NO_KEYS],
    ]);
  });

  it("이웃 보기에서 제외·빠진 페이지 띠 접기·펼치기와 이웃 문서 펼치기는 그대로 동작한다", () => {
    const { calls } = renderFilmstrip({
      disabled: true,
      neighborhood: { focusDocumentId: "d2" },
    });
    fireEvent.click(screen.getByTestId("fs-excluded-expand"));
    expect(screen.getByTestId("fs-excluded-collapse")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("fs-excluded-collapse"));
    expect(screen.getByTestId("fs-excluded-expand")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("fs-unplaced-expand"));
    expect(screen.getByTestId("fs-unplaced-collapse")).toBeInTheDocument();
    fireEvent.click(
      within(stripSection(1)).getByRole("button", { name: "문서 1 펼치기" }),
    );
    expect(calls).toEqual([["onFocusDocument", "d1"]]);
  });
});

describe("Filmstrip — 이웃 보기", () => {
  const MANY: StructureDocument[] = [
    { documentId: "n1", label: null, groupId: "g", pages: pages("a", 2) },
    { documentId: "n2", label: null, groupId: "g", pages: pages("b", 5) },
    { documentId: "n3", label: "focus", groupId: "g", pages: pages("c", 20) },
    { documentId: "n4", label: null, groupId: "g", pages: pages("d", 5) },
    { documentId: "n5", label: null, groupId: "g", pages: pages("e", 1) },
    { documentId: "n6", label: null, groupId: "g", pages: pages("f", 1) },
  ];

  function renderNeighborhood(overrides: Partial<FilmstripProps> = {}) {
    return renderFilmstrip({
      documents: MANY,
      excluded: [{ ...page("x1"), groupId: "g" }],
      unplaced: [],
      groupBoundariesAfter: [],
      selectedPage: null,
      neighborhood: { focusDocumentId: "n3" },
      ...overrides,
    });
  }

  it("앞·뒤 이웃만 접어 그리고 숨은 문서 수를 보인다", () => {
    renderNeighborhood();
    expect(
      screen.getAllByRole("region").map(el => el.getAttribute("aria-label")),
    ).toEqual(["필름스트립", "문서 2", "문서 3", "문서 4", "제외"]);
    expect(screen.getByText("앞 문서 1개")).toBeInTheDocument();
    expect(screen.getByText("뒤 문서 2개")).toBeInTheDocument();
    expect(screen.getByTestId("fs-scroller")).toBeInTheDocument();
  });

  it("앞 이웃은 끝 3 쪽, 뒤 이웃은 앞 3 쪽과 숨은 쪽수 칩", () => {
    renderNeighborhood();
    const keys = (section: HTMLElement) =>
      Array.from(section.querySelectorAll("[data-filmstrip-page]")).map(el =>
        el.getAttribute("data-filmstrip-page"),
      );
    expect(keys(stripSection(2))).toEqual(["b3", "b4", "b5"]);
    expect(keys(stripSection(4))).toEqual(["d1", "d2", "d3"]);
    const chips = screen.getAllByTestId("fs-strip-collapsed-chip");
    expect(chips.map(chip => chip.textContent)).toEqual(["…2쪽", "…2쪽"]);
    // 접힌 띠에는 ✂ 이 없다.
    expect(
      within(stripSection(2)).queryAllByTestId("fs-split-button"),
    ).toHaveLength(0);
  });

  it("펼친 띠는 재지 못한 창에서 앞쪽 칸(8 + overscan 4)만 그리고 뒤는 스페이서다", () => {
    renderNeighborhood();
    const focus = stripSection(3);
    expect(focus.querySelectorAll("[data-filmstrip-page]")).toHaveLength(12);
    const items = focus.querySelectorAll("ol > li");
    const trail = items[items.length - 1] as HTMLElement;
    expect(trail).toHaveAttribute("aria-hidden", "true");
    expect(trail.style.width).toBe(`${8 * 88}px`);
  });

  it("접힌 이웃 띠의 썸네일 메뉴는 다른 문서로·제외 2 항목", () => {
    renderNeighborhood();
    const menu = openMenu(
      within(stripSection(2)).getByRole("button", { name: "a.pdf p3 메뉴" }),
    );
    expect(menuItemTexts(menu)).toEqual([
      ["다른 문서로", false],
      ["페이지 제외", false],
    ]);
  });

  it("펼친 띠의 썸네일 메뉴는 4 항목, 콜백 위치는 띠 전체 기준", () => {
    const { calls } = renderNeighborhood();
    const focus = stripSection(3);
    fireEvent.click(within(focus).getByRole("button", { name: "a.pdf p2" }));
    fireEvent.click(
      within(stripSection(4)).getByRole("button", { name: "a.pdf p1" }),
    );
    expect(calls).toEqual([
      ["onThumbnailClick", "n3", "c2", 1, NO_KEYS],
      ["onThumbnailClick", "n4", "d1", 0, NO_KEYS],
    ]);
    const menu = openMenu(
      within(focus).getByRole("button", { name: "a.pdf p2 메뉴" }),
    );
    expect(menuItemTexts(menu).map(([text]) => text)).toEqual([
      "왼쪽으로",
      "오른쪽으로",
      "다른 문서로",
      "페이지 제외",
    ]);
  });

  it("제외 띠는 접혀 개수 칩과 펼치기 버튼만 보인다", () => {
    renderNeighborhood();
    const lane = screen.getByTestId("fs-excluded");
    expect(lane).toHaveTextContent("1쪽");
    expect(lane.querySelector("[data-filmstrip-page]")).toBeNull();
    fireEvent.click(screen.getByTestId("fs-excluded-expand"));
    expect(lane.querySelector("[data-filmstrip-page]")).not.toBeNull();
  });

  it("빠진 페이지가 0 에서 생기면 빠진 페이지 띠를 펼친다", () => {
    const { rerender, props } = renderNeighborhood();
    expect(screen.queryByTestId("fs-unplaced")).toBeNull();
    rerender(
      <Filmstrip {...props} unplaced={[{ ...page("u1"), groupId: "g" }]} />,
    );
    expect(screen.getByTestId("fs-unplaced-collapse")).toBeInTheDocument();
  });

  it("처음부터 있던 빠진 페이지와 접은 뒤 늘어난 빠진 페이지는 띠를 펼치지 않는다", () => {
    const one = [{ ...page("u1"), groupId: "g" }];
    const two = [...one, { ...page("u2"), groupId: "g" }];
    const { rerender, props } = renderNeighborhood({ unplaced: one });
    expect(screen.getByTestId("fs-unplaced-expand")).toBeInTheDocument();
    rerender(<Filmstrip {...props} unplaced={two} />);
    expect(screen.getByTestId("fs-unplaced-expand")).toBeInTheDocument();
    rerender(<Filmstrip {...props} unplaced={[]} />);
    rerender(<Filmstrip {...props} unplaced={one} />);
    fireEvent.click(screen.getByTestId("fs-unplaced-collapse"));
    rerender(<Filmstrip {...props} unplaced={two} />);
    expect(screen.getByTestId("fs-unplaced-expand")).toBeInTheDocument();
  });

  it("선택 문서가 documents 에 없으면 전체 보기로 그린다", () => {
    renderNeighborhood({ neighborhood: { focusDocumentId: "missing" } });
    expect(screen.queryByTestId("fs-scroller")).toBeNull();
    expect(screen.getAllByRole("region")).toHaveLength(1 + MANY.length + 1);
  });

  it("이웃 보기 루트 DOM", () => {
    renderNeighborhood({ selectedPage: { documentId: "n3", pageKey: "c1" } });
    expect(snapshotHtml(screen.getByTestId(TEST_ID))).toMatchSnapshot();
  });
});

describe("Filmstrip — 끌기(drop 콜백 인자만)", () => {
  it("페이지를 같은 그룹 다른 띠 머리에 놓으면 그 문서 끝으로 옮긴다", () => {
    const { calls } = renderFilmstrip();
    const dataTransfer = dataTransferStub();
    const source = within(stripSection(1))
      .getByRole("button", { name: "a.pdf p1" })
      .closest("[data-filmstrip-page]")!;
    fireEvent.dragStart(source, { dataTransfer });
    expect(dataTransfer.types).toEqual([
      "application/x-review-filmstrip",
      "text/plain",
    ]);
    fireEvent.dragOver(stripSection(2), { dataTransfer });
    fireEvent.drop(stripSection(2), { dataTransfer });
    expect(calls).toEqual([["onMovePage", "d1", "p1", "d2", 2]]);
  });

  it("잠긴 문서 위에서는 거부 문구를 보이고 drop 해도 콜백이 없다", () => {
    const { calls } = renderFilmstrip();
    const dataTransfer = dataTransferStub();
    const source = within(stripSection(1))
      .getByRole("button", { name: "a.pdf p1" })
      .closest("[data-filmstrip-page]")!;
    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragOver(stripSection(4), { dataTransfer });
    expect(within(stripSection(4)).getByRole("status")).toHaveTextContent(
      "잠긴 문서",
    );
    fireEvent.drop(stripSection(4), { dataTransfer });
    expect(calls).toEqual([]);
    expect(within(stripSection(4)).queryByRole("status")).toBeNull();
  });

  it("페이지를 제외 띠에 놓으면 제외한다", () => {
    const { calls } = renderFilmstrip();
    const dataTransfer = dataTransferStub();
    const source = within(stripSection(2))
      .getByRole("button", { name: "a.pdf p4" })
      .closest("[data-filmstrip-page]")!;
    fireEvent.dragStart(source, { dataTransfer });
    const lane = screen.getByTestId("fs-excluded");
    fireEvent.dragOver(lane, { dataTransfer });
    fireEvent.drop(lane, { dataTransfer });
    expect(calls).toEqual([["onExcludePage", "d2", "p4"]]);
  });

  it("띠 머리를 같은 그룹 다른 띠에 놓으면 합친다", () => {
    const { calls } = renderFilmstrip();
    const dataTransfer = dataTransferStub();
    fireEvent.dragStart(within(stripSection(2)).getByTitle("문서 끌기"), {
      dataTransfer,
    });
    fireEvent.dragOver(stripSection(1), { dataTransfer });
    fireEvent.drop(stripSection(1), { dataTransfer });
    expect(calls).toEqual([["onMergeInto", "d2", "d1"]]);
  });

  it("필름스트립에서 시작하지 않은 drag 는 받지 않는다", () => {
    const { calls } = renderFilmstrip();
    const dataTransfer = dataTransferStub();
    dataTransfer.setData("Files", "");
    fireEvent.dragOver(stripSection(2), { dataTransfer });
    fireEvent.drop(stripSection(2), { dataTransfer });
    expect(calls).toEqual([]);
  });
});

describe("Filmstrip — 띠 메뉴 버튼 조회(menuButtonsRef)", () => {
  it("그려진 문서는 그 띠의 ⋯ 버튼, 없는 문서는 null", () => {
    const menuButtons = createRef<StructureMenuButtons>();
    renderFilmstrip({ menuButtonsRef: menuButtons });
    expect(menuButtons.current?.get("d2")).toBe(
      within(stripSection(2)).getByTestId("fs-strip-menu-open"),
    );
    // 잠긴 문서도 버튼은 그려져 있어 돌려준다(포커스 가능 여부는 host 가 본다).
    expect(menuButtons.current?.get("d4")).toBe(
      within(stripSection(4)).getByTestId("fs-strip-menu-open"),
    );
    expect(menuButtons.current?.get("missing")).toBeNull();
  });

  it("testId 가 없어도 찾는다", () => {
    const menuButtons = createRef<StructureMenuButtons>();
    renderFilmstrip({ menuButtonsRef: menuButtons, testId: undefined });
    expect(menuButtons.current?.get("d1")).toBe(
      within(stripSection(1)).getByRole("button", { name: "문서 1 메뉴" }),
    );
  });

  it("이웃 보기에서 그려지지 않은 문서는 null, 부를 때의 화면 기준으로 찾는다", () => {
    const MANY: StructureDocument[] = ["n1", "n2", "n3", "n4", "n5"].map(
      (documentId, i) => ({
        documentId,
        label: null,
        groupId: "g",
        pages: pages(`${documentId}-`, i === 2 ? 20 : 2),
      }),
    );
    const menuButtons = createRef<StructureMenuButtons>();
    const { rerender, props } = renderFilmstrip({
      documents: MANY,
      excluded: [],
      unplaced: [],
      groupBoundariesAfter: [],
      selectedPage: null,
      neighborhood: { focusDocumentId: "n3" },
      menuButtonsRef: menuButtons,
    });
    const lookup = menuButtons.current!;
    expect(lookup.get("n1")).toBeNull();
    expect(lookup.get("n2")).toBe(
      within(stripSection(2)).getByTestId("fs-strip-menu-open"),
    );
    rerender(<Filmstrip {...props} neighborhood={{ focusDocumentId: "n5" }} />);
    // 같은 조회 객체가 다시 그린 뒤의 화면을 본다.
    expect(menuButtons.current).toBe(lookup);
    expect(lookup.get("n2")).toBeNull();
    expect(lookup.get("n5")).toBe(
      within(stripSection(5)).getByTestId("fs-strip-menu-open"),
    );
  });

  it("띠가 사라지면 null", () => {
    const menuButtons = createRef<StructureMenuButtons>();
    const { rerender, props } = renderFilmstrip({
      menuButtonsRef: menuButtons,
    });
    expect(menuButtons.current?.get("d3")).not.toBeNull();
    rerender(
      <Filmstrip
        {...props}
        documents={STRIPS.filter(strip => strip.documentId !== "d3")}
      />,
    );
    expect(menuButtons.current?.get("d3")).toBeNull();
    expect(menuButtons.current?.get("d2")).toBe(
      within(stripSection(2)).getByTestId("fs-strip-menu-open"),
    );
  });
});

describe("Filmstrip — 루트 DOM", () => {
  it("전체 보기", () => {
    renderFilmstrip();
    expect(snapshotHtml(screen.getByTestId(TEST_ID))).toMatchSnapshot();
  });
});

/** 보기 문구만(편집 조작부 문구 없음). 읽기 전용으로 쓸 때 넘기는 최소 집합. */
const viewLabels: FilmstripLabels = {
  region: labels.region,
  document: labels.document,
  untitled: labels.untitled,
  notInConfigBadge: labels.notInConfigBadge,
  notInConfigHint: labels.notInConfigHint,
  pageCount: labels.pageCount,
  page: labels.page,
  noImage: labels.noImage,
  excluded: labels.excluded,
  excludedEmpty: labels.excludedEmpty,
  unplaced: labels.unplaced,
  missing: labels.missing,
  overlap: labels.overlap,
  groupBoundary: labels.groupBoundary,
};

/** 편집 조작부의 testid 접미. 읽기 전용이면 하나도 없어야 한다. */
const EDIT_TEST_IDS = [
  "fs-strip-menu-open",
  "fs-thumbnail-menu-open",
  "fs-split-button",
  "fs-label-select",
  "fs-label-input",
  "fs-unplaced-menu-open",
];

function expectNoEditControls(root: HTMLElement) {
  for (const testId of EDIT_TEST_IDS) {
    expect(within(root).queryAllByTestId(testId)).toEqual([]);
  }
  expect(root.querySelectorAll('[draggable="true"]')).toHaveLength(0);
  expect(within(root).queryByTitle("문서 끌기")).toBeNull();
}

/** 콜백 없이(필수 props 만) 그린다. */
function renderView(overrides: Partial<FilmstripProps> = {}) {
  const props: FilmstripProps = {
    documents: STRIPS,
    excluded: EXCLUDED,
    unplaced: UNPLACED,
    groupBoundariesAfter: [2],
    selectedPage: { documentId: "d1", pageKey: "p2" },
    labels: viewLabels,
    testId: TEST_ID,
    ...overrides,
  };
  return render(<Filmstrip {...props} />);
}

describe("Filmstrip — 읽기 전용·선택 콜백", () => {
  it("콜백 없이 그리면 끌기·✂·메뉴·라벨 편집이 없고 라벨은 글자로, 썸네일은 버튼이 아니다", () => {
    renderView();
    const root = screen.getByTestId(TEST_ID);
    expectNoEditControls(root);
    expect(within(root).queryAllByTestId("fs-thumbnail-select")).toEqual([]);
    expect(within(root).queryAllByRole("button")).toEqual([]);
    expect(within(stripSection(1)).getByText("invoice")).toBeInTheDocument();
    expect(within(stripSection(2)).getByText("라벨 없음")).toBeInTheDocument();
    // 보기 정보(이름·겹침·선택·배지·쪽수)는 그대로다.
    expect(
      within(stripSection(1)).getByRole("img", { name: "a.pdf p2 · 겹침" }),
    ).toHaveAttribute("aria-current", "true");
    expect(
      within(stripSection(3)).getByText("설정에 없음"),
    ).toBeInTheDocument();
    expect(within(stripSection(1)).getByText("3쪽")).toBeInTheDocument();
    expect(snapshotHtml(root)).toMatchSnapshot();
  });

  it("readOnly 면 콜백을 전부 넘겨도 편집 콜백이 없을 때와 DOM 이 같고, 썸네일 클릭은 그대로다", () => {
    const { calls, unmount } = renderFilmstrip({ readOnly: true });
    const readOnlyHtml = snapshotHtml(screen.getByTestId(TEST_ID));
    expectNoEditControls(screen.getByTestId(TEST_ID));
    fireEvent.click(
      within(stripSection(1)).getByRole("button", { name: "a.pdf p3" }),
    );
    fireEvent.click(
      within(screen.getByTestId("fs-excluded")).getByRole("button", {
        name: "a.pdf p8",
      }),
    );
    expect(calls).toEqual([
      ["onThumbnailClick", "d1", "p3", 2, NO_KEYS],
      ["onThumbnailClick", null, "p8", 0, NO_KEYS],
    ]);
    unmount();

    const viewOnly = callbackLog();
    renderFilmstrip({
      onReorderPage: undefined,
      onMovePage: undefined,
      onSplit: undefined,
      onMergeInto: undefined,
      onReorderDocument: undefined,
      onExcludePage: undefined,
      onRestorePage: undefined,
      onLabelChange: undefined,
      onExcludeDocument: undefined,
      onRestoreDocument: undefined,
      onRestoreToNewDocument: undefined,
      onRequestDocumentPosition: undefined,
      onThumbnailClick: viewOnly.callbacks.onThumbnailClick,
    });
    expect(snapshotHtml(screen.getByTestId(TEST_ID))).toBe(readOnlyHtml);
  });

  it("readOnly 를 끄고 콜백을 전부 넘기면 기본(readOnly 없음)과 DOM 이 같다", () => {
    const { unmount } = renderFilmstrip();
    const html = snapshotHtml(screen.getByTestId(TEST_ID));
    unmount();
    renderFilmstrip({ readOnly: false });
    expect(snapshotHtml(screen.getByTestId(TEST_ID))).toBe(html);
  });

  it("읽기 전용 이웃 보기: 이웃 띠 펼치기·제외 띠 접기는 동작한다", () => {
    const MANY: StructureDocument[] = ["n1", "n2", "n3", "n4", "n5"].map(
      (documentId, i) => ({
        documentId,
        label: null,
        groupId: "g",
        pages: pages(`${documentId}-`, i === 2 ? 20 : 2),
      }),
    );
    const { calls } = renderFilmstrip({
      documents: MANY,
      groupBoundariesAfter: [],
      selectedPage: null,
      neighborhood: { focusDocumentId: "n3" },
      readOnly: true,
    });
    expectNoEditControls(screen.getByTestId(TEST_ID));
    fireEvent.click(screen.getAllByTestId("fs-strip-focus")[0]!);
    expect(calls).toEqual([["onFocusDocument", "n2"]]);
    fireEvent.click(screen.getByTestId("fs-excluded-expand"));
    expect(screen.getByTestId("fs-excluded-collapse")).toBeInTheDocument();
  });

  it("onReorderPage 만 넘기면 썸네일 메뉴는 왼쪽·오른쪽, 띠 메뉴·✂·띠 끌기는 없다", () => {
    const { callbacks, calls } = callbackLog();
    renderView({
      labels,
      onReorderPage: callbacks.onReorderPage,
    });
    const strip = stripSection(1);
    expect(within(strip).queryByTestId("fs-strip-menu-open")).toBeNull();
    expect(within(strip).queryAllByTestId("fs-split-button")).toEqual([]);
    expect(within(strip).queryByTitle("문서 끌기")).toBeNull();
    expect(within(strip).queryByTestId("fs-label-select")).toBeNull();
    // 페이지는 끌 수 있다(같은 문서 안 순서).
    expect(
      strip.querySelectorAll('[data-filmstrip-page][draggable="true"]'),
    ).toHaveLength(3);
    const menu = openMenu(
      within(strip).getByRole("button", { name: "a.pdf p2 메뉴" }),
    );
    expect(menuItemTexts(menu)).toEqual([
      ["왼쪽으로", false],
      ["오른쪽으로", false],
    ]);
    fireEvent.click(within(menu).getByText("오른쪽으로"));
    expect(calls).toEqual([["onReorderPage", "d1", "p2", 2]]);
    // 제외 띠 페이지는 되돌릴 콜백이 없어 메뉴·끌기가 없다.
    const lane = screen.getByTestId("fs-excluded");
    expect(within(lane).queryAllByTestId("fs-thumbnail-menu-open")).toEqual([]);
    expect(lane.querySelectorAll('[draggable="true"]')).toHaveLength(0);
  });

  it("onReorderDocument 만 넘기면 띠 메뉴는 앞으로·뒤로, 띠 머리는 끌 수 있다", () => {
    const { callbacks, calls } = callbackLog();
    renderView({
      labels,
      onReorderDocument: callbacks.onReorderDocument,
    });
    const menu = openMenu(
      within(stripSection(2)).getByRole("button", { name: "문서 2 메뉴" }),
    );
    expect(menuItemTexts(menu)).toEqual([
      ["앞으로", false],
      ["뒤로", false],
    ]);
    fireEvent.click(within(menu).getByText("뒤로"));
    expect(calls).toEqual([["onReorderDocument", "d2", 2]]);
    expect(within(stripSection(2)).getByTitle("문서 끌기")).toHaveAttribute(
      "draggable",
      "true",
    );
    expect(screen.queryAllByTestId("fs-thumbnail-menu-open")).toEqual([]);
  });

  it("onRestorePage 만 넘기면 제외 페이지 메뉴는 문서로 되돌리기 하나", () => {
    const { callbacks } = callbackLog();
    renderView({ labels, onRestorePage: callbacks.onRestorePage });
    expect(
      within(stripSection(1)).queryAllByTestId("fs-thumbnail-menu-open"),
    ).toEqual([]);
    const lane = screen.getByTestId("fs-excluded");
    expect(lane.querySelectorAll('[draggable="true"]')).toHaveLength(2);
    const menu = openMenu(
      within(lane).getByRole("button", { name: "a.pdf p8 메뉴" }),
    );
    expect(menuItemTexts(menu)).toEqual([["문서로 되돌리기", false]]);
  });

  it("콜백이 있어도 짝 문구가 없으면 그 조작부를 그리지 않는다", () => {
    const { callbacks } = callbackLog();
    renderView({
      onSplit: callbacks.onSplit,
      onLabelChange: callbacks.onLabelChange,
      onMergeInto: callbacks.onMergeInto,
      onRestoreToNewDocument: callbacks.onRestoreToNewDocument,
    });
    expectNoEditControls(screen.getByTestId(TEST_ID));
  });

  it("onLabelChange 와 라벨 문구가 있으면 라벨 select·입력만 그린다", () => {
    const { callbacks, calls } = callbackLog();
    renderView({ labels, onLabelChange: callbacks.onLabelChange });
    fireEvent.change(within(stripSection(1)).getByTestId("fs-label-select"), {
      target: { value: "receipt" },
    });
    expect(calls).toEqual([["onLabelChange", "d1", "receipt"]]);
    expect(
      within(stripSection(2)).getByTestId("fs-label-input"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("fs-strip-menu-open")).toBeNull();
  });

  it("띠 메뉴 항목이 없으면 menuButtonsRef 는 null 을 돌려준다", () => {
    const menuButtons = createRef<StructureMenuButtons>();
    renderView({ menuButtonsRef: menuButtons });
    expect(menuButtons.current?.get("d1")).toBeNull();
  });

  it("onExcludePage 만 있으면 페이지를 다른 띠에 놓을 수 없고 제외 띠에만 놓는다", () => {
    const { callbacks, calls } = callbackLog();
    renderView({ labels, onExcludePage: callbacks.onExcludePage });
    const dataTransfer = dataTransferStub();
    const source = within(stripSection(1))
      .getByRole("img", { name: "a.pdf p1" })
      .closest("[data-filmstrip-page]")!;
    fireEvent.dragStart(source, { dataTransfer });
    expect(fireEvent.dragOver(stripSection(2), { dataTransfer })).toBe(true);
    fireEvent.drop(stripSection(2), { dataTransfer });
    expect(calls).toEqual([]);

    fireEvent.dragStart(source, { dataTransfer });
    const lane = screen.getByTestId("fs-excluded");
    // 받는 자리는 기본 동작을 막는다(`dispatchEvent` 가 false).
    expect(fireEvent.dragOver(lane, { dataTransfer })).toBe(false);
    fireEvent.drop(lane, { dataTransfer });
    expect(calls).toEqual([["onExcludePage", "d1", "p1"]]);
  });
});

describe("Filmstrip — 콜백 ↔ 문구 짝 표", () => {
  /** ⋯ 버튼이 있고 눌리면 메뉴를 열어 그 항목이 있는지 본다. */
  function menuHas(trigger: HTMLElement | null, itemTestId: string): boolean {
    if (!trigger || trigger.hasAttribute("disabled")) return false;
    return within(openMenu(trigger)).queryByTestId(itemTestId) !== null;
  }
  const pageMenu = (item: string) =>
    menuHas(
      within(stripSection(1)).queryByRole("button", { name: "a.pdf p2 메뉴" }),
      `fs-page-menu-${item}`,
    );
  const excludedMenu = (item: string) =>
    menuHas(
      within(screen.getByTestId("fs-excluded")).queryByRole("button", {
        name: "a.pdf p8 메뉴",
      }),
      `fs-page-menu-${item}`,
    );
  const stripMenu = (index: number, item: string) =>
    menuHas(
      within(stripSection(index)).queryByTestId("fs-strip-menu-open"),
      `fs-strip-menu-${item}`,
    );

  /** 짝 표 행 id → 그 조작부를 찾는 방법(필요하면 함께 넘길 props). */
  const PROBES: Record<
    string,
    { props?: Partial<FilmstripProps>; shown: () => boolean }
  > = {
    "page-earlier": { shown: () => pageMenu("left") },
    "page-later": { shown: () => pageMenu("right") },
    "page-move": { shown: () => pageMenu("move") },
    "page-exclude": { shown: () => pageMenu("exclude") },
    "split-button": {
      shown: () => screen.queryAllByTestId("fs-split-button").length > 0,
    },
    "excluded-restore": { shown: () => excludedMenu("restore") },
    "excluded-new-document": { shown: () => excludedMenu("new-document") },
    "unplaced-new-document": {
      shown: () =>
        menuHas(
          screen.queryByTestId("fs-unplaced-menu-open"),
          "fs-unplaced-menu-new-document",
        ),
    },
    "label-field": {
      shown: () =>
        screen.queryAllByTestId("fs-label-select").length +
          screen.queryAllByTestId("fs-label-input").length >
        0,
    },
    "document-merge": { shown: () => stripMenu(2, "merge") },
    "document-earlier": { shown: () => stripMenu(2, "earlier") },
    "document-later": { shown: () => stripMenu(2, "later") },
    "document-position": { shown: () => stripMenu(2, "position") },
    "document-exclude": { shown: () => stripMenu(2, "exclude") },
    "document-restore": { shown: () => stripMenu(3, "restore") },
    "drag-document": { shown: () => screen.queryAllByText("⠿").length > 0 },
    "neighborhood-focus": {
      props: { neighborhood: { focusDocumentId: "d2" } },
      shown: () => screen.queryAllByTestId("fs-strip-focus").length > 0,
    },
  };

  /** `keys` 를 `undefined` 로 덮은 사본. */
  function without<T extends object>(source: T, keys: readonly string[]): T {
    return {
      ...source,
      ...Object.fromEntries(keys.map(key => [key, undefined])),
    };
  }

  it("필름스트립에 해당하는 짝 표 행마다 찾는 방법이 있다", () => {
    expect(Object.keys(PROBES).sort()).toEqual(
      structureEditPairsFor("filmstrip")
        .map(pair => pair.id)
        .sort(),
    );
  });

  it("콜백 + 문구 → 있음 / 콜백만 → 없음 / 문구만 → 없음", () => {
    for (const pair of structureEditPairsFor("filmstrip")) {
      const probe = PROBES[pair.id]!;
      const cases: [string, Partial<FilmstripProps>, boolean][] = [
        ["콜백 + 문구", {}, true],
        ["콜백만", { labels: without(labels, pair.labels) }, false],
        ["문구만", without({}, pair.callbacks), false],
      ];
      for (const [name, overrides, expected] of cases) {
        renderFilmstrip({ ...probe.props, ...overrides });
        expect(probe.shown(), `${pair.id} · ${name}`).toBe(expected);
        cleanup();
      }
    }
  });

  it("빠진 페이지 메뉴: '새 문서로' 문구가 빈 문자열이면 메뉴 없는 칸이다", () => {
    renderFilmstrip({ labels: { ...labels, restoreToNewDocument: "" } });
    expect(screen.queryByTestId("fs-unplaced-menu-open")).toBeNull();
    expect(screen.getByTestId("fs-unplaced")).toHaveTextContent("?");
  });
});

/**
 * Studio UI Kit item 문서의 "DOM 계약" 중 `filmstrip` 행과 스모크가 읽는 testid 접미·HTML 속성. 썸네일
 * `draggable`·`aria-current` 의 조건별 값은 위 테스트들("잠긴 문서…", "readOnly…", "보는 페이지…")이 본다.
 */
const DOM_CONTRACT = [
  { selector: "[data-document-id]", on: "띠 `section`(제외·빠진 칸에는 없음)" },
  { selector: "[data-filmstrip-page]", on: "썸네일 뿌리(페이지 key)" },
  {
    selector: `[data-testid="${TEST_ID}-strip-pages"]`,
    on: "띠의 페이지 줄 `ol`",
  },
  { selector: `[data-testid="${TEST_ID}-strip-handle"]`, on: "띠 끌기 손잡이" },
] as const;

describe("Filmstrip DOM 계약", () => {
  it.each(DOM_CONTRACT)("$selector 가 $on 에 붙는다", ({ selector }) => {
    const { container } = renderFilmstrip();
    expect(container.querySelector(selector)).not.toBeNull();
  });

  it("data-document-id 는 띠 section 마다 문서 id 이고 제외·빠진 칸에는 없다", () => {
    const { container } = renderFilmstrip();
    const strips = Array.from(container.querySelectorAll("[data-document-id]"));
    expect(strips.map(el => el.tagName)).toEqual([
      "SECTION",
      "SECTION",
      "SECTION",
      "SECTION",
    ]);
    expect(strips.map(el => el.getAttribute("data-document-id"))).toEqual(
      STRIPS.map(strip => strip.documentId),
    );
    for (const lane of [`${TEST_ID}-excluded`, `${TEST_ID}-unplaced`]) {
      const element = screen.getByTestId(lane);
      expect(element).not.toHaveAttribute("data-document-id");
      expect(element.closest("[data-document-id]")).toBeNull();
    }
  });

  it("data-filmstrip-page 는 띠 안 썸네일 뿌리마다 페이지 key", () => {
    renderFilmstrip();
    expect(
      Array.from(stripSection(1).querySelectorAll("[data-filmstrip-page]")).map(
        el => el.getAttribute("data-filmstrip-page"),
      ),
    ).toEqual(["p1", "p2", "p3"]);
  });

  it("-strip-pages 는 띠마다 하나인 페이지 줄 ol, -strip-handle 은 띠마다 하나이고 잠긴 띠만 draggable=false", () => {
    renderFilmstrip();
    STRIPS.forEach((strip, index) => {
      const section = stripSection(index + 1);
      const lists = within(section).getAllByTestId(`${TEST_ID}-strip-pages`);
      expect(lists).toHaveLength(1);
      expect(lists[0]!.tagName).toBe("OL");
      expect(lists[0]!.querySelectorAll("[data-filmstrip-page]")).toHaveLength(
        strip.pages.length,
      );
      const handles = within(section).getAllByTestId(`${TEST_ID}-strip-handle`);
      expect(handles).toHaveLength(1);
      expect(handles[0]).toHaveAttribute(
        "draggable",
        strip.locked ? "false" : "true",
      );
    });
  });

  it("testId 가 없으면 -strip-pages·-strip-handle 도 없다", () => {
    const { container } = renderFilmstrip({ testId: undefined });
    expect(container.querySelectorAll("[data-testid]")).toHaveLength(0);
    expect(container.querySelectorAll("[data-document-id]")).toHaveLength(
      STRIPS.length,
    );
  });
});
