import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { snapshotHtml } from "../../../dom-snapshot";
import {
  PageGrid,
  type PageGridCallbacks,
  type PageGridLabels,
  type PageGridProps,
} from "@/components/studio-ui-kit/structure-editor/page-grid/page-grid";
import { structureEditPairsFor } from "@/components/studio-ui-kit/structure-editor/shared/pairs";
import type {
  StructureDocument,
  StructureLoosePage,
  StructureMenuButtons,
  StructurePage,
} from "@/components/studio-ui-kit/structure-editor/shared/types";

const LABELS: PageGridLabels = {
  region: "페이지 정리",
  document: i => `문서 ${i}`,
  untitled: "라벨 없음",
  label: "라벨",
  noLabel: "(라벨 없음)",
  notInConfigOption: v => `${v} (설정에 없음)`,
  notInConfigBadge: "설정에 없음",
  notInConfigHint: "설정에 없는 라벨",
  pageCount: n => `${n}쪽`,
  page: p => `${p.fileRef} p${p.page}`,
  noImage: "이미지 없음",
  pageMenu: p => `${p.fileRef} p${p.page} 메뉴`,
  movePageEarlier: "앞으로",
  movePageLater: "뒤로",
  moveToDocument: "다른 문서로",
  documentOption: (i, label) => `문서 ${i} · ${label ?? "-"}`,
  noOtherDocument: "옮길 문서 없음",
  splitBefore: p => `p${p.page} 앞에서 나누기`,
  excludePage: "페이지 제외",
  restorePage: "문서로 되돌리기",
  restoreToNewDocument: "새 문서로",
  documentMenu: i => `문서 ${i} 메뉴`,
  mergeWithPrevious: "앞 문서와 합치기",
  moveDocumentEarlier: "문서 앞으로",
  moveDocumentLater: "문서 뒤로",
  moveDocumentTo: "위치 지정…",
  documentExclusion: {
    exclude: "문서 제외",
    restore: "문서 복귀",
    badge: "제외됨",
  },
  excluded: "제외한 페이지",
  excludedEmpty: "제외한 페이지 없음",
  unplaced: "빠진 페이지",
  unplacedMenu: p => `빠진 ${p.fileRef} p${p.page} 메뉴`,
  missing: "빠진 페이지",
  overlap: "겹친 페이지",
  dropRejected: "다른 파일로는 옮길 수 없음",
  dropRejectedLocked: "잠긴 문서",
  multiDrag: {
    dragCount: n => `${n}장`,
    dragging: n => `${n}장을 함께 옮기는 중`,
  },
  groupBoundary: "파일 경계",
  sizeToggle: {
    size: "썸네일 크기",
    sizeSmall: "작게",
    sizeMedium: "크게",
  },
};

const page = (
  fileRef: string,
  n: number,
  extra: Partial<StructurePage> = {},
): StructurePage => ({
  key: `${fileRef}:${n}`,
  fileRef,
  page: n,
  thumbnailUrl: null,
  ...extra,
});

/**
 * a.pdf(g1): d1 자유 입력 3 쪽 · d2 select 2 쪽(설정에 없는 라벨) · d3 제외 문서 1 쪽.
 * b.pdf(g2): d4 잠김 1 쪽 · d5 1 쪽.
 */
const DOCUMENTS: readonly StructureDocument[] = [
  {
    documentId: "d1",
    label: "Invoice",
    groupId: "g1",
    pages: [
      page("a.pdf", 1, { thumbnailUrl: "https://example.test/a1.png" }),
      page("a.pdf", 2, { issue: "overlap" }),
      page("a.pdf", 3),
    ],
  },
  {
    documentId: "d2",
    label: "Other",
    labelChoices: ["Invoice", "Receipt"],
    labelNotInConfig: true,
    groupId: "g1",
    pages: [page("a.pdf", 4), page("a.pdf", 5, { issue: "missing" })],
  },
  {
    documentId: "d3",
    label: null,
    groupId: "g1",
    excluded: true,
    pages: [page("a.pdf", 6)],
  },
  {
    documentId: "d4",
    label: null,
    groupId: "g2",
    locked: true,
    pages: [page("b.pdf", 1)],
  },
  {
    documentId: "d5",
    label: null,
    groupId: "g2",
    pages: [page("b.pdf", 2)],
  },
];

const EXCLUDED: readonly StructureLoosePage[] = [
  { ...page("a.pdf", 7), groupId: "g1" },
];
const UNPLACED: readonly StructureLoosePage[] = [
  { ...page("b.pdf", 3), groupId: "g2" },
];

type Call = [name: string, ...args: unknown[]];

/** 콜백 호출을 배열에 쌓는 수동 stub. */
function recordingCallbacks() {
  const calls: Call[] = [];
  const rec =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  const callbacks: PageGridCallbacks &
    Pick<PageGridProps, "onRequestDocumentPosition"> = {
    onReorderPage: rec("onReorderPage"),
    onMovePage: rec("onMovePage"),
    onSplit: rec("onSplit"),
    onMergeInto: rec("onMergeInto"),
    onReorderDocument: rec("onReorderDocument"),
    onExcludePage: rec("onExcludePage"),
    onRestorePage: rec("onRestorePage"),
    onLabelChange: rec("onLabelChange"),
    onExcludeDocument: rec("onExcludeDocument"),
    onRestoreDocument: rec("onRestoreDocument"),
    onRestoreToNewDocument: rec("onRestoreToNewDocument"),
    onRequestDocumentPosition: rec("onRequestDocumentPosition"),
    onThumbnailClick: rec("onThumbnailClick"),
  };
  return { calls, callbacks };
}

function renderGrid(overrides: Partial<PageGridProps> = {}) {
  const { calls, callbacks } = recordingCallbacks();
  const props: PageGridProps = {
    documents: DOCUMENTS,
    excluded: EXCLUDED,
    unplaced: UNPLACED,
    groupBoundariesAfter: [2],
    labels: LABELS,
    testId: "grid",
    ...callbacks,
    ...overrides,
  };
  const result = render(<PageGrid {...props} />);
  return { ...result, calls, props };
}

/** 문서 머리(`data-document-id`) 행. */
function header(documentId: string): HTMLElement {
  const found = screen
    .getAllByTestId("grid-header")
    .find(el => el.getAttribute("data-document-id") === documentId);
  if (!found) throw new Error(`header ${documentId} not found`);
  return found;
}

/** 페이지 셀(`data-page-grid-page`). */
function cell(pageKey: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(
    `[data-page-grid-page="${CSS.escape(pageKey)}"]`,
  );
  if (!found) throw new Error(`cell ${pageKey} not found`);
  return found;
}

/** ⋯ 버튼으로 Radix 메뉴를 열고 열린 메뉴 요소를 돌려준다. */
async function openMenu(trigger: HTMLElement) {
  const user = userEvent.setup();
  await user.click(trigger);
  return { user, menu: await screen.findByRole("menu") };
}

