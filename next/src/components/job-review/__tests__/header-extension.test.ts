import { describe, expect, it } from "vitest";
import {
  useNoHeaderExtension,
  type JobReviewHeaderExtensionInput,
} from "../header-extension";

const INPUT: JobReviewHeaderExtensionInput = {
  collectionId: "c1",
  collectionName: "Collection",
  jobId: "j1",
  firstFileName: "a.pdf",
  ready: true,
  dirty: true,
  leaveMessage: "leave?",
};

describe("useNoHeaderExtension", () => {
  it("더 그리는 것 없이 완료 뒤 다음으로 넘기지 않는다", () => {
    const extension = useNoHeaderExtension(INPUT);
    expect(extension.extras).toBeNull();
    expect(extension.advancesAfterComplete).toBe(false);
    expect(extension.onCompleted("a.pdf")).toBeUndefined();
  });

  it("입력이 달라도 같은 객체를 돌려준다", () => {
    expect(useNoHeaderExtension(INPUT)).toBe(
      useNoHeaderExtension({ ...INPUT, ready: false, dirty: false }),
    );
  });
});
