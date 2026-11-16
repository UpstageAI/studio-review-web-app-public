import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DocumentStatusFilter } from "@/components/studio-ui-kit/document-list/document-filter";
import {
  DocumentListFilter,
  type DocumentListFilterLabels,
  type DocumentListFilterProps,
} from "@/components/studio-ui-kit/document-list/document-list-filter";

const LABELS: DocumentListFilterLabels = {
  search: "Find by label",
  placeholder: "Label…",
  status: "Status",
  options: {
    all: "All",
    flagged: "Flagged",
    changed: "Changed",
    recheck: "Recheck",
    excluded: "Excluded",
    untouched: "Untouched",
    unvisited: "Unvisited",
  },
  summary: ({ count, pages }) => `${count} docs / ${pages} pages`,
  visitedCount: count => `${count} seen`,
  filteredCount: count => `${count} shown`,
  separator: " · ",
  selectedHidden: "Selection hidden",
  clear: "Clear",
};

const OPTIONS: readonly DocumentStatusFilter[] = [
  "all",
  "changed",
  "unvisited",
];

function setup(overrides: Partial<DocumentListFilterProps> = {}) {
  const calls: { queries: string[]; statuses: string[]; clears: number } = {
    queries: [],
    statuses: [],
    clears: 0,
  };
  const props: DocumentListFilterProps = {
    query: "",
    onQueryChange: query => calls.queries.push(query),
    status: "all",
    onStatusChange: status => calls.statuses.push(status),
    statusOptions: OPTIONS,
    summary: { count: 4, pages: 9, visited: 2 },
    labels: LABELS,
    testId: "filter",
    ...overrides,
  };
  render(
    <div data-testid="column">
      <DocumentListFilter {...props} />
    </div>,
  );
  return { calls, column: screen.getByTestId("column") };
}

describe("DocumentListFilter", () => {
  it("labels 문구로 그리고 요약 줄은 넘긴 부분만 구분자로 잇는다", () => {
    setup({ showVisited: true, filteredCount: 1 });
    const input = screen.getByTestId("filter-input-search");
    expect(input).toHaveAccessibleName("Find by label");
    expect(input).toHaveAttribute("placeholder", "Label…");
    expect(screen.getByTestId("filter-select-status")).toHaveAccessibleName(
      "Status",
    );
    expect(
      screen.getByText("4 docs / 9 pages · 2 seen · 1 shown"),
    ).toBeTruthy();
  });

  it("기본값은 열어 본 수·거른 수·가려짐 안내를 그리지 않는다", () => {
    const { column } = setup();
    expect(column.children).toHaveLength(2);
    expect(column.children[1].textContent).toBe("4 docs / 9 pages");
  });

  it("입력과 상태 선택을 그대로 넘긴다", async () => {
    const { calls } = setup();
    fireEvent.change(screen.getByTestId("filter-input-search"), {
      target: { value: "x" },
    });
    expect(calls.queries).toEqual(["x"]);
    screen.getByTestId("filter-select-status").focus();
    await userEvent.keyboard("{Enter}");
    expect(
      screen.getAllByRole("option").map(option => option.textContent),
    ).toEqual(["All", "Changed", "Unvisited"]);
    await userEvent.click(screen.getByTestId("filter-option-unvisited"));
    expect(calls.statuses).toEqual(["unvisited"]);
  });

  it("지우기 콜백이 없으면 가려짐 안내에 버튼을 두지 않는다", () => {
    setup({ selectionHidden: true });
    expect(screen.getByTestId("filter-hidden").textContent).toBe(
      "Selection hidden",
    );
    expect(screen.queryByTestId("filter-button-clear")).toBeNull();
  });

  it("지우기 콜백을 넘기면 누를 때 부른다", async () => {
    const { calls } = setup({
      selectionHidden: true,
      onClearFilter: () => {
        calls.clears += 1;
      },
    });
    await userEvent.click(screen.getByTestId("filter-button-clear"));
    expect(calls.clears).toBe(1);
  });

  it("notices 는 가려짐 안내 뒤 형제로 그린다", () => {
    const { column } = setup({
      selectionHidden: true,
      notices: <p data-testid="host-notice">host</p>,
    });
    const tags = [...column.children].map(
      child => child.getAttribute("data-testid") ?? child.tagName,
    );
    expect(tags).toEqual(["DIV", "P", "filter-hidden", "host-notice"]);
  });

  it("testId 가 없으면 하위 testid 를 달지 않고, 요약 줄 testid 는 summaryTestId 로 받는다", () => {
    const { column } = setup({
      testId: undefined,
      summaryTestId: "summary",
      selectionHidden: true,
      onClearFilter: () => {},
    });
    expect(
      [...column.querySelectorAll("[data-testid]")].map(el =>
        el.getAttribute("data-testid"),
      ),
    ).toEqual(["summary"]);
  });
});