/** 열린 메뉴의 항목: testid · 글자 · 비활성 여부(순서대로). */
function menuItems(menu: HTMLElement) {
  return Array.from(menu.querySelectorAll('[role^="menuitem"]')).map(item => ({
    testId: item.getAttribute("data-testid"),
    text: item.textContent,
    disabled: item.hasAttribute("data-disabled"),
  }));
}

describe("PageGrid", () => {
  it("문서 머리·셀·제외 칸·빠진 페이지 칸을 그린다(루트 DOM)", () => {
    const { container } = renderGrid({
      selectedPage: { documentId: "d1", pageKey: "a.pdf:2" },
    });
    expect(snapshotHtml(container.firstElementChild)).toMatchSnapshot();
  });

  it("머리 행: 문서 번호·라벨 필드 종류·배지·쪽수·그룹 경계", () => {
    renderGrid();
    expect(screen.getByRole("region", { name: "페이지 정리" })).toBeVisible();

    const d1 = header("d1");
    expect(within(d1).getByRole("heading")).toHaveTextContent("문서 1");
    expect(within(d1).getByTestId("grid-label-input")).toHaveValue("Invoice");
    expect(d1).toHaveTextContent("3쪽");

    const d2 = header("d2");
    const select = within(d2).getByTestId("grid-label-select");
    expect(select).toHaveValue("Other");
    expect(
      within(select)
        .getAllByRole("option")
        .map(o => o.textContent),
    ).toEqual(["Other (설정에 없음)", "Invoice", "Receipt"]);
    expect(within(d2).getByText("설정에 없음")).toHaveAttribute(
      "title",
      "설정에 없는 라벨",
    );

    expect(within(header("d3")).getByText("제외됨")).toBeInTheDocument();
    // 그룹 경계(index 2 뒤)는 d4 머리 위에만 있다.
    expect(
      within(header("d4")).getByRole("separator", { name: "파일 경계" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("separator")).toHaveLength(1);
    expect(screen.getByTestId("grid-excluded")).toHaveTextContent(
      "제외한 페이지1쪽",
    );
    expect(screen.getByTestId("grid-unplaced")).toHaveTextContent(
      "빠진 페이지1쪽",
    );
  });

  it("라벨 select 에서 고르면 라벨을, '라벨 없음' 을 고르면 null 을 보낸다", () => {
    const { calls, rerender, props } = renderGrid();
    fireEvent.change(screen.getByTestId("grid-label-select"), {
      target: { value: "Receipt" },
    });
    expect(calls).toEqual([["onLabelChange", "d2", "Receipt"]]);

    const unlabeled = DOCUMENTS.map(d =>
      d.documentId === "d2"
        ? { ...d, label: null, labelNotInConfig: false }
        : d,
    );
    rerender(<PageGrid {...props} documents={unlabeled} />);
    const select = screen.getByTestId("grid-label-select");
    expect(
      within(select)
        .getAllByRole("option")
        .map(o => o.textContent),
    ).toEqual(["(라벨 없음)", "Invoice", "Receipt"]);
    fireEvent.change(select, { target: { value: "Invoice" } });
    expect(calls.at(-1)).toEqual(["onLabelChange", "d2", "Invoice"]);
  });

  it("라벨 입력: Enter·포커스 이탈에 확정(앞뒤 공백 제거), 같은 값이면 보내지 않고 Esc 는 되돌린다", async () => {
    const user = userEvent.setup();
    const { calls } = renderGrid();
    const input = within(header("d1")).getByTestId("grid-label-input");

    await user.clear(input);
    await user.type(input, "  Receipt  {Enter}");
    expect(calls).toEqual([["onLabelChange", "d1", "Receipt"]]);
    expect(input).toHaveValue("Receipt");
    expect(input).toHaveFocus();

    await user.clear(input);
    await user.type(input, "Draft{Escape}");
    expect(input).toHaveValue("Invoice");
    await user.tab();
    expect(calls).toHaveLength(1);

    await user.clear(input);
    await user.type(input, " Invoice ");
    await user.tab();
    expect(calls).toHaveLength(1);
    expect(input).toHaveValue("Invoice");

    await user.clear(input);
    await user.tab();
    expect(calls.at(-1)).toEqual(["onLabelChange", "d1", null]);
  });

  it("라벨 입력 중에 언마운트되면 그 값을 확정한다", async () => {
    const user = userEvent.setup();
    const { calls, unmount } = renderGrid();
    const input = within(header("d1")).getByTestId("grid-label-input");
    await user.clear(input);
    await user.type(input, "Contract");
    expect(calls).toEqual([]);

    unmount();
    expect(calls).toEqual([["onLabelChange", "d1", "Contract"]]);
  });

  it("손대지 않았거나 disabled 면 언마운트 때 보내지 않는다", async () => {
    const user = userEvent.setup();
    const untouched = renderGrid();
    untouched.unmount();
    expect(untouched.calls).toEqual([]);

    const typed = renderGrid();
    const input = within(header("d1")).getByTestId("grid-label-input");
    await user.clear(input);
    await user.type(input, "Contract");
    typed.rerender(<PageGrid {...typed.props} disabled />);
    typed.unmount();
    expect(typed.calls).toEqual([]);
  });

  it("commitLabelOnUnmount 를 끄면 언마운트 때 확정하지 않는다", async () => {
    const user = userEvent.setup();
    const { calls, unmount } = renderGrid({ commitLabelOnUnmount: false });
    const input = within(header("d1")).getByTestId("grid-label-input");
    await user.clear(input);
    await user.type(input, "Contract");
    unmount();
    expect(calls).toEqual([]);
  });

  it("문서 머리 메뉴: 항목·순서·비활성 조건과 콜백", async () => {
    const { calls } = renderGrid();

    // d1: 앞 문서 없음 → 합치기·앞으로 비활성, 뒤 문서(d2) 같은 그룹 → 뒤로 가능.
    let opened = await openMenu(
      within(header("d1")).getByTestId("grid-header-menu-open"),
    );
    expect(menuItems(opened.menu)).toEqual([
      {
        testId: "grid-header-menu-merge",
        text: "앞 문서와 합치기",
        disabled: true,
      },
      {
        testId: "grid-header-menu-earlier",
        text: "문서 앞으로",
        disabled: true,
      },
      { testId: "grid-header-menu-later", text: "문서 뒤로", disabled: false },
      {
        testId: "grid-header-menu-position",
        text: "위치 지정…",
        disabled: false,
      },
      {
        testId: "grid-header-menu-exclude",
        text: "문서 제외",
        disabled: false,
      },
    ]);
    await opened.user.click(
      within(opened.menu).getByTestId("grid-header-menu-later"),
    );
    expect(calls).toEqual([["onReorderDocument", "d1", 1]]);

    // d3(제외 문서): 앞(d2) 같은 그룹, 뒤(d4) 다른 그룹·잠김 → 뒤로 비활성, 제외 대신 복귀.
    opened = await openMenu(
      within(header("d3")).getByTestId("grid-header-menu-open"),
    );
    expect(menuItems(opened.menu)).toEqual([
      {
        testId: "grid-header-menu-merge",
        text: "앞 문서와 합치기",
        disabled: false,
      },
      {
        testId: "grid-header-menu-earlier",
        text: "문서 앞으로",
        disabled: false,
      },
      { testId: "grid-header-menu-later", text: "문서 뒤로", disabled: true },
      {
        testId: "grid-header-menu-position",
        text: "위치 지정…",
        disabled: false,
      },
      {
        testId: "grid-header-menu-restore",
        text: "문서 복귀",
        disabled: false,
      },
    ]);
    await opened.user.click(
      within(opened.menu).getByTestId("grid-header-menu-merge"),
    );
    expect(calls.at(-1)).toEqual(["onMergeInto", "d3", "d2"]);

    opened = await openMenu(
      within(header("d3")).getByTestId("grid-header-menu-open"),
    );
    await opened.user.click(
      within(opened.menu).getByTestId("grid-header-menu-restore"),
    );
    expect(calls.at(-1)).toEqual(["onRestoreDocument", "d3"]);

    // d5: 앞 문서(d4)가 잠겨 합치기·앞으로 비활성, 뒤 문서 없음.
    opened = await openMenu(
      within(header("d5")).getByTestId("grid-header-menu-open"),
    );
    expect(menuItems(opened.menu).map(i => i.disabled)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
    await opened.user.click(
      within(opened.menu).getByTestId("grid-header-menu-position"),
    );
    expect(calls.at(-1)).toEqual(["onRequestDocumentPosition", "d5", 4]);
  });

  it("선택 콜백이 없으면 머리 메뉴에서 위치 지정·제외·복귀를 빼고, 잠긴 문서 머리는 막는다", async () => {
    renderGrid({
      onRequestDocumentPosition: undefined,
      onExcludeDocument: undefined,
    });
    const opened = await openMenu(
      within(header("d2")).getByTestId("grid-header-menu-open"),
    );
    expect(menuItems(opened.menu).map(i => i.testId)).toEqual([
      "grid-header-menu-merge",
      "grid-header-menu-earlier",
      "grid-header-menu-later",
    ]);

    const d4 = header("d4");
    expect(within(d4).getByTestId("grid-header-menu-open")).toBeDisabled();
    expect(within(d4).getByTestId("grid-label-input")).toBeDisabled();
  });

  it("문서 셀 메뉴 5 항목: 순서·비활성 조건과 콜백", async () => {
    const { calls } = renderGrid();

    let opened = await openMenu(
      within(cell("a.pdf:1")).getByTestId("grid-cell-menu-open"),
    );
    expect(menuItems(opened.menu)).toEqual([
      { testId: "grid-cell-menu-earlier", text: "앞으로", disabled: true },
      { testId: "grid-cell-menu-later", text: "뒤로", disabled: false },
      { testId: "grid-cell-menu-move", text: "다른 문서로", disabled: false },
      {
        testId: "grid-cell-menu-split",
        text: "p1 앞에서 나누기",
        disabled: true,
      },
      {
        testId: "grid-cell-menu-exclude",
        text: "페이지 제외",
        disabled: false,
      },
    ]);
    await opened.user.click(
      within(opened.menu).getByTestId("grid-cell-menu-later"),
    );
    expect(calls).toEqual([["onReorderPage", "d1", "a.pdf:1", 1]]);

    // 마지막 쪽: 뒤로 비활성, 나누기 가능.
    opened = await openMenu(
      within(cell("a.pdf:3")).getByTestId("grid-cell-menu-open"),
    );
    expect(menuItems(opened.menu).map(i => i.disabled)).toEqual([
      false,
      true,
      false,
      false,
      false,
    ]);
    await opened.user.click(
      within(opened.menu).getByTestId("grid-cell-menu-split"),
    );
    expect(calls.at(-1)).toEqual(["onSplit", "d1", "a.pdf:2"]);

    opened = await openMenu(
      within(cell("a.pdf:2")).getByTestId("grid-cell-menu-open"),
    );
    await opened.user.click(
      within(opened.menu).getByTestId("grid-cell-menu-exclude"),
    );
    expect(calls.at(-1)).toEqual(["onExcludePage", "d1", "a.pdf:2"]);
  });

  it("셀 메뉴 '다른 문서로' 는 같은 그룹의 잠기지 않은 다른 문서 끝으로 보낸다", async () => {
    const { calls } = renderGrid();
    const opened = await openMenu(
      within(cell("a.pdf:1")).getByTestId("grid-cell-menu-open"),
    );
    await opened.user.click(
      within(opened.menu).getByTestId("grid-cell-menu-move"),
    );
    const sub = (await screen.findAllByRole("menu")).at(-1)!;
    const targets = within(sub).getAllByTestId("grid-cell-menu-move-select");
    expect(targets.map(t => t.textContent)).toEqual([
      "문서 2 · Other",
      "문서 3 · -",
    ]);
    // 하위 메뉴 항목은 포인터 이동 없이 눌러야 하위 메뉴가 닫히지 않는다.
    fireEvent.click(targets[0]!);
    expect(calls).toEqual([["onMovePage", "d1", "a.pdf:1", "d2", 2]]);
  });

  it("같은 그룹에 옮길 문서가 없으면 하위 메뉴에 빈 안내만 보인다", async () => {
    renderGrid();
    const opened = await openMenu(
      within(cell("b.pdf:2")).getByTestId("grid-cell-menu-open"),
    );
    await opened.user.click(
      within(opened.menu).getByTestId("grid-cell-menu-move"),
    );
    const sub = (await screen.findAllByRole("menu")).at(-1)!;
    const only = within(sub).getByRole("menuitem");
    expect(only).toHaveTextContent("옮길 문서 없음");
    expect(only).toHaveAttribute("data-disabled");
  });

  it("제외 칸 셀 메뉴: 문서로 되돌리기 ▸ · 새 문서로", async () => {
    const { calls } = renderGrid();
    let opened = await openMenu(
      within(cell("a.pdf:7")).getByTestId("grid-cell-menu-open"),
    );
    expect(menuItems(opened.menu)).toEqual([
      {
        testId: "grid-cell-menu-restore",
        text: "문서로 되돌리기",
        disabled: false,
      },
      {
        testId: "grid-cell-menu-new-document",
        text: "새 문서로",
        disabled: false,
      },
    ]);
    await opened.user.click(
      within(opened.menu).getByTestId("grid-cell-menu-restore"),
    );
    const sub = (await screen.findAllByRole("menu")).at(-1)!;
    const targets = within(sub).getAllByTestId("grid-cell-menu-restore-select");
    expect(targets.map(t => t.textContent)).toEqual([
      "문서 1 · Invoice",
      "문서 2 · Other",
      "문서 3 · -",
    ]);
    fireEvent.click(targets[1]!);
    expect(calls).toEqual([["onRestorePage", "a.pdf:7", "d2", 2]]);

    opened = await openMenu(
      within(cell("a.pdf:7")).getByTestId("grid-cell-menu-open"),
    );
    await opened.user.click(
      within(opened.menu).getByTestId("grid-cell-menu-new-document"),
    );
    expect(calls.at(-1)).toEqual(["onRestoreToNewDocument", "a.pdf:7"]);
  });

  it("빠진 페이지 셀은 메뉴 '새 문서로' 만 있고, 콜백이 없으면 버튼이 비활성이다", async () => {
    const { calls, rerender, props } = renderGrid();
    const trigger = within(cell("b.pdf:3")).getByTestId(
      "grid-unplaced-menu-open",
    );
    expect(trigger).toHaveAccessibleName("빠진 b.pdf p3 메뉴");
    const opened = await openMenu(trigger);
    expect(menuItems(opened.menu)).toEqual([
      {
        testId: "grid-unplaced-menu-new-document",
        text: "새 문서로",
        disabled: false,
      },
    ]);
    await opened.user.click(
      within(opened.menu).getByTestId("grid-unplaced-menu-new-document"),
    );
    expect(calls).toEqual([["onRestoreToNewDocument", "b.pdf:3"]]);

    rerender(<PageGrid {...props} onRestoreToNewDocument={undefined} />);
    expect(
      within(cell("b.pdf:3")).getByTestId("grid-unplaced-menu-open"),
    ).toBeDisabled();
  });

  it("썸네일 클릭은 문서·페이지·위치·보조 키를 보내고, 제외 칸은 documentId null", async () => {
    const user = userEvent.setup();
    const { calls } = renderGrid();
    await user.click(within(cell("a.pdf:2")).getByTestId("grid-cell-select"));
    await user.keyboard("{Shift>}");
    await user.click(within(cell("a.pdf:3")).getByTestId("grid-cell-select"));
    await user.keyboard("{/Shift}{Control>}");
    await user.click(within(cell("a.pdf:4")).getByTestId("grid-cell-select"));
    await user.keyboard("{/Control}");
    await user.click(within(cell("a.pdf:7")).getByTestId("grid-cell-select"));
    expect(calls).toEqual([
      ["onThumbnailClick", "d1", "a.pdf:2", 1, { shift: false, toggle: false }],
      ["onThumbnailClick", "d1", "a.pdf:3", 2, { shift: true, toggle: false }],
      ["onThumbnailClick", "d2", "a.pdf:4", 0, { shift: false, toggle: true }],
      ["onThumbnailClick", null, "a.pdf:7", 0, { shift: false, toggle: false }],
    ]);
  });

  it("✂ 는 문서 셀의 첫 쪽이 아닐 때만 있고 앞 페이지 키로 나눈다", async () => {
    const user = userEvent.setup();
    const { calls } = renderGrid();
    expect(within(cell("a.pdf:1")).queryByTestId("grid-cell-split")).toBeNull();
    expect(within(cell("a.pdf:7")).queryByTestId("grid-cell-split")).toBeNull();
    expect(within(cell("b.pdf:1")).queryByTestId("grid-cell-split")).toBeNull();
    const split = within(cell("a.pdf:3")).getByTestId("grid-cell-split");
    expect(split).toHaveAttribute("tabindex", "-1");
    await user.click(split);
    expect(calls).toEqual([["onSplit", "d1", "a.pdf:2"]]);
  });

  it("셀 상태: 보는 페이지 aria-current, 이슈 이름, 이미지 유무", () => {
    renderGrid({ selectedPage: { documentId: "d1", pageKey: "a.pdf:3" } });
    const selected = within(cell("a.pdf:3")).getByTestId("grid-cell-select");
    expect(selected).toHaveAttribute("aria-current", "true");
    expect(
      within(cell("a.pdf:1")).getByTestId("grid-cell-select"),
    ).not.toHaveAttribute("aria-current");
    expect(
      within(cell("a.pdf:2")).getByTestId("grid-cell-select"),
    ).toHaveAccessibleName("a.pdf p2 · 겹친 페이지");
    expect(
      within(cell("a.pdf:5")).getByTestId("grid-cell-select"),
    ).toHaveAccessibleName("a.pdf p5 · 빠진 페이지");
    expect(cell("a.pdf:1").querySelector("img")).toHaveAttribute(
      "src",
      "https://example.test/a1.png",
    );
    expect(within(cell("a.pdf:3")).getByText("이미지 없음")).toBeVisible();
  });

  it("여러 장 선택: 문서 셀은 aria-pressed·data-selected·✓, 제외 칸 셀은 표시 없음", () => {
    renderGrid({
      multiSelected: new Set(["a.pdf:1", "a.pdf:4", "a.pdf:7"]),
    });
    const button = (key: string) =>
      within(cell(key)).getByTestId("grid-cell-select");

    expect(button("a.pdf:1")).toHaveAttribute("aria-pressed", "true");
    expect(button("a.pdf:1")).toHaveAttribute("data-selected", "true");
    expect(button("a.pdf:1")).toHaveClass("ring-2", "ring-primary");
    expect(within(button("a.pdf:1")).getByText("✓")).toBeInTheDocument();
    expect(button("a.pdf:4")).toHaveAttribute("data-selected", "true");

    expect(button("a.pdf:2")).toHaveAttribute("aria-pressed", "false");
    expect(button("a.pdf:2")).not.toHaveAttribute("data-selected");
    expect(within(button("a.pdf:2")).queryByText("✓")).toBeNull();

    // 제외 칸 셀은 고를 수 없다(선택에 들어 있어도 표시하지 않는다).
    expect(button("a.pdf:7")).not.toHaveAttribute("aria-pressed");
    expect(button("a.pdf:7")).not.toHaveAttribute("data-selected");
  });

  it("multiSelected 를 넘기지 않으면 aria-pressed 가 없다", () => {
    renderGrid();
    for (const el of screen.getAllByTestId("grid-cell-select")) {
      expect(el).not.toHaveAttribute("aria-pressed");
      expect(el).not.toHaveAttribute("data-selected");
    }
  });

  it("여러 장 선택(2 장 이상)과 onDropPages·labels.multiDrag 가 있으면 끌기 배지를 화면 밖에 둔다", () => {
    const { container } = renderGrid({
      multiSelected: new Set(["a.pdf:1", "a.pdf:2"]),
      onDropPages: () => {},
    });
    const ghost = container.firstElementChild!.querySelector<HTMLElement>(
      ':scope > [aria-hidden="true"]',
    );
    expect(ghost).toHaveTextContent("2장");
    expect(ghost).toHaveStyle({ position: "fixed", top: "-1000px" });
  });

  it("disabled: 메뉴·라벨·끌기·✂ 를 막고 썸네일 클릭은 그대로 보낸다", async () => {
    const user = userEvent.setup();
    const { calls, container } = renderGrid({ disabled: true });

    for (const el of screen.getAllByTestId("grid-header-menu-open")) {
      expect(el).toBeDisabled();
    }
    for (const el of screen.getAllByTestId("grid-cell-menu-open")) {
      expect(el).toBeDisabled();
    }
    expect(screen.getByTestId("grid-unplaced-menu-open")).toBeDisabled();
    expect(screen.getByTestId("grid-label-select")).toBeDisabled();
    for (const el of screen.getAllByTestId("grid-label-input")) {
      expect(el).toBeDisabled();
    }
    expect(screen.queryAllByTestId("grid-cell-split")).toHaveLength(0);
    for (const el of container.querySelectorAll("[data-page-grid-page]")) {
      if (el.hasAttribute("draggable")) {
        expect(el).toHaveAttribute("draggable", "false");
      }
    }

    await user.click(within(cell("a.pdf:2")).getByTestId("grid-cell-select"));
    expect(calls).toEqual([
      ["onThumbnailClick", "d1", "a.pdf:2", 1, { shift: false, toggle: false }],
    ]);
    expect(snapshotHtml(container.firstElementChild)).toMatchSnapshot();
  });

  it("잠긴 문서 셀은 끌 수 없고 메뉴가 막힌다(다른 문서는 그대로)", () => {
    renderGrid();
    expect(cell("b.pdf:1")).toHaveAttribute("draggable", "false");
    expect(
      within(cell("b.pdf:1")).getByTestId("grid-cell-menu-open"),
    ).toBeDisabled();
    expect(cell("b.pdf:2")).toHaveAttribute("draggable", "true");
    expect(
      within(cell("b.pdf:2")).getByTestId("grid-cell-menu-open"),
    ).toBeEnabled();
  });

  it("크기 토글은 onSizeChange 가 있을 때만 그리고 눌린 쪽이 aria-pressed", async () => {
    const user = userEvent.setup();
    const sizes: string[] = [];
    const first = renderGrid();
    expect(screen.queryByTestId("grid-size-s")).toBeNull();
    first.unmount();

    renderGrid({ size: "m", onSizeChange: s => sizes.push(s) });
    expect(screen.getByTestId("grid-size-s")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByTestId("grid-size-m")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("grid-size-s")).toHaveTextContent("S");
    await user.click(screen.getByTestId("grid-size-s"));
    expect(sizes).toEqual(["s"]);
  });

  it("빈 제외 칸은 안내 행을 그리고 빠진 페이지가 없으면 그 칸이 없다", () => {
    renderGrid({ excluded: [], unplaced: [] });
    expect(screen.getByTestId("grid-excluded")).toHaveTextContent(
      "제외한 페이지0쪽",
    );
    expect(screen.getByText("제외한 페이지 없음")).toBeInTheDocument();
    expect(screen.queryByTestId("grid-unplaced")).toBeNull();
  });

  it("끌어 놓기: 같은 문서 안 순서와 다른 문서로 옮기기(최소 DataTransfer stub)", () => {
    const { calls } = renderGrid();
    const store = new Map<string, string>();
    const dataTransfer = {
      types: [] as string[],
      effectAllowed: "all",
      dropEffect: "none",
      setData(type: string, value: string) {
        store.set(type, value);
        if (!this.types.includes(type)) this.types.push(type);
      },
      getData: (type: string) => store.get(type) ?? "",
      setDragImage: () => {},
    };

    // a.pdf:1 → d2 머리에 놓으면 d2 끝(index 2)으로.
    fireEvent.dragStart(cell("a.pdf:1"), { dataTransfer });
    fireEvent.dragOver(header("d2"), { dataTransfer });
    fireEvent.drop(header("d2"), { dataTransfer });
    expect(calls).toEqual([["onMovePage", "d1", "a.pdf:1", "d2", 2]]);

    // a.pdf:1 → 다른 그룹(d5) 머리: 거부 문구, drop 해도 콜백 없음.
    fireEvent.dragStart(cell("a.pdf:1"), { dataTransfer });
    fireEvent.dragOver(header("d5"), { dataTransfer });
    expect(screen.getByTestId("grid-drop-rejected")).toHaveTextContent(
      "다른 파일로는 옮길 수 없음",
    );
    fireEvent.drop(header("d5"), { dataTransfer });
    expect(calls).toHaveLength(1);
    expect(screen.getByTestId("grid-drop-rejected")).toHaveTextContent("");

    // a.pdf:2 → 제외 칸 머리.
    fireEvent.dragStart(cell("a.pdf:2"), { dataTransfer });
    fireEvent.dragOver(screen.getByTestId("grid-excluded"), { dataTransfer });
    fireEvent.drop(screen.getByTestId("grid-excluded"), { dataTransfer });
    expect(calls.at(-1)).toEqual(["onExcludePage", "d1", "a.pdf:2"]);
  });
});

describe("PageGrid — 머리 메뉴 버튼 조회(menuButtonsRef)", () => {
  it("그려진 문서는 그 머리의 ⋯ 버튼, 없는 문서는 null", () => {
    const menuButtons = createRef<StructureMenuButtons>();
    renderGrid({ menuButtonsRef: menuButtons });
    expect(menuButtons.current?.get("d2")).toBe(
      within(header("d2")).getByTestId("grid-header-menu-open"),
    );
    expect(menuButtons.current?.get("missing")).toBeNull();
  });

  it("머리 행이 창 밖이라 그려지지 않은 문서는 null, 사라진 문서도 null", () => {
    // jsdom 은 레이아웃이 없어 clientHeight 가 0 이다. 스크롤 창만 높이를 고정해 창 밖 행을 만든다.
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return this.dataset.testid === "grid-viewport" ? 100 : 0;
      },
    });
    try {
      const many: StructureDocument[] = Array.from({ length: 30 }, (_, i) => ({
        documentId: `m${i + 1}`,
        label: null,
        groupId: "g1",
        pages: [page("m.pdf", i * 2 + 1), page("m.pdf", i * 2 + 2)],
      }));
      const menuButtons = createRef<StructureMenuButtons>();
      const { rerender, props } = renderGrid({
        documents: many,
        excluded: [],
        unplaced: [],
        groupBoundariesAfter: [],
        overscanRows: 0,
        menuButtonsRef: menuButtons,
      });
      const lookup = menuButtons.current!;
      expect(lookup.get("m1")).toBe(
        within(header("m1")).getByTestId("grid-header-menu-open"),
      );
      expect(screen.queryAllByTestId("grid-header")).not.toHaveLength(30);
      expect(lookup.get("m30")).toBeNull();
      rerender(<PageGrid {...props} documents={many.slice(1)} />);
      expect(lookup.get("m1")).toBeNull();
      expect(lookup.get("m2")).toBe(
        within(header("m2")).getByTestId("grid-header-menu-open"),
      );
    } finally {
      delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
    }
  });
});

