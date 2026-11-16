import { render, screen } from "@testing-library/react";
import { cn } from "@/lib/utils";
import { ChangeTray, type ChangeTrayStatus } from "../change-tray";

const LABELS = {
  changes: "변경 사항",
  revert: "되돌리기",
  revertItem: (text: string) => `${text} 되돌리기`,
  conflict: "충돌",
  summary: "저장 전 검증",
  passed: "통과",
  failed: "문제",
  emptyTitle: "아직 바뀐 것이 없습니다",
};

/**
 * 상태 줄 클래스를 공통 문자열 + 종류별 색으로 나눠 `cn` 으로 합치던 때의 결과. 클래스를 종류별
 * 완성 문자열로 바꾼 뒤에도 같은 문자열이 나와야 한다(외형 불변).
 */
const BASE = "flex min-w-0 flex-col gap-2 rounded-md border px-3 py-2 text-sm";
const EXPECTED: Record<ChangeTrayStatus["kind"], string> = {
  info: cn(BASE, "border-border bg-muted/50 text-foreground"),
  success: cn(BASE, "border-primary/40 bg-primary/10 text-foreground"),
  error: cn(BASE, "border-destructive/50 bg-destructive/10 text-destructive"),
};

describe("ChangeTray 상태 줄", () => {
  it.each(["info", "success", "error"] as const)(
    "%s 상태 줄의 class 가 이전 병합 결과와 바이트까지 같다",
    kind => {
      render(
        <ChangeTray
          groups={[]}
          onRevert={() => {}}
          summary={[]}
          status={{ kind, text: "상태 문구" }}
          emptyHint={[]}
          labels={LABELS}
          testId="tray"
        />,
      );
      const status = screen.getByTestId("tray-status");
      expect(status.getAttribute("class")).toBe(EXPECTED[kind]);
      expect(status).toHaveAttribute("data-status", kind);
      expect(status).toHaveAttribute(
        "role",
        kind === "error" ? "alert" : "status",
      );
    },
  );

  it("병합 결과 문자열은 공통 클래스 뒤에 종류별 색이 붙은 모양이다", () => {
    expect(EXPECTED).toEqual({
      info: "flex min-w-0 flex-col gap-2 rounded-md border px-3 py-2 text-sm border-border bg-muted/50 text-foreground",
      success:
        "flex min-w-0 flex-col gap-2 rounded-md border px-3 py-2 text-sm border-primary/40 bg-primary/10 text-foreground",
      error:
        "flex min-w-0 flex-col gap-2 rounded-md border px-3 py-2 text-sm border-destructive/50 bg-destructive/10 text-destructive",
    });
  });
});

/** 이 테스트가 고정하는 `change-tray` DOM 계약: 속성 · 붙는 요소 · 값. */
const DOM_CONTRACT = [
  { attribute: "data-status", on: "상태 줄(`-status`)", value: "status.kind" },
  {
    attribute: "data-conflict",
    on: "항목(`-item`)",
    value: '충돌이면 "true", 아니면 없음',
  },
  { attribute: "data-ok", on: "요약 줄 `li`", value: '"true" | "false"' },
] as const;

function renderContractTray() {
  return render(
    <ChangeTray
      groups={[
        {
          id: "g",
          documentLabel: "문서 1",
          items: [
            { id: "a", text: "값 a" },
            { id: "b", text: "값 b", conflict: true },
            { id: "c", text: "값 c", conflict: false },
          ],
        },
      ]}
      onRevert={() => {}}
      summary={[
        { id: "ok", label: "검증", ok: true },
        { id: "bad", label: "크기", ok: false },
      ]}
      status={{ kind: "info", text: "상태" }}
      emptyHint={[]}
      labels={LABELS}
      testId="tray"
    />,
  );
}

describe("ChangeTray DOM 계약", () => {
  it.each(DOM_CONTRACT)("$attribute 가 $on 에 붙는다", ({ attribute }) => {
    const { container } = renderContractTray();
    expect(container.querySelector(`[${attribute}]`)).not.toBeNull();
  });

  it('항목은 충돌일 때만 data-conflict="true", 요약 줄은 data-ok 가 통과 여부', () => {
    renderContractTray();
    expect(
      screen
        .getAllByTestId("tray-item")
        .map(item => item.getAttribute("data-conflict")),
    ).toEqual([null, "true", null]);
    const summary = screen.getByTestId("tray-summary");
    expect(
      Array.from(summary.querySelectorAll("li")).map(item => [
        item.textContent,
        item.getAttribute("data-ok"),
      ]),
    ).toEqual([
      ["✓통과검증", "true"],
      ["✗문제크기", "false"],
    ]);
  });
});
