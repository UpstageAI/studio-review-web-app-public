import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Table, TableHeader, TableRow } from "@/components/ui/table";
import { renderWithIntl } from "@/test/render";
import { FilterHead } from "../filter-head";
import { ALL_SOURCES, type SourceFilter } from "../list-filters";

function Harness({
  initial = ALL_SOURCES,
  onChange,
}: {
  initial?: SourceFilter;
  onChange: (value: SourceFilter) => void;
}) {
  const [value, setValue] = useState<SourceFilter>(initial);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <FilterHead
            column="source"
            value={value}
            onChange={next => {
              onChange(next);
              setValue(next);
            }}
          />
        </TableRow>
      </TableHeader>
    </Table>
  );
}

const trigger = () =>
  screen.getByTestId("collections-list-button-filter-source");
const item = (type: string) =>
  screen.getByTestId(`collections-list-filter-source-${type}`);

describe("FilterHead", () => {
  it("항목마다 출처 설명 한 줄을 보인다", async () => {
    const user = userEvent.setup();
    renderWithIntl(<Harness onChange={vi.fn()} />);
    await user.click(trigger());

    expect(item("standalone")).toHaveTextContent("Store API");
    expect(item("standalone")).toHaveTextContent(
      "Workflow 없이 Store API 로 직접 만든 Collection",
    );
    expect(item("all")).toHaveAttribute("aria-checked", "true");
  });

  it("여러 출처를 고를 수 있고 고르는 동안 메뉴가 열려 있다", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithIntl(<Harness onChange={onChange} />);
    await user.click(trigger());

    await user.click(item("standalone"));
    expect(onChange).toHaveBeenLastCalledWith(["standalone"]);
    expect(item("standalone")).toHaveAttribute("aria-checked", "true");

    await user.click(item("agent_link"));
    expect(onChange).toHaveBeenLastCalledWith(["agent_link", "standalone"]);
    expect(item("all")).toHaveAttribute("aria-checked", "false");

    expect(trigger()).toHaveAttribute("data-active", "true");
    expect(trigger()).toHaveTextContent("(2)");
    expect(trigger()).toHaveAttribute("aria-label", "출처 기준 필터, 2개 선택");
  });

  it("전체를 누르면 선택을 비운다", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithIntl(
      <Harness initial={["agent_export", "file_upload"]} onChange={onChange} />,
    );
    expect(trigger()).toHaveAttribute("data-active", "true");
    await user.click(trigger());

    await user.click(item("all"));
    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(item("all")).toHaveAttribute("aria-checked", "true");
    expect(item("agent_export")).toHaveAttribute("aria-checked", "false");
    expect(trigger()).toHaveAttribute("data-active", "false");
  });
});
