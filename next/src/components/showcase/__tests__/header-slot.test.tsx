import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  HeaderSlot,
  HeaderSlotProvider,
  HeaderSlotTarget,
} from "../header-slot";

const content = <span data-testid="slot-content">content</span>;

describe("HeaderSlot", () => {
  it("provider 가 없으면 제자리에 그린다", () => {
    render(
      <div data-testid="in-place">
        <HeaderSlot>{content}</HeaderSlot>
      </div>,
    );
    expect(screen.getByTestId("in-place")).toContainElement(
      screen.getByTestId("slot-content"),
    );
  });

  it("provider 와 자리가 있으면 자리 안에 그린다", () => {
    render(
      <HeaderSlotProvider>
        <HeaderSlotTarget />
        <div data-testid="in-place">
          <HeaderSlot>{content}</HeaderSlot>
        </div>
      </HeaderSlotProvider>,
    );
    const item = screen.getByTestId("slot-content");
    expect(screen.getByTestId("app-header-slot")).toContainElement(item);
    expect(screen.getByTestId("in-place")).not.toContainElement(item);
  });

  it("provider 만 있고 자리가 없으면 그리지 않는다", () => {
    render(
      <HeaderSlotProvider>
        <div data-testid="in-place">
          <HeaderSlot>{content}</HeaderSlot>
        </div>
      </HeaderSlotProvider>,
    );
    expect(screen.queryByTestId("slot-content")).toBeNull();
  });
});
