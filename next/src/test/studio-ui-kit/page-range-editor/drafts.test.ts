import {
  appendDraft,
  editDraft,
  revertDraft,
  rowsOf,
  syncDrafts,
} from "@/components/studio-ui-kit/page-range-editor/drafts";

const a = { fileRef: "f1", text: "1-3" };
const b = { fileRef: "f2", text: "4" };

describe("syncDrafts", () => {
  it("처음에는 자리마다 새 id 와 그 행을 origin 으로", () => {
    const drafts = syncDrafts([], [a, b]);
    expect(drafts.map(d => d.id)).toEqual([0, 1]);
    expect(drafts.map(d => d.origin)).toEqual([a, b]);
    expect(rowsOf(drafts)).toEqual([a, b]);
  });

  it("다시 채울 때 같은 자리의 id 를 이어 받고 늘어난 자리만 새 id", () => {
    const first = syncDrafts([], [a]);
    const next = syncDrafts(first, [b, a]);
    expect(next.map(d => d.id)).toEqual([0, 1]);
    expect(next.map(d => d.origin)).toEqual([b, a]);
  });
});

describe("행 삭제 뒤 Esc", () => {
  it("당겨진 행은 자기 origin 으로 돌아간다", () => {
    const drafts = syncDrafts([], [a, b]);
    const edited = editDraft(drafts, 1, { text: "9" });
    const removed = edited.filter((_, i) => i !== 0);
    expect(removed[0]!.id).toBe(1);
    expect(rowsOf(revertDraft(removed, 0))).toEqual([b]);
  });

  it("새로 더한 행은 처음 값으로 돌아간다", () => {
    const drafts = appendDraft(syncDrafts([], [a]), {
      fileRef: "f1",
      text: "",
    });
    expect(drafts.map(d => d.id)).toEqual([0, 1]);
    const edited = editDraft(drafts, 1, { fileRef: "f2", text: "7" });
    expect(rowsOf(revertDraft(edited, 1))).toEqual([
      a,
      { fileRef: "f1", text: "" },
    ]);
  });

  it("지운 뒤 더한 행은 남은 id 와 겹치지 않는다", () => {
    const drafts = syncDrafts([], [a, b]).filter((_, i) => i !== 0);
    const added = appendDraft(drafts, a);
    expect(added.map(d => d.id)).toEqual([1, 2]);
  });
});

describe("editDraft", () => {
  it("id·origin 은 그대로 둔다", () => {
    const drafts = syncDrafts([], [a]);
    const [edited] = editDraft(drafts, 0, { text: "2" });
    expect(edited).toEqual({ id: 0, origin: a, fileRef: "f1", text: "2" });
  });
});
