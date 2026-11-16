import parse, {
  Comment,
  domToReact,
  Element,
  ProcessingInstruction,
  Text,
  type DOMNode,
  type HTMLReactParserOptions,
} from "html-react-parser";
import { createElement, Fragment, type ReactNode } from "react";

// Parse 표 요소의 `content.html`(모델이 만든 HTML) → React 요소. 원문을 DOM 에 그대로 넣지 않고 허용 목록으로
// 다시 만든다. 모든 Element 를 `replace` 에서 직접 만들어 라이브러리의 기본 속성 전달(style 등)을 거치지 않으며,
// 넘기는 속성은 정수로 다시 읽은 `colSpan`·`rowSpan` 뿐이다. 브라우저에서 파싱은 비활성 문서(template)에서
// 일어나 스크립트 실행·리소스 로드가 없다.

/** 표 중첩 깊이 상한. 넘는 표는 표로 그리지 않고 글자만 남긴다. */
export const PARSE_TABLE_MAX_DEPTH = 6;

/** 브라우저가 `colspan`·`rowspan` 에 두는 상한과 같다. */
const COLSPAN_MAX = 1000;
const ROWSPAN_MAX = 65534;

/** 표 안에서만 그리는 구조 태그. `table` 은 따로 다룬다. */
const TABLE_PART_TAGS = new Set([
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "caption",
  "colgroup",
  "col",
]);

/** 글자를 담는 칸. 이 안은 다시 표 바깥 문맥이다(중첩 표만 다시 표로 그린다). */
const CELL_TAGS = new Set(["th", "td", "caption"]);

/** 자식까지 통째로 버리는 태그. */
const DROPPED_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "noscript",
  "template",
  "svg",
  "math",
  "link",
  "meta",
  "base",
  "head",
  "title",
  "form",
  "input",
  "button",
  "select",
  "textarea",
  "audio",
  "video",
  "source",
  "track",
  "canvas",
]);

export type TableNodeLabels = {
  /** 표 안 그림 자리에 보일 대체 글자(`alt` 를 받는다). */
  image: (alt: string) => string;
};

type Context = {
  /** 바깥에 그린 표의 수. */
  depth: number;
  /** 지금 자리가 표 구조 안(칸 바깥)인지. */
  inTable: boolean;
  /** 깊이 상한을 넘은 표 안 — 모든 태그를 벗기고 글자만 남긴다. */
  textOnly: boolean;
};

/** 속성 이름은 대소문자를 가리지 않는다(서버 파서는 이름을 소문자로 바꾸지 않는다). */
function attribute(element: Element, name: string): string | undefined {
  for (const [key, value] of Object.entries(element.attribs)) {
    if (key.toLowerCase() === name) return value;
  }
  return undefined;
}

/** 1 이상 정수만, 상한으로 자른다. 아니면 `undefined`(속성을 넘기지 않는다). */
function span(value: string | undefined, max: number): number | undefined {
  if (value === undefined) return undefined;
  const number = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(number) || number < 1) return undefined;
  return Math.min(number, max);
}

const empty = () => createElement(Fragment);

/**
 * 표 HTML → React 요소. 그린 결과에 `table` 이 하나도 없거나 변환 중 예외가 나면 `null`(호출처는 글자로 보인다).
 *
 * - 그리는 태그: `table` + 표 구조 태그 + `br`. 넘기는 속성: `td`·`th` 의 `colspan`·`rowspan` 만.
 * - 스크립트·스타일·임베드·폼 계열은 자식까지 버린다. `img` 는 만들지 않고 `alt` 만 흐린 글자로.
 * - 그 밖의 태그(`a`·`p`·`div`·`figure` …)는 벗기고 자식 글자만 남긴다. 주석·지시문은 버린다.
 */
export function tableNodesFromHtml(
  html: string,
  labels: TableNodeLabels,
): ReactNode | null {
  if (html === "") return null;
  let tables = 0;

  const optionsFor = (context: Context): HTMLReactParserOptions => {
    const options: HTMLReactParserOptions = {
      replace(node) {
        if (node instanceof Comment || node instanceof ProcessingInstruction) {
          return empty();
        }
        if (node instanceof Text) {
          // 표 구조 사이의 공백은 버린다(`tr` 등은 글자를 자식으로 둘 수 없다). 나머지 글자는 라이브러리가
          // 이스케이프해 넣는다.
          return context.inTable && node.data.trim() === ""
            ? empty()
            : undefined;
        }
        if (!(node instanceof Element)) return empty();
        const name = node.name.toLowerCase();
        if (DROPPED_TAGS.has(name)) return empty();

        const children = (next: Context) =>
          domToReact(node.children as DOMNode[], optionsFor(next));
        // 벗긴 태그는 문맥을 그대로 넘긴다(`<table><div><tr>` 의 `tr` 은 여전히 표 안).
        const unwrap = () => createElement(Fragment, null, children(context));

        if (name === "img") {
          const alt = attribute(node, "alt")?.trim();
          if (!alt) return empty();
          return createElement(
            "span",
            { className: "text-muted-foreground" },
            labels.image(alt),
          );
        }
        if (name === "br") return createElement("br");
        if (context.textOnly) {
          // 칸·행 경계는 공백·줄바꿈으로 남겨 글자가 붙지 않게 한다.
          if (CELL_TAGS.has(name)) {
            return createElement(Fragment, null, children(context), " ");
          }
          if (name === "tr") {
            return createElement(Fragment, null, children(context), "\n");
          }
          return unwrap();
        }
        if (name === "table") {
          if (context.depth >= PARSE_TABLE_MAX_DEPTH) {
            return createElement(
              Fragment,
              null,
              children({ ...context, inTable: false, textOnly: true }),
            );
          }
          tables += 1;
          return createElement(
            "table",
            null,
            children({
              depth: context.depth + 1,
              inTable: true,
              textOnly: false,
            }),
          );
        }
        if (TABLE_PART_TAGS.has(name) && context.inTable) {
          if (name === "col") return createElement("col");
          const inner = children({ ...context, inTable: !CELL_TAGS.has(name) });
          if (name === "td" || name === "th") {
            return createElement(
              name,
              {
                colSpan: span(attribute(node, "colspan"), COLSPAN_MAX),
                rowSpan: span(attribute(node, "rowspan"), ROWSPAN_MAX),
              },
              inner,
            );
          }
          return createElement(name, null, inner);
        }
        return unwrap();
      },
    };
    return options;
  };

  try {
    const nodes = parse(
      html,
      optionsFor({ depth: 0, inTable: false, textOnly: false }),
    );
    return tables > 0 ? createElement(Fragment, null, nodes) : null;
  } catch {
    return null;
  }
}
