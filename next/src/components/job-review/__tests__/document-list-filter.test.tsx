import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { snapshotHtml } from "@/test/dom-snapshot";
import { renderWithIntl } from "@/test/render";
import type { DocumentStatusFilter } from "@/components/studio-ui-kit/document-list";
import {
  DocumentListFilter,
  type DocumentListFilterProps,
} from "../document-list-filter";

const ALL_OPTIONS: readonly DocumentStatusFilter[] = [
  "all",
  "flagged",
  "changed",
  "recheck",
  "excluded",
  "untouched",
  "unvisited",
];

interface Calls {
  queries: string[];
  statuses: DocumentStatusFilter[];
  clears: number;
}

function setup(overrides: Partial<DocumentListFilterProps> = {}) {
  const calls: Calls = { queries: [], statuses: [], clears: 0 };
  const props: DocumentListFilterProps = {
    query: "",
    onQueryChange: query => calls.queries.push(query),
    status: "all",
    onStatusChange: status => calls.statuses.push(status),
    statusOptions: ALL_OPTIONS,
    summary: { count: 12, pages: 40, visited: 3 },
    showVisited: true,
    filteredCount: null,
    selectionHidden: false,
    onClearFilter: () => {
      calls.clears += 1;
    },
    ...overrides,
  };
  // 칼럼 안 형제로 그려지므로 감싼 요소를 기준으로 본다.
  const view = renderWithIntl(
    <section data-testid="column">
      <DocumentListFilter {...props} />
    </section>,
  );
  return { ...view, calls, column: screen.getByTestId("column") };
}

async function openStatusSelect() {
  screen.getByTestId("job-review-document-filter-select-status").focus();
  await userEvent.keyboard("{Enter}");
}

