import { describe, expect, it } from "vitest";

import type { LocatedDocument } from "@/lib/review-model";

import {
  VIEWER_KEYSHORTCUTS,
  isEditableTarget,
  neighborDocument,
  viewerKeyCommand,
  type ViewerKey,
} from "../document-navigation";

const key = (
  name: string,
  modifiers: Partial<Omit<ViewerKey, "key">> = {},
): ViewerKey => ({
  key: name,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...modifiers,
});

describe("viewerKeyCommand", () => {
  it("PageDown·PageUp 은 한 쪽, Home·End 는 양끝", () => {
    expect(viewerKeyCommand(key("PageDown"), 3, 10)).toEqual({
      kind: "page",
      index: 4,
    });
    expect(viewerKeyCommand(key("PageUp"), 3, 10)).toEqual({
      kind: "page",
      index: 2,
    });
    expect(viewerKeyCommand(key("Home"), 3, 10)).toEqual({
      kind: "page",
      index: 0,
    });
    expect(viewerKeyCommand(key("End"), 3, 10)).toEqual({
      kind: "page",
      index: 9,
    });
  });

  it("경계·이미 그 자리·페이지 없음은 null", () => {
    expect(viewerKeyCommand(key("PageDown"), 9, 10)).toBeNull();
    expect(viewerKeyCommand(key("PageUp"), 0, 10)).toBeNull();
    expect(viewerKeyCommand(key("Home"), 0, 10)).toBeNull();
    expect(viewerKeyCommand(key("End"), 9, 10)).toBeNull();
    expect(viewerKeyCommand(key("PageDown"), 0, 0)).toBeNull();
    expect(viewerKeyCommand(key("Home"), 0, 0)).toBeNull();
  });

  it("Alt+↑/↓ 는 앞·뒤 문서, Alt 와 다른 키는 null", () => {
    expect(viewerKeyCommand(key("ArrowDown", { altKey: true }), 0, 10)).toEqual(
      { kind: "document", delta: 1 },
    );
    expect(viewerKeyCommand(key("ArrowUp", { altKey: true }), 0, 10)).toEqual({
      kind: "document",
      delta: -1,
    });
    expect(
      viewerKeyCommand(key("PageDown", { altKey: true }), 0, 10),
    ).toBeNull();
    // 페이지가 없어도 문서 이동은 된다.
    expect(viewerKeyCommand(key("ArrowDown", { altKey: true }), 0, 0)).toEqual({
      kind: "document",
      delta: 1,
    });
  });

  it("Ctrl·Meta·Shift 조합과 다른 키는 null", () => {
    expect(
      viewerKeyCommand(key("PageDown", { ctrlKey: true }), 0, 10),
    ).toBeNull();
    expect(viewerKeyCommand(key("Home", { metaKey: true }), 3, 10)).toBeNull();
    expect(viewerKeyCommand(key("End", { shiftKey: true }), 3, 10)).toBeNull();
    expect(
      viewerKeyCommand(
        key("ArrowDown", { altKey: true, ctrlKey: true }),
        0,
        10,
      ),
    ).toBeNull();
    expect(viewerKeyCommand(key("ArrowDown"), 0, 10)).toBeNull();
    expect(viewerKeyCommand(key("a"), 0, 10)).toBeNull();
  });
});

function doc(stepId: string | null, documentId: string): LocatedDocument {
  return {
    stepId,
    index: 0,
    document: {
      document_id: documentId,
      group_id: "grp_1",
      label: null,
      source_files: [],
    },
  };
}

describe("neighborDocument", () => {
  const documents = [
    doc("st_a", "doc_1"),
    doc("st_a", "doc_2"),
    doc("st_b", "doc_1"),
    doc("st_b", "doc_3"),
  ];

  it("보이는 목록에서 앞·뒤 문서를 돌려준다", () => {
    expect(
      neighborDocument(documents, { stepId: "st_a", documentId: "doc_1" }, 1),
    ).toBe(documents[1]);
    expect(
      neighborDocument(documents, { stepId: "st_a", documentId: "doc_2" }, -1),
    ).toBe(documents[0]);
  });

  it("보기(stepId)가 다른 같은 문서 id 와 섞이지 않는다", () => {
    expect(
      neighborDocument(documents, { stepId: "st_b", documentId: "doc_1" }, 1),
    ).toBe(documents[3]);
    expect(
      neighborDocument(documents, { stepId: "st_b", documentId: "doc_1" }, -1),
    ).toBe(documents[1]);
  });

  it("끝·선택 없음·목록에 없는 문서는 null", () => {
    expect(
      neighborDocument(documents, { stepId: "st_a", documentId: "doc_1" }, -1),
    ).toBeNull();
    expect(
      neighborDocument(documents, { stepId: "st_b", documentId: "doc_3" }, 1),
    ).toBeNull();
    expect(neighborDocument(documents, null, 1)).toBeNull();
    expect(
      neighborDocument(documents, { stepId: null, documentId: "doc_1" }, 1),
    ).toBeNull();
    expect(
      neighborDocument(
        documents.filter(item => item.stepId === "st_a"),
        { stepId: "st_b", documentId: "doc_1" },
        1,
      ),
    ).toBeNull();
  });
});

describe("isEditableTarget", () => {
  it("input·textarea·select·contentEditable 만 참", () => {
    expect(
      isEditableTarget({ tagName: "INPUT" } as unknown as EventTarget),
    ).toBe(true);
    expect(
      isEditableTarget({ tagName: "textarea" } as unknown as EventTarget),
    ).toBe(true);
    expect(
      isEditableTarget({ tagName: "SELECT" } as unknown as EventTarget),
    ).toBe(true);
    expect(
      isEditableTarget({
        tagName: "DIV",
        isContentEditable: true,
      } as unknown as EventTarget),
    ).toBe(true);
    expect(
      isEditableTarget({
        tagName: "BUTTON",
        isContentEditable: false,
      } as unknown as EventTarget),
    ).toBe(false);
    expect(
      isEditableTarget({ tagName: "SECTION" } as unknown as EventTarget),
    ).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget({} as EventTarget)).toBe(false);
  });
});

describe("VIEWER_KEYSHORTCUTS", () => {
  const tokens = VIEWER_KEYSHORTCUTS.split(" ");
  const toKey = (token: string): ViewerKey => {
    const parts = token.split("+");
    return key(parts.at(-1)!, { altKey: parts.includes("Alt") });
  };

  it("적힌 단축키는 모두 가운데 쪽에서 이동 명령이 된다", () => {
    for (const token of tokens) {
      expect(viewerKeyCommand(toKey(token), 2, 5), token).not.toBeNull();
    }
  });

  it("처리하는 키가 빠짐없이 적혀 있다", () => {
    const handled = [
      "PageUp",
      "PageDown",
      "Home",
      "End",
      "Alt+ArrowUp",
      "Alt+ArrowDown",
    ];
    expect([...tokens].sort()).toEqual([...handled].sort());
    for (const extra of ["ArrowUp", "ArrowDown", "Alt+Home", "Enter"]) {
      expect(viewerKeyCommand(toKey(extra), 2, 5), extra).toBeNull();
    }
  });
});
