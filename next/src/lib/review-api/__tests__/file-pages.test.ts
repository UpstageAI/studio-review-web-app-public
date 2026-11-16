import { describe, expect, it } from "vitest";

import { filePagesReady } from "../file-pages";

const page = (image_url: string | null) => ({ image_url });

describe("filePagesReady", () => {
  it("READY 면 준비됨", () => {
    expect(
      filePagesReady({ id: "f", status: "READY", num_pages: 0, pages: [] }),
    ).toBe(true);
  });

  it("READY 가 아니어도 모든 페이지에 이미지가 있으면 준비됨", () => {
    expect(
      filePagesReady({
        id: "f",
        status: "UPLOADED",
        num_pages: 2,
        pages: [page("https://img.test/1"), page("https://img.test/2")],
      }),
    ).toBe(true);
  });

  it("페이지가 없거나 이미지가 빠진 페이지가 있으면 준비 중", () => {
    expect(
      filePagesReady({ id: "f", status: "UPLOADED", num_pages: 1, pages: [] }),
    ).toBe(false);
    expect(
      filePagesReady({
        id: "f",
        status: "PROCESSING",
        num_pages: 2,
        pages: [page("https://img.test/1"), page(null)],
      }),
    ).toBe(false);
  });
});
