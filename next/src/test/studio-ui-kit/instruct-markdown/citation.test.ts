import {
  citationIndexOf,
  citationMarkdown,
  stripCitationMarkers,
} from "@/components/studio-ui-kit/instruct-markdown/citation";

describe("citationMarkdown", () => {
  it("인용 표식을 #cite- 링크로 바꾼다", () => {
    expect(citationMarkdown("a【†1】 b[†12]")).toBe(
      "a[†1](#cite-1) b[†12](#cite-12)",
    );
    expect(citationIndexOf("#cite-12")).toBe(12);
    expect(citationIndexOf("https://example.com")).toBeNull();
    expect(citationIndexOf("#cite-x")).toBeNull();
  });

  it("표식이 없으면 그대로다", () => {
    expect(citationMarkdown("표식 없음 [링크](https://a)")).toBe(
      "표식 없음 [링크](https://a)",
    );
  });
});

describe("citationIndexOf", () => {
  it("접두가 없거나 숫자가 아니면 null", () => {
    expect(citationIndexOf(undefined)).toBeNull();
    expect(citationIndexOf("cite-1")).toBeNull();
    expect(citationIndexOf("#cite-")).toBeNull();
    expect(citationIndexOf("#cite-1a")).toBeNull();
    expect(citationIndexOf("#cite-0")).toBe(0);
  });
});

describe("stripCitationMarkers", () => {
  it("두 형식의 표식을 모두 지운다", () => {
    expect(stripCitationMarkers("가【†1】 나[†23] 다")).toBe("가 나 다");
  });

  it("번호가 없는 비슷한 글자는 남긴다", () => {
    expect(stripCitationMarkers("【†】 [†x] [1]")).toBe("【†】 [†x] [1]");
  });
});
