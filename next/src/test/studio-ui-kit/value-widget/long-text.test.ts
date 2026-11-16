import {
  codePointCount,
  longTextPreview,
  utf8ByteLength,
} from "@/components/studio-ui-kit/value-widget/long-text";

describe("longTextPreview", () => {
  it("앞 max 글자 뒤에 …, 짧으면 그대로", () => {
    expect(longTextPreview("abc", 5)).toBe("abc");
    expect(longTextPreview("abcdef", 5)).toBe("abcde…");
    expect(longTextPreview("x".repeat(10_001)).length).toBe(201);
  });

  it("자르는 자리의 서로게이트 쌍을 깨지 않는다", () => {
    const text = `a${"😀".repeat(300)}`;
    const preview = longTextPreview(text, 4);
    expect(preview).toBe(`a${"😀".repeat(3)}…`);
    expect(Array.from(preview).every(char => char.length <= 2)).toBe(true);
    expect(longTextPreview("😀".repeat(3), 3)).toBe("😀".repeat(3));
  });
});

describe("codePointCount · utf8ByteLength", () => {
  it("서로게이트 쌍은 한 글자로 센다", () => {
    expect(codePointCount("")).toBe(0);
    expect(codePointCount("가나다")).toBe(3);
    expect(codePointCount(`a${"😀".repeat(2)}`)).toBe(3);
    expect(codePointCount("\udc00a")).toBe(2);
  });

  it("UTF-8 바이트 수", () => {
    expect(utf8ByteLength("abc")).toBe(3);
    expect(utf8ByteLength("가")).toBe(3);
    expect(utf8ByteLength("😀")).toBe(4);
  });
});