/** 편집 문구(`StructureEditLabelKey`·`splitBefore`·`unplacedMenu`)를 뺀 보기 문구. */
const VIEW_LABELS: PageGridLabels = {
  region: LABELS.region,
  document: LABELS.document,
  untitled: LABELS.untitled,
  notInConfigBadge: LABELS.notInConfigBadge,
  notInConfigHint: LABELS.notInConfigHint,
  pageCount: LABELS.pageCount,
  page: LABELS.page,
  noImage: LABELS.noImage,
  restoreToNewDocument: LABELS.restoreToNewDocument,
  moveDocumentTo: LABELS.moveDocumentTo,
  documentExclusion: LABELS.documentExclusion,
  excluded: LABELS.excluded,
  excludedEmpty: LABELS.excludedEmpty,
  unplaced: LABELS.unplaced,
  missing: LABELS.missing,
  overlap: LABELS.overlap,
  groupBoundary: LABELS.groupBoundary,
  multiDrag: LABELS.multiDrag,
  sizeToggle: LABELS.sizeToggle,
};

/** 편집 콜백을 하나도 넘기지 않고 그린다(콜백은 `overrides` 로만). */
function renderBare(overrides: Partial<PageGridProps> = {}) {
  const props: PageGridProps = {
    documents: DOCUMENTS,
    excluded: EXCLUDED,
    unplaced: UNPLACED,
    groupBoundariesAfter: [2],
    labels: LABELS,
    testId: "grid",
    ...overrides,
  };
  return render(<PageGrid {...props} />);
}

