import { pageDropRejectReason } from "@/components/studio-ui-kit/structure-editor/shared/drop";

describe("pageDropRejectReason", () => {
  it("없는 문서·잠긴 문서는 locked 가 그룹보다 먼저다", () => {
    expect(pageDropRejectReason(undefined, ["g1"])).toBe("locked");
    expect(pageDropRejectReason({ groupId: "g1", locked: true }, ["g2"])).toBe(
      "locked",
    );
  });

  it("끄는 페이지 그룹 중 하나라도 다르면 group", () => {
    expect(pageDropRejectReason({ groupId: "g1" }, ["g2"])).toBe("group");
    expect(pageDropRejectReason({ groupId: "g1" }, ["g1", "g2"])).toBe("group");
  });

  it("같은 그룹이고 잠기지 않았으면 null", () => {
    expect(pageDropRejectReason({ groupId: "g1" }, ["g1"])).toBeNull();
    expect(
      pageDropRejectReason({ groupId: "g1", locked: false }, ["g1", "g1"]),
    ).toBeNull();
  });
});
