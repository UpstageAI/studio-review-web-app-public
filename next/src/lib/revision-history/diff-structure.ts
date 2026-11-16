import {
  changedDocuments,
  compressPages,
  flattenSources,
  pageKey,
  type Layout,
  type PageRef,
  type ReviewDocumentEntry,
  type ReviewJob,
  type SourceRange,
} from "@/lib/review-model";

import type { StructureContent, StructureContentDocument } from "./draft";

/**
 * 구조 변경 이력 두 내용 사이의 변화 한 줄. 출력 순서는 파일 → 문서 → 제외이고, 같은 종류
 * 안에서는 after 위치 순(사라진 것은 before 위치 순으로 뒤에).
 */
export type StructureChange =
  | {
      readonly kind: "fileAdded" | "fileRemoved";
      readonly fileRef: string;
      readonly name: string | null;
      readonly groupId: string;
    }
  | {
      readonly kind: "fileMoved";
      readonly fileRef: string;
      readonly name: string | null;
      readonly fromGroupId: string;
      readonly toGroupId: string;
    }
  | {
      readonly kind: "documentAdded" | "documentRemoved";
      readonly documentId: string;
      readonly stepId: string | null;
      readonly label: string | null;
    }
  | {
      readonly kind: "documentLabel";
      readonly documentId: string;
      readonly stepId: string | null;
      readonly from: string | null;
      readonly to: string | null;
    }
  | {
      readonly kind: "documentMoved";
      readonly documentId: string;
      readonly stepId: string | null;
      readonly label: string | null;
      readonly fromGroupId: string;
      readonly toGroupId: string;
    }
  | {
      readonly kind: "documentPages";
      readonly documentId: string;
      readonly stepId: string | null;
      readonly label: string | null;
      readonly before: readonly SourceRange[];
      readonly after: readonly SourceRange[];
    }
  | {
      /** 이 문서 배치 보기 안에서 양쪽에 다 있는 문서끼리의 순서가 바뀌었다. */
      readonly kind: "documentsReordered";
      readonly stepId: string | null;
    }
  | {
      readonly kind: "documentExcluded" | "documentIncluded";
      readonly documentId: string;
      readonly label: string | null;
    }
  | {
      readonly kind: "pagesExcluded" | "pagesIncluded";
      readonly pages: readonly SourceRange[];
    };

export type StructureChangeKind = StructureChange["kind"];

/** 비교용 가짜 Job — 문서 배치 보기는 문서의 `step_id` 가 처음 나온 순서. */
function toJob(content: StructureContent): ReviewJob {
  const byStep = new Map<string | null, ReviewDocumentEntry[]>();
  for (const document of content.documents) {
    const bucket = byStep.get(document.step_id) ?? [];
    bucket.push({
      document_id: document.document_id,
      group_id: document.group_id,
      label: document.label,
      source_files: document.source_files,
    });
    byStep.set(document.step_id, bucket);
  }
  const output: Layout[] = [...byStep].map(([stepId, documents]) => ({
    step_id: stepId,
    base_version: 0,
    content: { documents },
  }));
  return {
    id: "",
    file_groups: {
      base_version: 0,
      groups: content.file_groups.groups.map(group => ({
        group_id: group.group_id,
        layout_step_id: group.layout_step_id,
        files: group.files.map(file => ({
          file_ref: file.file_ref,
          file_id: file.file_id,
          name: file.name ?? file.file_ref,
        })),
      })),
      excluded_pages: content.file_groups.excluded_pages,
      excluded_documents: content.file_groups.excluded_documents,
    },
    output,
  };
}

function safePages(sources: readonly SourceRange[]): PageRef[] {
  try {
    return flattenSources(sources);
  } catch {
    return [];
  }
}

function sameSources(
  a: readonly SourceRange[],
  b: readonly SourceRange[],
): boolean {
  const left = safePages(a).map(pageKey);
  const right = safePages(b).map(pageKey);
  return (
    left.length === right.length &&
    left.every((key, index) => key === right[index])
  );
}

