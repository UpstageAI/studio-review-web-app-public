import { fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  InstructCitations,
  type CitationState,
  type InstructMarkdownLabels,
} from "@/components/studio-ui-kit/instruct-markdown/instruct-citations";
import { InstructMarkdown } from "@/components/studio-ui-kit/instruct-markdown/instruct-markdown";

const labels: InstructMarkdownLabels = {
  citation: index => `Citation ${index}`,
  noLocation: "No location",
  image: alt => `Image: ${alt}`,
};

interface Calls {
  selects: number[];
  hovers: (number | null)[];
}

/** 인용 3 은 위치가 없다. */
const stateOf =
  (selected: number | null) =>
  (index: number): CitationState => ({
    disabled: index === 3,
    selected: index === selected,
  });

function withCitations(
  text: string,
  {
    selected = null,
    testId,
  }: { selected?: number | null; testId?: string } = {},
) {
  const calls: Calls = { selects: [], hovers: [] };
  const view = render(
    <TooltipProvider>
      <InstructCitations
        getCitationState={stateOf(selected)}
        onCitationSelect={index => calls.selects.push(index)}
        onCitationHover={index => calls.hovers.push(index)}
        labels={labels}
        testId={testId}
      >
        <InstructMarkdown text={text} fallback={<p>loading</p>} />
      </InstructCitations>
    </TooltipProvider>,
  );
  return { ...view, calls };
}

const chips = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>("[data-citation]"));

describe("InstructMarkdown", () => {
  it("본문 모듈을 불러오는 동안 fallback 을 보이고 이어 본문을 그린다", async () => {
    const { container } = render(
      <InstructMarkdown text="본문 글자" fallback={<p>loading</p>} />,
    );
    // 이 파일의 첫 렌더라 본문 모듈은 아직 로드 전이다.
    expect(screen.getByText("loading")).toBeInTheDocument();
    expect(screen.queryByText("본문 글자")).toBeNull();
    expect(await screen.findByText("본문 글자")).toBeInTheDocument();
    expect(screen.queryByText("loading")).toBeNull();
    expect(container.firstElementChild?.tagName).toBe("DIV");
  });

  it("className·나머지 div props 는 루트로 간다", async () => {
    const { container } = render(
      <InstructMarkdown text="글" className="extra" aria-label="body" />,
    );
    await screen.findByText("글");
    const root = container.firstElementChild!;
    expect(root.getAttribute("aria-label")).toBe("body");
    expect(root.className.split(" ")).toContain("extra");
  });
});

describe("InstructMarkdown + InstructCitations", () => {
  it("두 형식의 표식이 칩이 되고 testId 접미 -citation 이 붙는다", async () => {
    const { container } = withCitations("가【†1】 나[†2]", { testId: "x" });
    await screen.findAllByTestId("x-citation");
    expect(chips(container).map(chip => chip.textContent)).toEqual(["1", "2"]);
    expect(screen.queryByText(/†/)).toBeNull();
  });

  it("testId 가 없으면 칩에 testid 가 없다", async () => {
    const { container } = withCitations("가【†1】");
    await screen.findByText("1");
    expect(chips(container)[0].hasAttribute("data-testid")).toBe(false);
  });

  it("누르면 onCitationSelect, 가리키면 onCitationHover(떠나면 null)", async () => {
    const { calls } = withCitations("가【†1】 나【†3】");
    const one = await screen.findByRole("button", { name: "Citation 1" });
    fireEvent.click(one);
    fireEvent.mouseEnter(one);
    fireEvent.mouseLeave(one);
    const three = screen.getByRole("button", { name: "Citation 3" });
    fireEvent.click(three);
    fireEvent.focus(three);
    expect(calls).toEqual({ selects: [1], hovers: [1, null] });
  });

  it("이미지는 labels.image 문구로 보인다", async () => {
    withCitations("![도장](https://example.com/a.png)");
    expect(await screen.findByText("Image: 도장")).toBeInTheDocument();
  });
});

describe("InstructMarkdown (InstructCitations 없음)", () => {
  it("인용 표식을 지우고 글만 그린다", async () => {
    const { container } = render(
      <InstructMarkdown text="가【†1】 나[†2] 다" />,
    );
    await screen.findByText(/가/);
    expect(container.textContent).toBe("가 나 다");
    expect(chips(container)).toHaveLength(0);
    expect(container.querySelector("button")).toBeNull();
  });

  it("모델이 직접 쓴 #cite- 링크는 링크 없이 글자만", async () => {
    const { container } = render(
      <InstructMarkdown text="[근거](#cite-4) 끝" />,
    );
    await screen.findByText(/끝/);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toBe("근거 끝");
  });

  it("이미지는 alt 글자만 보인다", async () => {
    render(<InstructMarkdown text="![도장](https://example.com/a.png)" />);
    expect(await screen.findByText("도장")).toBeInTheDocument();
  });
});

describe("InstructMarkdown DOM 계약", () => {
  const CONTRACT = [
    [1, "data-citation", "1"],
    [2, "data-selected", "true"],
    [2, "aria-pressed", "true"],
    [1, "aria-pressed", "false"],
    [3, "aria-disabled", "true"],
  ] as const;

  it.each(CONTRACT)("칩 %s 의 %s=%s", async (index, name, value) => {
    const { container } = withCitations("가【†1】 나【†2】 다【†3】", {
      selected: 2,
    });
    await screen.findByText("1");
    const chip = chips(container).find(
      element => element.getAttribute("data-citation") === String(index),
    )!;
    expect(chip).toHaveAttribute(name, value);
  });

  it("선택이 바뀌어도 칩 노드는 다시 마운트되지 않는다", async () => {
    const element = (selected: number | null) => (
      <TooltipProvider>
        <InstructCitations
          getCitationState={stateOf(selected)}
          onCitationSelect={() => {}}
          labels={labels}
        >
          <InstructMarkdown text="가【†1】 나【†2】" />
        </InstructCitations>
      </TooltipProvider>
    );
    const { container, rerender } = render(element(null));
    await screen.findByText("1");
    const before = chips(container);
    rerender(element(1));
    const after = chips(container);
    after.forEach((chip, index) => expect(chip).toBe(before[index]));
    expect(after[0]).toHaveAttribute("data-selected", "true");
  });
});
