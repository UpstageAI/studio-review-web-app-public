import { fireEvent, render, screen } from "@testing-library/react";
import {
  ReviewActions,
  type ReviewActionsPrimary,
  type ReviewActionsProps,
} from "@/components/studio-ui-kit/review-actions/review-actions";

const LABELS = { tray: "변경", save: "저장", saving: "저장 중" };

function props(
  overrides: Partial<ReviewActionsProps> = {},
  primary: Partial<ReviewActionsPrimary> = {},
): ReviewActionsProps {
  return {
    changeCount: 0,
    trayOpen: false,
    onOpenTray: () => {},
    onSave: () => {},
    saveDisabled: false,
    saving: false,
    saveEmphasized: false,
    primary: { label: "완료", disabled: false, onClick: () => {}, ...primary },
    labels: LABELS,
    ...overrides,
  };
}

describe("ReviewActions", () => {
  it("testId 만 주면 부위마다 접미 기본값을 붙인다", () => {
    render(<ReviewActions {...props({ changeCount: 2, testId: "ra" })} />);
    expect(screen.getByTestId("ra")).toHaveClass("flex", "flex-wrap");
    for (const id of [
      "ra-status",
      "ra-button-tray",
      "ra-change-count",
      "ra-button-save",
      "ra-button-primary",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });

  it("testIds 가 접미 규칙을 덮고, primary.testId 가 그보다 먼저다", () => {
    render(
      <ReviewActions
        {...props(
          {
            changeCount: 1,
            testId: "ra",
            testIds: { tray: "open", save: "save", primary: "main" },
          },
          { testId: "done" },
        )}
      />,
    );
    expect(screen.getByTestId("open")).toHaveTextContent("변경");
    expect(screen.getByTestId("save")).toHaveTextContent("저장");
    expect(screen.getByTestId("done")).toHaveTextContent("완료");
    expect(screen.queryByTestId("main")).toBeNull();
    expect(screen.getByTestId("ra-status")).toBeInTheDocument();
    expect(screen.getByTestId("ra-change-count")).toBeInTheDocument();
  });

  it("testId·testIds 가 없으면 testid 를 붙이지 않는다", () => {
    const { container } = render(
      <ReviewActions {...props({ changeCount: 1 })} />,
    );
    expect(container.querySelector("[data-testid]")).toBeNull();
  });

  it("변경 수가 0 이면 배지가 없고, 있으면 변경 사항 버튼 안에 수를 보인다", () => {
    const { rerender } = render(<ReviewActions {...props({ testId: "ra" })} />);
    expect(screen.queryByTestId("ra-change-count")).toBeNull();
    rerender(<ReviewActions {...props({ testId: "ra", changeCount: 3 })} />);
    expect(screen.getByTestId("ra-button-tray")).toContainElement(
      screen.getByTestId("ra-change-count"),
    );
    expect(screen.getByTestId("ra-change-count")).toHaveTextContent("3");
  });

  it("변경 사항 버튼은 대화 상자를 여는 버튼이고 열림을 aria-expanded 로 알린다", () => {
    const calls: string[] = [];
    render(
      <ReviewActions
        {...props({
          testId: "ra",
          trayOpen: true,
          onOpenTray: () => calls.push("tray"),
        })}
      />,
    );
    const tray = screen.getByTestId("ra-button-tray");
    expect(tray).toHaveAttribute("aria-haspopup", "dialog");
    expect(tray).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(tray);
    expect(calls).toEqual(["tray"]);
  });

  it("저장 버튼: 강조·저장 중 글자·비활성·제목·단축키·설명 id", () => {
    const calls: string[] = [];
    const { rerender } = render(
      <ReviewActions
        {...props({
          testId: "ra",
          onSave: () => calls.push("save"),
          saveEmphasized: true,
          saveTitle: "저장 (S)",
          saveKeyShortcuts: "Meta+S",
        })}
      />,
    );
    const save = screen.getByTestId("ra-button-save");
    expect(save).toHaveAttribute("data-variant", "default");
    expect(save).toHaveAttribute("title", "저장 (S)");
    expect(save).toHaveAttribute("aria-keyshortcuts", "Meta+S");
    expect(save).not.toHaveAttribute("aria-describedby");
    fireEvent.click(save);
    expect(calls).toEqual(["save"]);

    rerender(
      <ReviewActions
        {...props({
          testId: "ra",
          saving: true,
          saveDisabled: true,
          saveDescribedBy: "hint",
        })}
      />,
    );
    const busy = screen.getByTestId("ra-button-save");
    expect(busy).toHaveAttribute("data-variant", "outline");
    expect(busy).toHaveTextContent("저장 중");
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-describedby", "hint");
    expect(busy).not.toHaveAttribute("title");
  });

  it.each([
    ["error", "text-destructive"],
    ["muted", "text-muted-foreground"],
    ["ok", ""],
  ] as const)("상태 문구 tone %s 의 class 는 %j", (tone, className) => {
    render(
      <ReviewActions
        {...props({ testId: "ra", status: { text: "상태", tone } })}
      />,
    );
    const text = screen.getByText("상태");
    expect(text.getAttribute("class")).toBe(className);
    expect(text).not.toHaveAttribute("title");
  });

  it("상태 문구가 없어도 알림 영역은 남고, title 은 넘길 때만 붙는다", () => {
    const { rerender } = render(<ReviewActions {...props({ testId: "ra" })} />);
    const live = screen.getByTestId("ra-status");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toBeEmptyDOMElement();
    rerender(
      <ReviewActions
        {...props({
          testId: "ra",
          status: { text: "저장됨", tone: "ok", title: "버전 7" },
        })}
      />,
    );
    expect(screen.getByText("저장됨")).toHaveAttribute("title", "버전 7");
  });

  it("주 동작: variant·제목·단축키·data 속성을 넘긴 대로 붙이고 누르면 onClick", () => {
    const calls: string[] = [];
    const { rerender } = render(
      <ReviewActions
        {...props(
          { testId: "ra" },
          {
            title: "완료 (Enter)",
            keyShortcuts: "Meta+Enter",
            buttonProps: { "data-advance": "true", "data-save-first": "false" },
            onClick: () => calls.push("primary"),
          },
        )}
      />,
    );
    const primary = screen.getByTestId("ra-button-primary");
    expect(primary).toHaveAttribute("data-variant", "default");
    expect(primary).toHaveAttribute("title", "완료 (Enter)");
    expect(primary).toHaveAttribute("aria-keyshortcuts", "Meta+Enter");
    expect(primary).toHaveAttribute("data-advance", "true");
    expect(primary).toHaveAttribute("data-save-first", "false");
    fireEvent.click(primary);
    expect(calls).toEqual(["primary"]);

    rerender(
      <ReviewActions
        {...props(
          { testId: "ra" },
          { label: "다시 열기", variant: "outline", disabled: true },
        )}
      />,
    );
    const reopen = screen.getByTestId("ra-button-primary");
    expect(reopen).toHaveAttribute("data-variant", "outline");
    expect(reopen).toBeDisabled();
    expect(reopen).not.toHaveAttribute("title");
    expect(reopen).not.toHaveAttribute("aria-keyshortcuts");
    expect(reopen).not.toHaveAttribute("data-advance");
  });

  it("buttonProps 에는 data-testid 를 넣을 수 없고, 타입을 우회해 넣어도 내부 testid 가 이긴다", () => {
    // @ts-expect-error -- 맵에는 data-testid 를 넣을 수 없다(testId 로 넘긴다).
    const banned: ReviewActionsPrimary["buttonProps"] = { "data-testid": "x" };
    expect(banned).toBeDefined();
    const buttonProps = {
      "data-advance": "true",
      "data-testid": "host",
    } as unknown as ReviewActionsPrimary["buttonProps"];
    render(<ReviewActions {...props({ testId: "ra" }, { buttonProps })} />);
    const primary = screen.getByTestId("ra-button-primary");
    expect(primary).toHaveAttribute("data-advance", "true");
    expect(screen.queryByTestId("host")).toBeNull();
  });

  it("actions slot 은 상태 문구와 변경 사항 버튼 사이에 그대로 들어간다", () => {
    render(
      <ReviewActions
        {...props({
          testId: "ra",
          actions: (
            <>
              <button type="button" data-testid="slot-a" />
              <input type="file" data-testid="slot-b" />
            </>
          ),
        })}
      />,
    );
    expect(
      Array.from(screen.getByTestId("ra").children).map(child =>
        child.getAttribute("data-testid"),
      ),
    ).toEqual([
      "ra-status",
      "slot-a",
      "slot-b",
      "ra-button-tray",
      "ra-button-save",
      "ra-button-primary",
    ]);
  });

  it("루트는 호출자 속성을 받되 className 은 뒤에 합치고 testId 가 이긴다", () => {
    render(
      <ReviewActions
        {...props({ testId: "ra", className: "extra", title: "줄" })}
        data-testid="caller"
      />,
    );
    const root = screen.getByTestId("ra");
    expect(root).toHaveAttribute("title", "줄");
    expect(root.getAttribute("class")).toBe(
      "flex flex-wrap items-center gap-2 extra",
    );
    expect(screen.queryByTestId("caller")).toBeNull();
  });
});

/** Studio UI Kit item 문서의 "DOM 계약" 중 `review-actions` 행: 속성 · 붙는 요소 · 값. */
const DOM_CONTRACT = [
  { attribute: "aria-live", on: "상태 문구(`-status`)", value: "polite" },
  {
    attribute: "aria-haspopup",
    on: "변경 사항 버튼(`-button-tray`)",
    value: "dialog",
  },
  {
    attribute: "aria-expanded",
    on: "변경 사항 버튼(`-button-tray`)",
    value: "false",
  },
] as const;

describe("ReviewActions DOM 계약", () => {
  it.each(DOM_CONTRACT)(
    "$attribute 가 $on 에 $value 로 붙는다",
    ({ attribute, value }) => {
      const { container } = render(
        <ReviewActions {...props({ testId: "ra" })} />,
      );
      expect(
        container.querySelector(`[${attribute}]`)?.getAttribute(attribute),
      ).toBe(value);
    },
  );

  it("저장 상태 title 은 안쪽 span 에 붙는다(저장 완료를 span[title] 로 읽는다)", () => {
    render(
      <ReviewActions
        {...props({
          testId: "ra",
          status: { text: "저장됨", tone: "ok", title: "버전 1" },
        })}
      />,
    );
    expect(
      screen.getByTestId("ra-status").querySelector("span[title]"),
    ).toHaveTextContent("저장됨");
  });
});