function fileChanges(
  before: StructureContent,
  after: StructureContent,
): StructureChange[] {
  const placed = (content: StructureContent) => {
    const out = new Map<string, { groupId: string; name: string | null }>();
    for (const group of content.file_groups.groups) {
      for (const file of group.files) {
        out.set(file.file_ref, {
          groupId: group.group_id,
          name: file.name ?? null,
        });
      }
    }
    return out;
  };
  const was = placed(before);
  const now = placed(after);
  const out: StructureChange[] = [];
  for (const [fileRef, place] of now) {
    const old = was.get(fileRef);
    if (!old) {
      out.push({ kind: "fileAdded", fileRef, ...place });
    } else if (old.groupId !== place.groupId) {
      out.push({
        kind: "fileMoved",
        fileRef,
        name: place.name ?? old.name,
        fromGroupId: old.groupId,
        toGroupId: place.groupId,
      });
    }
  }
  for (const [fileRef, place] of was) {
    if (!now.has(fileRef)) out.push({ kind: "fileRemoved", fileRef, ...place });
  }
  return out;
}

function documentKey(stepId: string | null, documentId: string): string {
  return `${stepId === null ? "" : `s:${stepId}`}\u0000${documentId}`;
}

function indexDocuments(
  content: StructureContent,
): Map<string, StructureContentDocument> {
  return new Map(
    content.documents.map(document => [
      documentKey(document.step_id, document.document_id),
      document,
    ]),
  );
}

function documentChanges(
  before: StructureContent,
  after: StructureContent,
): StructureChange[] {
  const was = indexDocuments(before);
  const now = indexDocuments(after);
  const out: StructureChange[] = [];
  const reordered: (string | null)[] = [];
  for (const change of changedDocuments(toJob(before), toJob(after))) {
    const key = documentKey(change.stepId, change.documentId);
    const old = was.get(key);
    const next = now.get(key);
    const base = { documentId: change.documentId, stepId: change.stepId };
    if (change.status === "added" && next) {
      out.push({ kind: "documentAdded", ...base, label: next.label });
      continue;
    }
    if (change.status === "removed" && old) {
      out.push({ kind: "documentRemoved", ...base, label: old.label });
      continue;
    }
    if (!old || !next) continue;
    if (old.label !== next.label) {
      out.push({
        kind: "documentLabel",
        ...base,
        from: old.label,
        to: next.label,
      });
    }
    if (old.group_id !== next.group_id) {
      out.push({
        kind: "documentMoved",
        ...base,
        label: next.label,
        fromGroupId: old.group_id,
        toGroupId: next.group_id,
      });
    }
    if (!sameSources(old.source_files, next.source_files)) {
      out.push({
        kind: "documentPages",
        ...base,
        label: next.label,
        before: old.source_files,
        after: next.source_files,
      });
    }
    if (change.positionChanged && !reordered.includes(change.stepId)) {
      reordered.push(change.stepId);
    }
  }
  for (const stepId of reordered) {
    out.push({ kind: "documentsReordered", stepId });
  }
  return out;
}

function labelOf(
  documentId: string,
  ...contents: StructureContent[]
): string | null {
  for (const content of contents) {
    const found = content.documents.find(
      document => document.document_id === documentId,
    );
    if (found) return found.label;
  }
  return null;
}

function exclusionChanges(
  before: StructureContent,
  after: StructureContent,
): StructureChange[] {
  const out: StructureChange[] = [];
  const wasDocuments = new Set(before.file_groups.excluded_documents);
  const nowDocuments = new Set(after.file_groups.excluded_documents);
  for (const documentId of nowDocuments) {
    if (!wasDocuments.has(documentId)) {
      out.push({
        kind: "documentExcluded",
        documentId,
        label: labelOf(documentId, after, before),
      });
    }
  }
  for (const documentId of wasDocuments) {
    if (!nowDocuments.has(documentId)) {
      out.push({
        kind: "documentIncluded",
        documentId,
        label: labelOf(documentId, after, before),
      });
    }
  }
  const wasPages = safePages(before.file_groups.excluded_pages);
  const nowPages = safePages(after.file_groups.excluded_pages);
  const wasKeys = new Set(wasPages.map(pageKey));
  const nowKeys = new Set(nowPages.map(pageKey));
  const excluded = nowPages.filter(page => !wasKeys.has(pageKey(page)));
  const included = wasPages.filter(page => !nowKeys.has(pageKey(page)));
  if (excluded.length > 0) {
    out.push({ kind: "pagesExcluded", pages: compressPages(excluded) });
  }
  if (included.length > 0) {
    out.push({ kind: "pagesIncluded", pages: compressPages(included) });
  }
  return out;
}

/** 구조 변경 이력의 변경 전(`base_content`) → 변경 후(`content`) 변화. 같으면 빈 배열. */
export function diffStructure(
  before: StructureContent,
  after: StructureContent,
): StructureChange[] {
  return [
    ...fileChanges(before, after),
    ...documentChanges(before, after),
    ...exclusionChanges(before, after),
  ];
}
