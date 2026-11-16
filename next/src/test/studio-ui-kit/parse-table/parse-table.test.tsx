import { fireEvent, render, screen } from "@testing-library/react";
import {
  ParseTable,
  type ParseTableLabels,
} from "@/components/studio-ui-kit/parse-table/parse-table";

const TABLE_HTML =
  "<table><thead><tr><th>이름</th></tr></thead><tbody><tr><td>값</td><td><img alt='도장'></td></tr></tbody></table>";

const labels: ParseTableLabels = {
  region: "표",
  image: alt => `[그림 ${alt}]`,
};

describe("ParseTable", () => {
  it("id 를 주면 콜백이 id 를 받는다", () => {
    const activated: unknown[][] = [];
    const unrenderable: unknown[][] = [];
    const { rerender } = render(
      <ParseTable
        id="t1"
        html={TABLE_HTML}
        labels={labels}
        onActivate={(...args) => activated.push(args)}
        onUnrenderable={(...args) => unrenderable.push(args)}
      />,
    );
    fireEvent.click(screen.getByText("값"));
    expect(activated).toEqual([["t1"]]);
    rerender(
      <ParseTable
        id="t1"
        html="<p>표 아님</p>"
        labels={labels}
        onActivate={(...args) => activated.push(args)}
        onUnrenderable={(...args) => unrenderable.push(args)}
      />,
    );
    expect(unrenderable).toEqual([["t1"]]);
  });

  it("id 가 없으면 콜백을 인자 없이 부른다", () => {
    const activated: unknown[][] = [];
    const unrenderable: unknown[][] = [];
    const { rerender } = render(
      <ParseTable
        html={TABLE_HTML}
        labels={labels}
        onActivate={(...args: unknown[]) => activated.push(args)}
        onUnrenderable={(...args: unknown[]) => unrenderable.push(args)}
      />,
    );
    fireEvent.click(screen.getByText("값"));
    expect(activated).toEqual([[]]);
    rerender(
      <ParseTable
        html=""
        labels={labels}
        onActivate={(...args: unknown[]) => activated.push(args)}
        onUnrenderable={(...args: unknown[]) => unrenderable.push(args)}
      />,
    );
    expect(unrenderable).toEqual([[]]);
  });

  it("콜백이 없으면 눌러도·그릴 수 없어도 아무 일이 없다", () => {
    const { container, rerender } = render(
      <ParseTable id="t1" html={TABLE_HTML} labels={labels} />,
    );
    fireEvent.click(screen.getByText("값"));
    rerender(<ParseTable id="t1" html="<p>x</p>" labels={labels} />);
    expect(container.innerHTML).toBe("");
  });

  it("그림 자리에 labels.image 문구를 그린다", () => {
    render(<ParseTable html={TABLE_HTML} labels={labels} />);
    expect(screen.getByText("[그림 도장]")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("같은 html·같은 labels.image 이면 labels 객체가 바뀌어도 다시 알리지 않는다", () => {
    const unrenderable: unknown[][] = [];
    const onUnrenderable = (...args: unknown[]) => unrenderable.push(args);
    const { rerender } = render(
      <ParseTable
        html="<p>x</p>"
        labels={labels}
        onUnrenderable={onUnrenderable}
      />,
    );
    rerender(
      <ParseTable
        html="<p>x</p>"
        labels={{ ...labels, region: "다른 이름" }}
        onUnrenderable={onUnrenderable}
      />,
    );
    expect(unrenderable).toEqual([[]]);
  });

  it("testId 가 없으면 testid 를 붙이지 않고, 있으면 루트에 붙인다", () => {
    const { container, rerender } = render(
      <ParseTable html={TABLE_HTML} labels={labels} />,
    );
    expect(container.querySelectorAll("[data-testid]")).toHaveLength(0);
    rerender(<ParseTable html={TABLE_HTML} labels={labels} testId="parse" />);
    expect(screen.getByTestId("parse")).toBe(screen.getByRole("region"));
  });

  it("나머지 div props 는 루트로 가고 내부 속성·className 이 합쳐진다", () => {
    render(
      <ParseTable
        html={TABLE_HTML}
        labels={labels}
        role="presentation"
        tabIndex={-1}
        aria-label="덮기"
        data-extra="x"
        className="mt-2"
      />,
    );
    const region = screen.getByRole("region", { name: "표" });
    expect(region).toHaveAttribute("data-extra", "x");
    expect(region.tabIndex).toBe(0);
    expect(region.className.endsWith(" mt-2")).toBe(true);
  });
});

describe("ParseTable DOM 계약", () => {
  const CONTRACT = [
    ["role", "region"],
    ["aria-label", "표"],
    ["tabindex", "0"],
  ] as const;

  it.each(CONTRACT)("루트 %s=%s", (name, value) => {
    render(<ParseTable html={TABLE_HTML} labels={labels} />);
    expect(screen.getByRole("region")).toHaveAttribute(name, value);
  });

  it("그리는 태그는 table 구조 태그뿐이다(링크·스크립트·이미지 없음)", () => {
    render(
      <ParseTable
        html="<table><tr><td><a href='x'>a</a><script>1</script><img alt='i'></td></tr></table>"
        labels={labels}
      />,
    );
    expect(
      screen.getByRole("region").querySelectorAll("a, script, img"),
    ).toHaveLength(0);
  });
});
