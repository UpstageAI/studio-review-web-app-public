import { fireEvent, render, screen } from "@testing-library/react";
import { FieldRow, type FieldRowProps } from "../field-row";

function renderRow(overrides: Partial<FieldRowProps> = {}) {
  const calls: string[] = [];
  const result = render(
    <FieldRow
      title="날짜"
      changed={false}
      selected={false}
      labels={{ revert: "되돌리기", machine: "원본 값" }}
      onSelect={() => calls.push("onSelect")}
      onHoverChange={hovering => calls.push(`onHoverChange:${hovering}`)}
      testId="row"
      {...overrides}
    >
      <input aria-label="값" />
    </FieldRow>,
  );
  return { ...result, calls };
}

describe("FieldRow — pointer", () => {
  it("pointer 가 있으면 data-pointer 로 남긴다", () => {
    renderRow({ pointer: "/invoice/date" });
    expect(screen.getByTestId("row")).toHaveAttribute(
      "data-pointer",
      "/invoice/date",
    );
  });

  it("pointer 가 없으면 data-pointer 를 붙이지 않는다", () => {
    renderRow();
    expect(screen.getByTestId("row")).not.toHaveAttribute("data-pointer");
  });
});

describe("FieldRow — 루트 속성과 핸들러", () => {
  it("host 가 넘긴 data-* 속성은 붙는다", () => {
    renderRow({ "data-field-id": "f1" } as Partial<FieldRowProps>);
    expect(screen.getByTestId("row")).toHaveAttribute("data-field-id", "f1");
  });

  it("host 가 같은 핸들러를 넘기면 내부 동작 뒤에 함께 부른다", () => {
    const { calls } = renderRow({
      onFocusCapture: () => calls.push("host:focus"),
      onPointerEnter: () => calls.push("host:enter"),
      onPointerLeave: () => calls.push("host:leave"),
    });
    const row = screen.getByTestId("row");
    fireEvent.focus(screen.getByRole("textbox", { name: "값" }));
    fireEvent.pointerEnter(row);
    fireEvent.pointerLeave(row);
    expect(calls).toEqual([
      "onSelect",
      "host:focus",
      "onHoverChange:true",
      "host:enter",
      "onHoverChange:false",
      "host:leave",
    ]);
  });

  it("host 핸들러가 없어도 내부 동작은 그대로다", () => {
    const { calls } = renderRow();
    const row = screen.getByTestId("row");
    fireEvent.focus(screen.getByRole("textbox", { name: "값" }));
    fireEvent.pointerEnter(row);
    fireEvent.pointerLeave(row);
    expect(calls).toEqual([
      "onSelect",
      "onHoverChange:true",
      "onHoverChange:false",
    ]);
  });

  it("호출자가 넘긴 data-testid·data-selected 는 내부 값을 덮지 못한다", () => {
    renderRow({
      selected: true,
      "data-testid": "host",
      "data-selected": "no",
    } as Partial<FieldRowProps>);
    const row = screen.getByTestId("row");
    expect(row).toHaveAttribute("data-selected", "true");
    expect(screen.queryByTestId("host")).toBeNull();
  });
});
