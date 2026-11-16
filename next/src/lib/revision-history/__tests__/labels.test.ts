import { describe, expect, it } from "vitest";

import type { ReviewStep } from "@/lib/review-model";

import { singleJob } from "../../review-model/__tests__/fixtures/builders";
import { fieldLabel } from "../labels";

const { doc } = singleJob();
const EXTRACT = doc.steps.st_extract!;

describe("fieldLabel", () => {
  const content = { amount: 1, rate: 2, lines: [{ qty: 1 }, { qty: 2 }] };

  it("schema title 이 있으면 title, 없으면 키", () => {
    expect(fieldLabel(EXTRACT, content, ["amount"])).toEqual(["Amount"]);
    expect(fieldLabel(EXTRACT, content, ["rate"])).toEqual(["rate"]);
  });

  it("배열 위치는 #n+1", () => {
    expect(fieldLabel(EXTRACT, content, ["lines", "1", "qty"])).toEqual([
      "lines",
      "#2",
      "qty",
    ]);
  });

  it("서버 저장 래퍼([{…}])의 앞 0 은 숨기고 schema 는 래퍼 밖 경로로 찾는다", () => {
    expect(fieldLabel(EXTRACT, [content], ["0", "amount"])).toEqual(["Amount"]);
    expect(fieldLabel(EXTRACT, [content], ["0", "lines", "0"])).toEqual([
      "lines",
      "#1",
    ]);
  });

  it("schema 가 없는 Step·여러 레코드 배열은 키와 위치로", () => {
    const bare: ReviewStep = {
      config_id: "c",
      name: "n",
      type: "information-extract",
    };
    const records = [{ 금액: "1" }, { 금액: "2" }];
    expect(fieldLabel(bare, records, ["1", "금액"])).toEqual(["#2", "금액"]);
    expect(fieldLabel(null, [{ a: 1 }], ["0", "a"])).toEqual(["a"]);
    expect(fieldLabel(undefined, "green", [])).toEqual([]);
  });

  it("값에서 경로가 끊기면 숫자 토큰을 위치로 본다", () => {
    expect(fieldLabel(EXTRACT, {}, ["lines", "0", "price"])).toEqual([
      "lines",
      "#1",
      "price",
    ]);
  });
});