/** 끌어 놓기용 최소 DataTransfer. */
function dataTransferStub() {
  const store = new Map<string, string>();
  return {
    types: [] as string[],
    effectAllowed: "all",
    dropEffect: "none",
    setData(type: string, value: string) {
      store.set(type, value);
      if (!this.types.includes(type)) this.types.push(type);
    },
    getData: (type: string) => store.get(type) ?? "",
    setDragImage: () => {},
  };
}

/** 메뉴를 열어 항목 testid 를 순서대로 돌려준다. */
async function menuItemIds(trigger: HTMLElement) {
  const { menu } = await openMenu(trigger);
  return menuItems(menu).map(item => item.testId);
}

describe("PageGrid — 선택 콜백·readOnly", () => {
  it("readOnly: false 의 DOM 은 넘기지 않았을 때와 같다", () => {
    const base = renderGrid({ multiSelected: new Set(["a.pdf:1"]) });
    const expected = snapshotHtml(base.container.firstElementChild);
    base.unmount();
    const { container } = renderGrid({
      multiSelected: new Set(["a.pdf:1"]),
      readOnly: false,
    });
    expect(snapshotHtml(container.firstElementChild)).toBe(expected);
  });

  it("편집 콜백이 없으면 끌기·✂·라벨 편집이 없고 빈 메뉴 버튼은 비활성, 썸네일 클릭이 없으면 그림이다", () => {
    const { container } = renderBare();
    expect(screen.queryAllByTestId("grid-cell-split")).toHaveLength(0);
    expect(screen.queryAllByTestId("grid-label-select")).toHaveLength(0);
    expect(screen.queryAllByTestId("grid-label-input")).toHaveLength(0);
    expect(container.querySelectorAll('[draggable="true"]')).toHaveLength(0);
    expect(container.querySelectorAll(".cursor-grab")).toHaveLength(0);
    expect(screen.queryAllByTestId("grid-cell-select")).toHaveLength(0);
    // 문서 셀 8 + 제외 칸 셀 1. 빠진 칸 셀은 원래 그림이 아니다.
    const images = container.querySelectorAll('[role="img"]');
    expect(images).toHaveLength(9);
    expect(within(cell("a.pdf:2")).getByRole("img")).toHaveAccessibleName(
      "a.pdf p2 · 겹친 페이지",
    );
    expect(header("d1")).toHaveTextContent("Invoice");
    expect(header("d3")).toHaveTextContent("라벨 없음");
    for (const id of [
      "grid-header-menu-open",
      "grid-cell-menu-open",
      "grid-unplaced-menu-open",
    ]) {
      for (const el of screen.getAllByTestId(id)) expect(el).toBeDisabled();
    }
    // drop 상태 줄은 늘 그린다.
    expect(screen.getByTestId("grid-drop-rejected")).toHaveAttribute(
      "role",
      "status",
    );
  });

  it("편집 콜백·편집 문구가 모두 없으면 메뉴 버튼도 없는 보기다(루트 DOM)", () => {
    const { container } = renderBare({
      labels: VIEW_LABELS,
      selectedPage: { documentId: "d1", pageKey: "a.pdf:2" },
    });
    expect(screen.queryAllByTestId("grid-header-menu-open")).toHaveLength(0);
    expect(screen.queryAllByTestId("grid-cell-menu-open")).toHaveLength(0);
    expect(screen.queryAllByTestId("grid-unplaced-menu-open")).toHaveLength(0);
    expect(snapshotHtml(container.firstElementChild)).toMatchSnapshot();
  });

  it("readOnly 면 콜백을 모두 넘겨도 편집 콜백이 없을 때와 DOM 이 같고, 썸네일 클릭은 그대로 보낸다", async () => {
    const user = userEvent.setup();
    const multiSelected = new Set(["a.pdf:1", "a.pdf:2"]);
    const clicks: unknown[][] = [];
    const onThumbnailClick: PageGridProps["onThumbnailClick"] = (...args) => {
      clicks.push(args);
    };
    const bare = renderBare({ multiSelected, onThumbnailClick });
    const expected = snapshotHtml(bare.container.firstElementChild);
    bare.unmount();

    const { calls, container } = renderGrid({
      readOnly: true,
      multiSelected,
      onDropPages: () => {},
      onThumbnailClick,
    });
    expect(snapshotHtml(container.firstElementChild)).toBe(expected);
    await user.click(within(cell("a.pdf:2")).getByTestId("grid-cell-select"));
    expect(clicks).toEqual([
      ["d1", "a.pdf:2", 1, { shift: false, toggle: false }],
    ]);
    expect(calls).toEqual([]);
  });

  it("넘긴 콜백의 조작부만 그린다(셀·머리 메뉴 항목, ✂, 라벨, 끌기)", async () => {
    const noop = () => {};
    const cases: {
      props: Partial<PageGridProps>;
      cellItems: string[];
      excludedItems: string[];
      headerItems: string[];
      split: boolean;
      label: boolean;
      draggable: { document: boolean; loose: boolean };
    }[] = [
      {
        props: { onReorderPage: noop },
        cellItems: ["grid-cell-menu-earlier", "grid-cell-menu-later"],
        excludedItems: [],
        headerItems: [],
        split: false,
        label: false,
        draggable: { document: true, loose: false },
      },
      {
        props: { onMovePage: noop },
        cellItems: ["grid-cell-menu-move"],
        excludedItems: [],
        headerItems: [],
        split: false,
        label: false,
        draggable: { document: true, loose: false },
      },
      {
        props: { onSplit: noop },
        cellItems: ["grid-cell-menu-split"],
        excludedItems: [],
        headerItems: [],
        split: true,
        label: false,
        draggable: { document: false, loose: false },
      },
      {
        props: { onExcludePage: noop },
        cellItems: ["grid-cell-menu-exclude"],
        excludedItems: [],
        headerItems: [],
        split: false,
        label: false,
        draggable: { document: true, loose: false },
      },
      {
        props: { onRestorePage: noop },
        cellItems: [],
        excludedItems: ["grid-cell-menu-restore"],
        headerItems: [],
        split: false,
        label: false,
        draggable: { document: false, loose: true },
      },
      {
        props: { onRestoreToNewDocument: noop },
        cellItems: [],
        excludedItems: ["grid-cell-menu-new-document"],
        headerItems: [],
        split: false,
        label: false,
        draggable: { document: false, loose: false },
      },
      {
        props: { onDropPages: noop },
        cellItems: [],
        excludedItems: [],
        headerItems: [],
        split: false,
        label: false,
        draggable: { document: true, loose: false },
      },
      {
        props: { onLabelChange: noop },
        cellItems: [],
        excludedItems: [],
        headerItems: [],
        split: false,
        label: true,
        draggable: { document: false, loose: false },
      },
      {
        props: { onMergeInto: noop },
        cellItems: [],
        excludedItems: [],
        headerItems: ["grid-header-menu-merge"],
        split: false,
        label: false,
        draggable: { document: false, loose: false },
      },
      {
        props: { onReorderDocument: noop },
        cellItems: [],
        excludedItems: [],
        headerItems: ["grid-header-menu-earlier", "grid-header-menu-later"],
        split: false,
        label: false,
        draggable: { document: false, loose: false },
      },
      {
        props: { onExcludeDocument: noop, onRequestDocumentPosition: noop },
        cellItems: [],
        excludedItems: [],
        headerItems: ["grid-header-menu-position", "grid-header-menu-exclude"],
        split: false,
        label: false,
        draggable: { document: false, loose: false },
      },
    ];
    for (const item of cases) {
      const name = Object.keys(item.props).join("+");
      // 메뉴는 열 때마다 새로 그린다(열린 Radix 메뉴가 다음 조작을 막는다).
      const menus: [trigger: () => HTMLElement, expected: readonly string[]][] =
        [
          [
            () => within(cell("a.pdf:2")).getByTestId("grid-cell-menu-open"),
            item.cellItems,
          ],
          [
            () => within(cell("a.pdf:7")).getByTestId("grid-cell-menu-open"),
            item.excludedItems,
          ],
          [
            () => within(header("d2")).getByTestId("grid-header-menu-open"),
            item.headerItems,
          ],
        ];
      for (const [trigger, expected] of menus) {
        renderBare(item.props);
        if (expected.length === 0) {
          expect(trigger(), name).toBeDisabled();
        } else {
          expect(await menuItemIds(trigger()), name).toEqual(expected);
        }
        cleanup();
      }
      renderBare(item.props);
      expect(screen.queryAllByTestId("grid-cell-split").length > 0, name).toBe(
        item.split,
      );
      expect(
        screen.queryAllByTestId("grid-label-select").length > 0,
        name,
      ).toBe(item.label);
      expect(cell("a.pdf:2"), name).toHaveAttribute(
        "draggable",
        String(item.draggable.document),
      );
      expect(cell("a.pdf:7"), name).toHaveAttribute(
        "draggable",
        String(item.draggable.loose),
      );
      cleanup();
    }
  });

  it("콜백이 있어도 짝 문구가 없으면 그 조작부를 그리지 않는다", async () => {
    renderGrid({
      labels: { ...LABELS, splitBefore: undefined, movePageEarlier: undefined },
    });
    expect(screen.queryAllByTestId("grid-cell-split")).toHaveLength(0);
    expect(
      await menuItemIds(
        within(cell("a.pdf:2")).getByTestId("grid-cell-menu-open"),
      ),
    ).toEqual([
      "grid-cell-menu-later",
      "grid-cell-menu-move",
      "grid-cell-menu-exclude",
    ]);
    cleanup();

    // 편집 문구가 모두 없으면 콜백이 있어도 라벨 편집·✂·메뉴 버튼이 없다.
    renderBare({ ...recordingCallbacks().callbacks, labels: VIEW_LABELS });
    expect(screen.queryAllByTestId("grid-label-select")).toHaveLength(0);
    expect(screen.queryAllByTestId("grid-label-input")).toHaveLength(0);
    expect(screen.queryAllByTestId("grid-cell-menu-open")).toHaveLength(0);
    expect(screen.queryAllByTestId("grid-header-menu-open")).toHaveLength(0);
    expect(screen.queryAllByTestId("grid-unplaced-menu-open")).toHaveLength(0);
    expect(screen.queryAllByTestId("grid-cell-split")).toHaveLength(0);
    expect(header("d1")).toHaveTextContent("Invoice");
  });

  it("받을 콜백이 없는 자리에는 drop 을 허용하지 않고 콜백도 부르지 않는다", () => {
    const calls: unknown[][] = [];
    renderBare({
      onExcludePage: (...args) => {
        calls.push(["onExcludePage", ...args]);
      },
    });
    const dataTransfer = dataTransferStub();

    // 다른 문서로 옮기기(onMovePage 없음): 자리 표시·drop 없음.
    fireEvent.dragStart(cell("a.pdf:1"), { dataTransfer });
    expect(fireEvent.dragOver(header("d2"), { dataTransfer })).toBe(true);
    expect(header("d2").firstElementChild).toHaveClass("border-border");
    fireEvent.drop(header("d2"), { dataTransfer });
    expect(calls).toEqual([]);

    // 제외 칸(onExcludePage 있음): 받는다.
    fireEvent.dragStart(cell("a.pdf:1"), { dataTransfer });
    expect(
      fireEvent.dragOver(screen.getByTestId("grid-excluded"), {
        dataTransfer,
      }),
    ).toBe(false);
    fireEvent.drop(screen.getByTestId("grid-excluded"), { dataTransfer });
    expect(calls).toEqual([["onExcludePage", "d1", "a.pdf:1"]]);
  });
});

