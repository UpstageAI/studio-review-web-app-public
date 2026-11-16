import { renderToStaticMarkup } from "react-dom/server";

import {
  PARSE_TABLE_MAX_DEPTH,
  tableNodesFromHtml,
} from "@/components/studio-ui-kit/parse-table/parse-table-html";

const labels = { image: (alt: string) => `그림: ${alt}` };

/** 변환 결과 HTML. 표로 그리지 못하면 `null`. */
function render(html: string): string | null {
  const nodes = tableNodesFromHtml(html, labels);
  return nodes === null ? null : renderToStaticMarkup(nodes);
}

const UNSAFE = /\son\w+=|href=|src=|style=|javascript:/i;

describe("tableNodesFromHtml", () => {
  it("기본 표 구조를 그린다", () => {
    expect(
      render(
        "<table><thead><tr><th>이름</th></tr></thead><tbody><tr><td>값</td></tr></tbody></table>",
      ),
    ).toBe(
      "<table><thead><tr><th>이름</th></tr></thead><tbody><tr><td>값</td></tr></tbody></table>",
    );
  });

  it("colspan·rowspan 은 1 이상 정수만, 상한으로 잘라 넘긴다", () => {
    expect(
      render(
        '<table><tr><td colspan="2" rowspan="3">a</td><th COLSPAN=" 4 ">b</th></tr></table>',
      ),
    ).toBe(
      '<table><tr><td colSpan="2" rowSpan="3">a</td><th colSpan="4">b</th></tr></table>',
    );
    expect(
      render(
        '<table><tr><td colspan="0" rowspan="-1">a</td><td colspan="abc">b</td><td colspan="99999" rowspan="99999">c</td></tr></table>',
      ),
    ).toBe(
      '<table><tr><td>a</td><td>b</td><td colSpan="1000" rowSpan="65534">c</td></tr></table>',
    );
  });

  it("실데이터 모양: 표의 id·style 은 버리고 칸 안의 중첩 표는 유지한다", () => {
    const html =
      "<table id='1' style='font-size:20px'><thead><tr><td colspan='2'>외래 진료비</td></tr></thead>" +
      "<tbody><tr><td><table id='2'><tr><td>교정료</td></tr></table></td><td>1,000</td></tr></tbody></table>";
    const out = render(html)!;
    expect(out).toBe(
      '<table><thead><tr><td colSpan="2">외래 진료비</td></tr></thead>' +
        "<tbody><tr><td><table><tr><td>교정료</td></tr></table></td><td>1,000</td></tr></tbody></table>",
    );
    expect(out).not.toMatch(/\sid=|style=/);
  });

  it("스크립트·스타일·iframe 은 내용까지 사라지고 이벤트·링크·src 속성은 남지 않는다", () => {
    const out = render(
      '<table onclick="alert(1)"><tr>' +
        '<td onclick="window.x=1"><script>window.x=1</script>a</td>' +
        "<td><style>td{color:red}</style>b</td>" +
        '<td><iframe src="https://example.com">c</iframe>d</td>' +
        '<td><a href="javascript:window.x=1" onmouseover="x">링크</a></td>' +
        '<td><img src="x" onerror="window.x=1"></td>' +
        "</tr></table>",
    )!;
    expect(out).toBe(
      "<table><tr><td>a</td><td>b</td><td>d</td><td>링크</td><td></td></tr></table>",
    );
    expect(out).not.toMatch(UNSAFE);
    expect(out).not.toMatch(/window\.x|color:red|<script|<style|<iframe|<a\s/);
  });

  it("그림은 만들지 않고 alt 만 흐린 글자로 보인다", () => {
    const out = render(
      '<table><tr><td><figure><img alt=" 서명 " src="x" onerror="window.x=1" data-coord="top-left:(1,2)"></figure></td></tr></table>',
    )!;
    expect(out).toBe(
      '<table><tr><td><span class="text-muted-foreground">그림: 서명</span></td></tr></table>',
    );
    expect(out).not.toContain("<img");
    expect(out).not.toMatch(UNSAFE);
  });

  it("그 밖의 태그는 벗기고 글자·br 만 남기며 주석은 버린다", () => {
    expect(
      render(
        "<table><tr><td><p class='x'>첫<br>줄</p><!-- 주석 --><b>굵게</b> &lt;tag&gt;</td></tr></table>",
      ),
    ).toBe("<table><tr><td>첫<br/>줄굵게 &lt;tag&gt;</td></tr></table>");
  });

  it("표 구조 태그가 표 밖에 있으면 벗긴다", () => {
    expect(
      render("<div><td>a</td></div><table><tr><td>b</td></tr></table>"),
    ).toBe("a<table><tr><td>b</td></tr></table>");
  });

  it("깨진 입력에서도 예외 없이 결과가 나오거나 null", () => {
    for (const html of [
      "<table><tr><td>열림",
      "<table><tr><<td>a</td></tr></table>",
      '<table><tr><td>a</tdlspan="2"><td>b</td></tr></table>',
      "<table",
      "</table>",
    ]) {
      expect(() => render(html)).not.toThrow();
      const out = render(html);
      if (out !== null) expect(out).not.toMatch(UNSAFE);
    }
    expect(render("<table><tr><td>열림")).toBe(
      "<table><tr><td>열림</td></tr></table>",
    );
  });

  it("표가 없으면 null", () => {
    expect(render("<p>x</p>")).toBeNull();
    expect(render("")).toBeNull();
    expect(render("글자만")).toBeNull();
  });

  it("깊이 상한을 넘는 표는 글자만 남긴다", () => {
    // 상한 깊이까지의 표는 그대로.
    const within = render(
      `${"<table><tr><td>".repeat(PARSE_TABLE_MAX_DEPTH)}x${"</td></tr></table>".repeat(PARSE_TABLE_MAX_DEPTH)}`,
    )!;
    expect(within.match(/<table>/g)).toHaveLength(PARSE_TABLE_MAX_DEPTH);

    const over = render(
      `${"<table><tr><td>".repeat(PARSE_TABLE_MAX_DEPTH)}<table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>${"</td></tr></table>".repeat(PARSE_TABLE_MAX_DEPTH)}`,
    )!;
    expect(over.match(/<table>/g)).toHaveLength(PARSE_TABLE_MAX_DEPTH);
    expect(over).toContain("<td>a b \nc \n</td>");
  });
});
