import { render, screen } from "@testing-library/react";
import { StatusChip } from "../status-chip";

describe("StatusChip", () => {
  it("상태 종류를 data-status 로 두고 호출자 속성을 루트에 전달한다", () => {
    render(
      <StatusChip kind="changed" data-testid="chip" className="extra">
        바뀜
      </StatusChip>,
    );

    const root = screen.getByTestId("chip");
    expect(root).toHaveAttribute("data-status", "changed");
    expect(root).toHaveClass("inline-flex", "extra");
    expect(root).toHaveTextContent("바뀜");
  });

  it("사유가 있을 때만 칩 뒤에 사유를 붙인다", () => {
    const { rerender } = render(
      <StatusChip kind="locked" data-testid="chip">
        편집 불가
      </StatusChip>,
    );
    expect(screen.getByTestId("chip").children).toHaveLength(1);

    rerender(
      <StatusChip kind="locked" data-testid="chip" reason="잠긴 문서">
        편집 불가
      </StatusChip>,
    );
    const root = screen.getByTestId("chip");
    expect(root.children).toHaveLength(2);
    expect(screen.getByText("잠긴 문서")).toHaveClass("text-muted-foreground");
  });
});