describe("PageGrid — 콜백 ↔ 문구 짝 표", () => {
  /**
   * ⋯ 버튼이 있고 쓸 수 있으면 메뉴를 열어 그 항목이 있는지 본다. 항목이 0 개인 메뉴 버튼은 비활성으로
   * 남으므로(필름스트립과 다른 점) 쓸 수 없는 버튼은 "없음" 으로 센다.
   */
  async function menuHas(trigger: HTMLElement | null, itemTestId: string) {
    if (!trigger || trigger.hasAttribute("disabled")) return false;
    return (await menuItemIds(trigger)).includes(itemTestId);
  }
  const cellMenu = (pageKey: string, item: string) =>
    menuHas(
      within(cell(pageKey)).queryByTestId("grid-cell-menu-open"),
      `grid-cell-menu-${item}`,
    );
  const headerMenu = (documentId: string, item: string) =>
    menuHas(
      within(header(documentId)).queryByTestId("grid-header-menu-open"),
      `grid-header-menu-${item}`,
    );
  const present = (testId: string) => async () =>
    screen.queryAllByTestId(testId).length > 0;

  /** 짝 표 행 id → 그 조작부를 찾는 방법(필요하면 함께 넘길 props). */
  const PROBES: Record<
    string,
    { props?: Partial<PageGridProps>; shown: () => Promise<boolean> }
  > = {
    "page-earlier": { shown: () => cellMenu("a.pdf:2", "earlier") },
    "page-later": { shown: () => cellMenu("a.pdf:2", "later") },
    "page-move": { shown: () => cellMenu("a.pdf:2", "move") },
    "page-split": { shown: () => cellMenu("a.pdf:2", "split") },
    "page-exclude": { shown: () => cellMenu("a.pdf:2", "exclude") },
    "split-button": { shown: present("grid-cell-split") },
    "excluded-restore": { shown: () => cellMenu("a.pdf:7", "restore") },
    "excluded-new-document": {
      shown: () => cellMenu("a.pdf:7", "new-document"),
    },
    "unplaced-new-document": {
      shown: () =>
        menuHas(
          screen.queryByTestId("grid-unplaced-menu-open"),
          "grid-unplaced-menu-new-document",
        ),
    },
    "label-field": {
      shown: async () =>
        screen.queryAllByTestId("grid-label-select").length +
          screen.queryAllByTestId("grid-label-input").length >
        0,
    },
    "document-merge": { shown: () => headerMenu("d2", "merge") },
    "document-earlier": { shown: () => headerMenu("d2", "earlier") },
    "document-later": { shown: () => headerMenu("d2", "later") },
    "document-position": { shown: () => headerMenu("d2", "position") },
    "document-exclude": { shown: () => headerMenu("d2", "exclude") },
    "document-restore": { shown: () => headerMenu("d3", "restore") },
    "multi-drag": {
      props: { multiSelected: new Set(["a.pdf:1", "a.pdf:2"]) },
      // 여러 장 drag 이미지(화면 밖 배지).
      shown: async () =>
        screen
          .getByTestId("grid")
          .querySelector(':scope > [aria-hidden="true"]') !== null,
    },
    "size-toggle": { shown: present("grid-size-s") },
  };

  /** `keys` 를 `undefined` 로 덮은 사본. */
  function without<T extends object>(source: T, keys: readonly string[]): T {
    return {
      ...source,
      ...Object.fromEntries(keys.map(key => [key, undefined])),
    };
  }

  it("페이지 격자에 해당하는 짝 표 행마다 찾는 방법이 있다", () => {
    expect(Object.keys(PROBES).sort()).toEqual(
      structureEditPairsFor("pageGrid")
        .map(pair => pair.id)
        .sort(),
    );
  });

  it("콜백 + 문구 → 있음 / 콜백만 → 없음 / 문구만 → 없음", async () => {
    const noop = () => {};
    for (const pair of structureEditPairsFor("pageGrid")) {
      const probe = PROBES[pair.id]!;
      const cases: [string, Partial<PageGridProps>, boolean][] = [
        ["콜백 + 문구", {}, true],
        ["콜백만", { labels: without(LABELS, pair.labels) }, false],
        ["문구만", without({}, pair.callbacks), false],
      ];
      for (const [name, overrides, expected] of cases) {
        renderGrid({
          onDropPages: noop,
          onSizeChange: noop,
          ...probe.props,
          ...overrides,
        });
        expect(await probe.shown(), `${pair.id} · ${name}`).toBe(expected);
        cleanup();
      }
    }
  });
});

