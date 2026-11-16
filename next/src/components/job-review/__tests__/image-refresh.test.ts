import { describe, expect, it } from "vitest";

import {
  IMAGE_REFRESH_COOLDOWN_MS,
  createRefreshGate,
  failedImageUrl,
  fileRefOfImage,
} from "../image-refresh";
import type { FileEntry } from "../job-review-state";

function entry(imageUrls: (string | null)[]): FileEntry {
  return {
    fileId: "f",
    name: "a.pdf",
    status: "ready",
    numPages: imageUrls.length,
    imageUrls,
    parse: {},
    parseChunks: {},
  };
}

function element(localName: string, attributes: Record<string, string>) {
  return {
    localName,
    getAttribute: (name: string) => attributes[name] ?? null,
  };
}

describe("failedImageUrl", () => {
  it("img 는 src, SVG image 는 href(없으면 xlink:href) 속성 값을 그대로 읽는다", () => {
    expect(
      failedImageUrl(element("img", { src: "https://x/1.png?s=a b" })),
    ).toBe("https://x/1.png?s=a b");
    expect(failedImageUrl(element("image", { href: "https://x/2.png" }))).toBe(
      "https://x/2.png",
    );
    expect(
      failedImageUrl(element("image", { "xlink:href": "https://x/3.png" })),
    ).toBe("https://x/3.png");
  });

  it("이미지가 아니거나 URL 이 없으면 null", () => {
    expect(failedImageUrl(null)).toBeNull();
    expect(failedImageUrl(element("script", { src: "https://x/a.js" }))).toBe(
      null,
    );
    expect(failedImageUrl(element("img", {}))).toBeNull();
    expect(failedImageUrl(element("img", { src: "" }))).toBeNull();
  });
});

describe("fileRefOfImage", () => {
  const files = {
    file_a: entry(["https://x/a1", null, "https://x/a3"]),
    file_b: entry(["https://x/b1"]),
  };

  it("그 URL 을 페이지 이미지로 가진 파일을 찾는다", () => {
    expect(fileRefOfImage(files, "https://x/a3")).toBe("file_a");
    expect(fileRefOfImage(files, "https://x/b1")).toBe("file_b");
  });

  it("이 화면의 페이지 이미지가 아니거나 빈 URL 이면 null", () => {
    expect(fileRefOfImage(files, "https://other/figure.png")).toBeNull();
    expect(fileRefOfImage(files, "")).toBeNull();
  });
});

describe("createRefreshGate", () => {
  it("같은 파일은 쉬는 시간이 지나야 다시 통과한다", () => {
    const gate = createRefreshGate(1000);
    expect(gate("file_a", 0)).toBe(true);
    expect(gate("file_a", 999)).toBe(false);
    expect(gate("file_a", 1000)).toBe(true);
    expect(gate("file_a", 1500)).toBe(false);
  });

  it("파일마다 따로 센다", () => {
    const gate = createRefreshGate(1000);
    expect(gate("file_a", 0)).toBe(true);
    expect(gate("file_b", 10)).toBe(true);
    expect(gate("file_a", 20)).toBe(false);
  });

  it("기본 쉬는 시간은 IMAGE_REFRESH_COOLDOWN_MS", () => {
    const gate = createRefreshGate();
    expect(gate("file_a", 0)).toBe(true);
    expect(gate("file_a", IMAGE_REFRESH_COOLDOWN_MS - 1)).toBe(false);
    expect(gate("file_a", IMAGE_REFRESH_COOLDOWN_MS)).toBe(true);
  });
});