describe("DocumentListFilter (host)", () => {
  it("거르지 않을 때 DOM 은 그대로다", () => {
    const { column } = setup();
    expect(snapshotHtml(column)).toMatchSnapshot();
  });

  it("거르는 중이고 고른 문서가 가려졌을 때 DOM 은 그대로다", () => {
    const { column } = setup({
      query: "청구",
      status: "changed",
      filteredCount: 2,
      selectionHidden: true,
    });
    expect(snapshotHtml(column)).toMatchSnapshot();
  });

  it("열어 본 문서를 구분하지 않을 때 DOM 은 그대로다", () => {
    const { column } = setup({
      showVisited: false,
      statusOptions: ALL_OPTIONS.filter(value => value !== "unvisited"),
      summary: { count: 1, pages: 5, visited: 0 },
    });
    expect(snapshotHtml(column)).toMatchSnapshot();
  });

  it("칼럼의 형제 요소로 필터 행·요약 줄·가려짐 안내 순서로 그린다", () => {
    const { column } = setup({ selectionHidden: true });
    expect([...column.children].map(child => child.tagName)).toEqual([
      "DIV",
      "P",
      "DIV",
    ]);
    expect(column.children[1]).toHaveAttribute(
      "data-testid",
      "job-review-document-summary",
    );
    expect(column.children[2]).toHaveAttribute(
      "data-testid",
      "job-review-document-filter-hidden",
    );
  });

  it("검색 칸은 입력 값을 그대로 넘기고 라벨·자리 표시 문구를 단다", () => {
    const { calls } = setup({ query: "a" });
    const input = screen.getByTestId("job-review-document-filter-input-search");
    expect(input).toHaveValue("a");
    expect(input).toHaveAttribute("type", "search");
    expect(input).toHaveAttribute("placeholder", "라벨 검색");
    expect(input).toHaveAccessibleName("라벨로 찾기");
    expect(input).toHaveAttribute("autocomplete", "off");
    fireEvent.change(input, { target: { value: "ab" } });
    fireEvent.change(input, { target: { value: "" } });
    expect(calls.queries).toEqual(["ab", ""]);
  });

  it("상태 선택 상자는 지금 상태를 보이고 이름이 있다", () => {
    setup({ status: "recheck" });
    const trigger = screen.getByTestId(
      "job-review-document-filter-select-status",
    );
    expect(trigger).toHaveAccessibleName("상태 필터");
    expect(trigger).toHaveTextContent("재확인 필요");
  });

  it("상태 항목은 넘긴 순서대로이고 각 항목에 testid 가 붙는다", async () => {
    setup();
    await openStatusSelect();
    expect(
      screen.getAllByRole("option").map(option => option.textContent),
    ).toEqual([
      "전체",
      "실패 또는 경고",
      "바뀜",
      "재확인 필요",
      "제외",
      "변경 없음",
      "열어 보지 않은 문서",
    ]);
    for (const value of ALL_OPTIONS) {
      expect(
        screen.getByTestId(`job-review-document-filter-option-${value}`),
      ).toHaveAttribute("role", "option");
    }
  });

  it("unvisited 바로 앞에만 구분선을 둔다", async () => {
    setup();
    await openStatusSelect();
    const listbox = screen.getByRole("listbox");
    const separators = listbox.querySelectorAll(
      '[data-slot="select-separator"]',
    );
    expect(separators).toHaveLength(1);
    expect(separators[0].nextElementSibling).toHaveAttribute(
      "data-testid",
      "job-review-document-filter-option-unvisited",
    );
  });

  it("열린 상태 목록의 DOM 은 그대로다", async () => {
    setup({ status: "flagged" });
    await openStatusSelect();
    expect(snapshotHtml(screen.getByRole("listbox"))).toMatchSnapshot();
  });

  it("unvisited 가 없으면 구분선도 없다", async () => {
    setup({
      statusOptions: ALL_OPTIONS.filter(value => value !== "unvisited"),
    });
    await openStatusSelect();
    expect(
      screen
        .getByRole("listbox")
        .querySelectorAll('[data-slot="select-separator"]'),
    ).toHaveLength(0);
  });

  it("상태를 고르면 그 값을 넘긴다", async () => {
    const { calls } = setup();
    await openStatusSelect();
    await userEvent.click(screen.getByRole("option", { name: "바뀜" }));
    expect(calls.statuses).toEqual(["changed"]);
  });

  it("요약 줄은 문서·페이지 수, 열어 본 수, 거른 결과 수를 구분자로 잇는다", () => {
    setup({ filteredCount: 4 });
    expect(screen.getByTestId("job-review-document-summary")).toHaveTextContent(
      "문서 12개, 전체 40쪽, 열어 본 문서 3개, 필터 4개",
    );
  });

  it("열어 본 문서를 구분하지 않으면 요약에 열어 본 수가 없다", () => {
    setup({ showVisited: false });
    expect(screen.getByTestId("job-review-document-summary").textContent).toBe(
      "문서 12개, 전체 40쪽",
    );
  });

  it("거른 결과가 0 개여도 요약에 붙인다", () => {
    setup({ showVisited: false, filteredCount: 0 });
    expect(screen.getByTestId("job-review-document-summary").textContent).toBe(
      "문서 12개, 전체 40쪽, 필터 0개",
    );
  });

  it("고른 문서가 가려지지 않았으면 안내 줄이 없다", () => {
    setup();
    expect(
      screen.queryByTestId("job-review-document-filter-hidden"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("job-review-document-filter-button-clear"),
    ).not.toBeInTheDocument();
  });

  it("고른 문서가 가려지면 안내 줄과 필터 지우기 버튼을 두고, 누르면 지우기를 부른다", async () => {
    const { calls } = setup({ selectionHidden: true });
    expect(
      screen.getByTestId("job-review-document-filter-hidden"),
    ).toHaveTextContent("선택한 문서가 필터에 가려져 있습니다.");
    const clear = screen.getByTestId("job-review-document-filter-button-clear");
    expect(clear).toHaveTextContent("필터 지우기");
    expect(clear).toHaveAttribute("type", "button");
    await userEvent.click(clear);
    expect(calls.clears).toBe(1);
  });

  it("지우기 콜백이 없으면 안내 줄에 버튼을 두지 않는다", () => {
    setup({ selectionHidden: true, onClearFilter: undefined });
    expect(
      screen.getByTestId("job-review-document-filter-hidden"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("job-review-document-filter-button-clear"),
    ).not.toBeInTheDocument();
  });

  it("다른 locale 문구로 그린다", () => {
    renderWithIntl(
      <DocumentListFilter
        query=""
        onQueryChange={() => {}}
        status="all"
        onStatusChange={() => {}}
        statusOptions={ALL_OPTIONS}
        summary={{ count: 2, pages: 3, visited: 1 }}
        showVisited
      />,
      { locale: "en" },
    );
    expect(
      screen.getByTestId("job-review-document-filter-input-search"),
    ).toHaveAttribute("placeholder", "Search labels");
    expect(screen.getByTestId("job-review-document-summary").textContent).toBe(
      "2 documents, 3 pages in total, 1 opened",
    );
  });
});
