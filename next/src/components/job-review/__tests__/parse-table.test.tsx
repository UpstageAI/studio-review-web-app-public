import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { snapshotHtml } from "@/test/dom-snapshot";
import { ParseTable } from "../parse-table";

const TEST_ID = "job-review-parse-table";

const TABLE_HTML = [
  "<table>",
  "<thead><tr><th colspan='2'>품목</th><th>금액</th></tr></thead>",
  "<tbody>",
  "<tr><td rowspan='2'>A</td><td>볼트</td><td>1,000</td></tr>",
  "<tr><td><img src='x.png' alt='도장'></td><td>2,000</td></tr>",
  "</tbody>",
  "</table>",
].join("");

interface Calls {
  activated: string[];
  unrenderable: string[];
}

const imageLabel = (alt: string) => `그림: ${alt}`;

function setup(html = TABLE_HTML, id = "parse:1:p1-1") {
  const calls: Calls = { activated: [], unrenderable: [] };
  const onActivate = (value: string) => calls.activated.push(value);
  const onUnrenderable = (value: string) => calls.unrenderable.push(value);
  const element = (nextHtml: string) => (
    <ParseTable
      id={id}
      html={nextHtml}
      imageLabel={imageLabel}
      regionLabel="표 영역"
      onActivate={onActivate}
      onUnrenderable={onUnrenderable}
    />
  );
  const view = render(element(html));
  return {
    ...view,
    calls,
    rerenderWith: (nextHtml: string) => view.rerender(element(nextHtml)),
  };
}

describe("ParseTable", () => {
  it("머리·colspan/rowspan·그림 대체 글자가 든 표를 그린다", () => {
    setup();
    expect(snapshotHtml(screen.getByTestId(TEST_ID))).toMatchSnapshot();
  });

  it("영역은 이름 있는 region 이고 초점을 받는다", () => {
    setup();
    const region = screen.getByRole("region", { name: "표 영역" });
    expect(region).toBe(screen.getByTestId(TEST_ID));
    expect(region.tabIndex).toBe(0);
  });

  it("영역을 누르면 onActivate(id)", () => {
    const { calls } = setup();
    fireEvent.click(screen.getByText("볼트"));
    expect(calls.activated).toEqual(["parse:1:p1-1"]);
  });

  it("영역 안 글자를 고른 상태의 클릭은 onActivate 를 부르지 않는다", () => {
    const { calls } = setup();
    const cell = screen.getByText("볼트");
    const range = document.createRange();
    range.selectNodeContents(cell);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent.click(cell);
    selection.removeAllRanges();
    expect(calls.activated).toEqual([]);
  });

  it("영역 밖 글자를 고른 상태의 클릭은 onActivate 를 부른다", () => {
    const outside = document.createElement("p");
    outside.textContent = "바깥 글자";
    document.body.append(outside);
    const { calls } = setup();
    const range = document.createRange();
    range.selectNodeContents(outside);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent.click(screen.getByText("볼트"));
    selection.removeAllRanges();
    outside.remove();
    expect(calls.activated).toEqual(["parse:1:p1-1"]);
  });

  it("script·이벤트 속성·링크는 그리지 않는다", () => {
    setup(
      "<table><tr><td><script>alert(1)</script><a href='javascript:x' onclick='x()'>링크</a></td></tr></table>",
    );
    const region = screen.getByTestId(TEST_ID);
    expect(
      region.querySelectorAll("script, a, [onclick], [href]"),
    ).toHaveLength(0);
    expect(region.textContent).toBe("링크");
  });

  it("표가 없는 html 은 아무것도 그리지 않고 onUnrenderable(id) 를 한 번 부른다", () => {
    const { container, calls } = setup("<p>표 아님</p>");
    expect(container.innerHTML).toBe("");
    expect(calls.unrenderable).toEqual(["parse:1:p1-1"]);
  });

  it("같은 html·같은 함수로 다시 그려도 다시 알리지 않는다", () => {
    const { calls, rerenderWith } = setup("<p>표 아님</p>");
    rerenderWith("<p>표 아님</p>");
    expect(calls.unrenderable).toEqual(["parse:1:p1-1"]);
  });

  it("그릴 수 없던 html 이 표로 바뀌면 표를 그리고 더 알리지 않는다", () => {
    const { calls, rerenderWith } = setup("<p>표 아님</p>");
    rerenderWith(TABLE_HTML);
    expect(screen.getByTestId(TEST_ID)).not.toBeNull();
    expect(calls.unrenderable).toEqual(["parse:1:p1-1"]);
  });
});