/**
 * Studio UI Kit item 문서의 "DOM 계약" 중 `page-grid` 행과 스모크가 읽는 role. `data-selected`·`aria-pressed`·
 * `aria-current`·셀 `draggable` 의 조건별 값은 위 테스트들("셀 상태…", "여러 장 선택…",
 * "크기 토글…", 끌기 조건)이 본다.
 */
const DOM_CONTRACT = [
  {
    selector: '[data-testid="grid-header"][data-document-id]',
    on: "문서 머리",
  },
  { selector: '[role="presentation"][data-document-id]', on: "문서 행" },
  { selector: "[data-page-grid-page]", on: "셀 뿌리(페이지 key)" },
  { selector: '[role="separator"]', on: "그룹 경계(머리 안)" },
] as const;

describe("PageGrid DOM 계약", () => {
  const region = () => screen.getByRole("region", { name: "페이지 정리" });

  it.each(DOM_CONTRACT)("$selector 가 $on 에 붙는다", ({ selector }) => {
    renderGrid();
    expect(region().querySelector(selector)).not.toBeNull();
  });

  it("머리 data-document-id 는 문서마다 하나", () => {
    renderGrid();
    expect(
      screen
        .getAllByTestId("grid-header")
        .map(el => el.getAttribute("data-document-id")),
    ).toEqual(DOCUMENTS.map(d => d.documentId));
  });

  it('행 role="presentation" 은 문서 행에만 data-document-id 가 있고 제외·빠진 칸 행에는 없다', () => {
    renderGrid();
    const rows = Array.from(
      region().querySelectorAll<HTMLElement>('[role="presentation"]'),
    );
    const cellsOf = (row: HTMLElement) =>
      Array.from(row.querySelectorAll("[data-page-grid-page]")).map(el =>
        el.getAttribute("data-page-grid-page"),
      );
    expect(
      rows
        .filter(row => row.hasAttribute("data-document-id"))
        .map(row => [row.getAttribute("data-document-id"), cellsOf(row)]),
    ).toEqual(DOCUMENTS.map(d => [d.documentId, d.pages.map(p => p.key)]));
    const loose = rows.filter(row => !row.hasAttribute("data-document-id"));
    expect(loose.map(cellsOf)).toEqual([
      EXCLUDED.map(p => p.key),
      UNPLACED.map(p => p.key),
    ]);
    for (const row of loose) {
      expect(row.closest("[data-document-id]")).toBeNull();
    }
  });

  it('그룹 경계 role="separator" 는 경계 뒤 문서 머리 안에만 있다', () => {
    renderGrid();
    const separators = within(region()).getAllByRole("separator");
    expect(
      separators.map(el =>
        el.closest("[data-document-id]")?.getAttribute("data-document-id"),
      ),
    ).toEqual(["d4"]);
  });
});
