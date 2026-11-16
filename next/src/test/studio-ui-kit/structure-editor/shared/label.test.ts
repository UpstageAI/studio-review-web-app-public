import {
  labelCommit,
  normalizeLabel,
} from "@/components/studio-ui-kit/structure-editor/shared/label";

describe("normalizeLabel", () => {
  it("빈 문자열·공백뿐이면 null, 그 밖에는 그대로", () => {
    expect(normalizeLabel(null)).toBeNull();
    expect(normalizeLabel("")).toBeNull();
    expect(normalizeLabel("   ")).toBeNull();
    expect(normalizeLabel(" A ")).toBe(" A ");
  });
});

describe("labelCommit", () => {
  it("앞뒤 공백을 빼고 보낸다", () => {
    expect(labelCommit("  A  ", null)).toEqual({ value: "A" });
    expect(labelCommit(" B", "A")).toEqual({ value: "B" });
  });

  it("공백뿐이면 라벨 없음으로 보낸다", () => {
    expect(labelCommit("   ", "A")).toEqual({ value: null });
    expect(labelCommit("", "A")).toEqual({ value: null });
  });

  it("손대지 않은 입력은 보내지 않는다(서버 라벨에 공백이 있어도)", () => {
    expect(labelCommit("A", "A")).toBeNull();
    expect(labelCommit(" A ", " A ")).toBeNull();
    expect(labelCommit("", null)).toBeNull();
    expect(labelCommit("  ", "  ")).toBeNull();
  });

  it("공백을 뺀 값이 지금 라벨과 같으면 보내지 않는다", () => {
    expect(labelCommit("A  ", "A")).toBeNull();
    expect(labelCommit("   ", null)).toBeNull();
    expect(labelCommit("   ", "")).toBeNull();
  });

  it("공백이 붙은 서버 라벨을 고치면 공백 없는 값을 보낸다", () => {
    expect(labelCommit("A", " A ")).toEqual({ value: "A" });
  });
});
