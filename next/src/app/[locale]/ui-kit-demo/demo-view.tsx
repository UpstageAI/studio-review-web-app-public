"use client";

// Review UI Kit Core 데모 화면. 고정 데이터와 지역 state 만으로 Core item 을 그린다(검수 모델·BFF 없음).
// 이 파일은 v1 4 item(위치 바·문서 목록·값 위젯·구조 편집 + 문서 위치 대화 상자), 나머지는 `demo-<item>.tsx`
// (값 위젯의 문구·값 변환은 배열 표 데모도 쓰므로 `demo-value-widget.ts`).
// 데모 전용 화면이라 문구는 번역하지 않고 영어 고정 문자열을 Core labels 로 넘긴다
// (host 문구 하드코딩 금지 규칙의 예외).

import { useRef, useState } from "react";
import {
  DocumentList,
  DocumentListFilter,
  effectiveStatusFilter,
  filterDocumentItems,
  isFiltering,
  isSelectionHidden,
  statusFilterOptions,
  summarizeDocuments,
  type DocumentListLabels,
  type DocumentListFilterLabels,
  type DocumentStatusFilter,
} from "@/components/studio-ui-kit/document-list";
import {
  PagePositionBar,
  type PagePositionBarLabels,
} from "@/components/studio-ui-kit/page-position-bar";
import {
  DocumentPositionDialog,
  Filmstrip,
  PageGrid,
  type DocumentPositionDialogLabels,
  type FilmstripLabels,
  type PageGridLabels,
  type PageGridSize,
  type StructureEditorCallbacks,
  type StructureEditorLabels,
  type StructureMenuButtons,
  type StructureSelectedPage,
} from "@/components/studio-ui-kit/structure-editor";
import {
  ValueWidget,
  type ValueWidgetDescriptor,
} from "@/components/studio-ui-kit/value-widget";
import {
  INITIAL_STRUCTURE,
  LIST_EXCLUDED_PAGES,
  LIST_ITEMS,
  LONG_TEXT,
  POSITION_MARKS,
  POSITION_PAGE_COUNT,
  groupBlock,
  groupBoundaries,
  structureEdits,
  type DemoScalar,
  type StructureState,
} from "./demo-data";
import { ArrayTableDemo } from "./demo-array-table";
import { DocumentLabelFieldDemo } from "./demo-document-label-field";
import { InstructMarkdownDemo } from "./demo-instruct-markdown";
import { MovePagesDialogDemo } from "./demo-move-pages-dialog";
import { PageRangeEditorDemo } from "./demo-page-range-editor";
import { ParseTableDemo } from "./demo-parse-table";
import { ReviewActionsDemo } from "./demo-review-actions";
import { Section, TEST_ID } from "./demo-section";
import { CODEC, VALUE_LABELS } from "./demo-value-widget";
import { ValidateRulesDemo } from "./demo-validate-rules";
import { VerdictSegmentDemo } from "./demo-verdict-segment";

export function DemoView() {
  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">
          Review UI Kit Core demo
        </h1>
        <p className="text-sm text-muted-foreground">
          Core items rendered with fixed data and local state only — no review
          model, no API. Labels are fixed English strings (demo only, not
          translated).
        </p>
      </header>
      <PositionBarDemo />
      <DocumentListDemo />
      <ValueWidgetDemo />
      <VerdictSegmentDemo />
      <ValidateRulesDemo />
      <PageRangeEditorDemo />
      <StructureEditorDemo />
      <MovePagesDialogDemo />
      <ParseTableDemo />
      <InstructMarkdownDemo />
      <ReviewActionsDemo />
      <DocumentLabelFieldDemo />
      <ArrayTableDemo />
    </div>
  );
}

// ── page-position-bar ─────────────────────────────────────

const POSITION_LABELS: PagePositionBarLabels = {
  label: "Page position",
  previous: "Previous page",
  next: "Next page",
  pageInput: "Page number",
  pageCount: count => `/ ${count}`,
  track: "Page track",
  valueText: (page, total) => `Page ${page} of ${total}`,
  marks: { changed: "Changed", issue: "Issue", noImage: "No image" },
};

function PositionBarDemo() {
  const [index, setIndex] = useState(0);
  return (
    <Section
      title="page-position-bar"
      description="Viewer position with marks for changed pages, issues and pages without an image."
      testId={`${TEST_ID}-position-bar-section`}
    >
      <PagePositionBar
        index={index}
        count={POSITION_PAGE_COUNT}
        marks={POSITION_MARKS}
        onIndexChange={setIndex}
        labels={POSITION_LABELS}
        testId={`${TEST_ID}-position-bar`}
      />
    </Section>
  );
}

// ── document-list ─────────────────────────────────────────

const LIST_LABELS: DocumentListLabels = {
  list: "Documents",
  untitled: "Untitled",
  excluded: "Excluded pages",
  pageCount: count => (count === 1 ? "1 page" : `${count} pages`),
  status: {
    changed: "Changed",
    recheck: "Needs recheck",
    locked: "Locked",
    excluded: "Excluded",
  },
  flags: { danger: "Failed", warning: "Warning" },
  unvisited: "Not opened yet",
};

const FILTER_LABELS: DocumentListFilterLabels = {
  search: "Search documents",
  placeholder: "Search by label",
  status: "Status filter",
  options: {
    all: "All",
    flagged: "Flagged",
    changed: "Changed",
    recheck: "Needs recheck",
    excluded: "Excluded",
    untouched: "Untouched",
    unvisited: "Not opened",
  },
  summary: ({ count, pages }) => `${count} documents, ${pages} pages`,
  visitedCount: count => `${count} opened`,
  filteredCount: count => `${count} shown`,
  separator: " · ",
  selectedHidden: "The selected document is hidden by the filter.",
  clear: "Clear filter",
};

function DocumentListDemo() {
  const [selectedId, setSelectedId] = useState<string | null>("l1");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<DocumentStatusFilter>("all");

  const applied = effectiveStatusFilter(status, true);
  const visible = filterDocumentItems(
    LIST_ITEMS,
    query,
    applied,
    LIST_LABELS.untitled,
  );
  const filtering = isFiltering(query, applied);

  return (
    <Section
      title="document-list"
      description="Document list with the filter bar. The list keeps its original ordinals while filtered."
      testId={`${TEST_ID}-document-list-section`}
    >
      <div className="flex max-w-sm flex-col gap-3">
        <DocumentListFilter
          query={query}
          onQueryChange={setQuery}
          status={applied}
          onStatusChange={setStatus}
          statusOptions={statusFilterOptions(true)}
          summary={summarizeDocuments(LIST_ITEMS)}
          showVisited
          filteredCount={filtering ? visible.length : null}
          selectionHidden={isSelectionHidden(LIST_ITEMS, visible, selectedId)}
          onClearFilter={() => {
            setQuery("");
            setStatus("all");
          }}
          labels={FILTER_LABELS}
          testId={`${TEST_ID}-document-filter`}
          summaryTestId={`${TEST_ID}-document-filter-summary`}
        />
        <DocumentList
          items={visible.map(item => ({
            ...item,
            ordinal: LIST_ITEMS.indexOf(item) + 1,
          }))}
          excluded={{ pageCount: LIST_EXCLUDED_PAGES }}
          selectedId={selectedId}
          onSelect={setSelectedId}
          labels={LIST_LABELS}
          markerClassNames={{ warning: "text-state-warning" }}
          testId={`${TEST_ID}-document-list`}
        />
      </div>
    </Section>
  );
}

// ── value-widget ──────────────────────────────────────────

interface ValueField {
  id: string;
  name: string;
  descriptor: ValueWidgetDescriptor<DemoScalar>;
  initial: DemoScalar;
}

const VALUE_FIELDS: readonly ValueField[] = [
  {
    id: "text",
    name: "Text",
    descriptor: { kind: "text", multiline: false },
    initial: "ACME Corp.",
  },
  {
    id: "multiline",
    name: "Multiline text",
    descriptor: { kind: "text", multiline: true },
    initial: "221B Baker Street\nLondon",
  },
  {
    id: "long",
    name: "Long text",
    descriptor: { kind: "text", multiline: true, long: true },
    initial: LONG_TEXT,
  },
  {
    id: "number",
    name: "Number",
    descriptor: { kind: "number", integer: false },
    initial: 1280.5,
  },
  {
    id: "integer",
    name: "Integer",
    descriptor: { kind: "number", integer: true },
    initial: 3,
  },
  {
    id: "boolean",
    name: "Boolean",
    descriptor: { kind: "boolean" },
    initial: true,
  },
  {
    id: "enum",
    name: "Enum",
    descriptor: {
      kind: "enum",
      options: ["USD", "EUR", "KRW"],
      nullable: true,
    },
    initial: "USD",
  },
  {
    id: "json",
    name: "JSON scalar",
    descriptor: { kind: "json" },
    initial: null,
  },
];

function ValueWidgetDemo() {
  return (
    <Section
      title="value-widget"
      description="One widget per kind. Values commit on blur, Enter or selection; the line below each widget shows the committed value."
      testId={`${TEST_ID}-value-widget-section`}
    >
      <div className="grid gap-4 md:grid-cols-2">
        {VALUE_FIELDS.map(field => (
          <ValueFieldDemo key={field.id} field={field} />
        ))}
      </div>
    </Section>
  );
}

function ValueFieldDemo({ field }: { field: ValueField }) {
  const [value, setValue] = useState<DemoScalar>(field.initial);
  const [error, setError] = useState<string | null>(null);
  const [asJson, setAsJson] = useState(false);
  const inputId = `${TEST_ID}-value-${field.id}`;
  const errorId = `${inputId}-error`;
  // 긴 문자열의 "JSON 으로 편집" 을 누르면 요약 대신 여러 줄 입력칸으로 바꾼다.
  const descriptor: ValueWidgetDescriptor<DemoScalar> =
    asJson && field.descriptor.kind === "text"
      ? { kind: "text", multiline: true }
      : field.descriptor;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium">
        {field.name}
      </label>
      <ValueWidget<DemoScalar>
        id={inputId}
        descriptor={descriptor}
        value={value}
        codec={CODEC}
        onCommit={setValue}
        onError={setError}
        invalid={error !== null}
        describedBy={error ? errorId : undefined}
        onEditJson={
          field.descriptor.kind === "text" && field.descriptor.long
            ? () => setAsJson(true)
            : undefined
        }
        labels={VALUE_LABELS}
        testId={inputId}
      />
      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <p
        className="truncate font-mono text-xs text-muted-foreground"
        data-testid={`${inputId}-committed`}
      >
        {JSON.stringify(value)}
      </p>
    </div>
  );
}

// ── structure-editor ──────────────────────────────────────

const STRUCTURE_LABELS: Omit<StructureEditorLabels, "region"> = {
  document: index => `Document ${index}`,
  untitled: "Untitled",
  label: "Label",
  noLabel: "(no label)",
  notInConfigOption: label => `${label} (not in config)`,
  notInConfigBadge: "Not in config",
  notInConfigHint: "This label is not in the configuration.",
  pageCount: count => (count === 1 ? "1 page" : `${count} pages`),
  page: page => `${page.fileRef} p${page.page}`,
  noImage: "No image",
  pageMenu: page => `${page.fileRef} p${page.page} menu`,
  movePageEarlier: "Move earlier",
  movePageLater: "Move later",
  moveToDocument: "Move to document",
  documentOption: (index, label) =>
    `Document ${index} · ${label ?? "Untitled"}`,
  noOtherDocument: "No other document",
  excludePage: "Exclude page",
  restorePage: "Restore to document",
  restoreToNewDocument: "Restore as new document",
  documentMenu: index => `Document ${index} menu`,
  mergeWithPrevious: "Merge with previous",
  moveDocumentEarlier: "Move document earlier",
  moveDocumentLater: "Move document later",
  documentExclusion: {
    exclude: "Exclude document",
    restore: "Restore document",
    badge: "Excluded",
  },
  excluded: "Excluded pages",
  excludedEmpty: "No excluded pages",
  unplaced: "Unplaced pages",
  missing: "Missing page",
  overlap: "Overlapping page",
  dropRejected: "Pages can only move within the same file.",
  dropRejectedLocked: "This document is locked.",
  groupBoundary: "File boundary",
};

const POSITION_DIALOG_LABELS: DocumentPositionDialogLabels = {
  title: "Move document",
  description: (index, first, last) =>
    `Enter the new position of document ${index} (${first}–${last}, within the same file group).`,
  position: "Position",
  invalid: (first, last) => `Enter a number from ${first} to ${last}.`,
  cancel: "Cancel",
  move: "Move",
};

const SIZE_TOGGLE = {
  size: "Thumbnail size",
  sizeSmall: "Small",
  sizeMedium: "Medium",
};

function StructureEditorDemo() {
  const [structure, setStructure] = useState<StructureState>(INITIAL_STRUCTURE);
  const [selectedPage, setSelectedPage] =
    useState<StructureSelectedPage | null>(null);
  const [size, setSize] = useState<PageGridSize>("s");
  // 문서 메뉴 "Move to position…" 이 연 대화 상자의 대상. 닫히면 그 문서의 메뉴 버튼으로 포커스를 돌린다.
  const [positioning, setPositioning] = useState<{
    documentId: string;
    index: number;
    first: number;
    last: number;
  } | null>(null);
  const menuButtons = useRef<StructureMenuButtons>(null);
  const positionedDocument = useRef<string | null>(null);

  const edit =
    <A extends unknown[]>(
      apply: (state: StructureState, ...args: A) => StructureState,
    ) =>
    (...args: A) =>
      setStructure(state => apply(state, ...args));

  const callbacks: StructureEditorCallbacks = {
    onReorderPage: edit(structureEdits.reorderPage),
    onMovePage: edit(structureEdits.movePage),
    onSplit: edit(structureEdits.split),
    onMergeInto: edit(structureEdits.mergeInto),
    onReorderDocument: edit(structureEdits.reorderDocument),
    onExcludePage: edit(structureEdits.excludePage),
    onRestorePage: edit(structureEdits.restorePage),
    onRestoreToNewDocument: edit(structureEdits.restoreToNewDocument),
    onLabelChange: edit(structureEdits.labelChange),
    onExcludeDocument: edit((state, documentId: string) =>
      structureEdits.setDocumentExcluded(state, documentId, true),
    ),
    onRestoreDocument: edit((state, documentId: string) =>
      structureEdits.setDocumentExcluded(state, documentId, false),
    ),
    onThumbnailClick: (documentId, pageKey) =>
      setSelectedPage(documentId === null ? null : { documentId, pageKey }),
  };

  const shared = {
    documents: structure.documents,
    excluded: structure.excluded,
    groupBoundariesAfter: groupBoundaries(structure.documents),
    selectedPage,
  };

  const filmstripLabels: FilmstripLabels = {
    ...STRUCTURE_LABELS,
    region: "Filmstrip (editable)",
    movePageEarlier: "Move left",
    movePageLater: "Move right",
    splitAfter: page => `Split after p${page.page}`,
    dragDocument: "Drag document",
    moveDocumentTo: "Move to position…",
  };
  const pageGridLabels: PageGridLabels = {
    ...STRUCTURE_LABELS,
    region: "Page grid (editable)",
    splitBefore: page => `Split before p${page.page}`,
    sizeToggle: SIZE_TOGGLE,
  };

  return (
    <Section
      title="structure-editor"
      description="Filmstrip and PageGrid share one document structure. Edits in an editable view (drag, ✂, menus, labels) show up in the read-only views too. The read-only views get the same callbacks and labels plus readOnly, which hides every editing control; thumbnail clicks and the size toggle still work. The editable Filmstrip's document menu also has “Move to position…”, answered with DocumentPositionDialog."
      testId={`${TEST_ID}-structure-editor-section`}
    >
      <h3 className="text-sm font-semibold">Filmstrip — editable</h3>
      <Filmstrip
        {...shared}
        {...callbacks}
        labels={filmstripLabels}
        testId={`${TEST_ID}-filmstrip-edit`}
        menuButtonsRef={menuButtons}
        onRequestDocumentPosition={(documentId, index) => {
          positionedDocument.current = documentId;
          setPositioning({
            documentId,
            index,
            ...groupBlock(structure.documents, index),
          });
        }}
      />
      <DocumentPositionDialog
        open={positioning !== null}
        onOpenChange={open => {
          if (!open) setPositioning(null);
        }}
        index={positioning?.index ?? 0}
        min={positioning?.first ?? 1}
        max={positioning?.last ?? 1}
        returnFocus={() => {
          const documentId = positionedDocument.current;
          return documentId === null
            ? null
            : (menuButtons.current?.get(documentId) ?? null);
        }}
        onMove={position => {
          // 새 위치 n(1-based) = 그 문서를 뺀 뒤 기준 toIndex n-1.
          if (positioning) {
            setStructure(state =>
              structureEdits.reorderDocument(
                state,
                positioning.documentId,
                position - 1,
              ),
            );
          }
        }}
        labels={POSITION_DIALOG_LABELS}
        testId={`${TEST_ID}-document-position-dialog`}
      />
      <h3 className="text-sm font-semibold">Filmstrip — read-only</h3>
      <Filmstrip
        {...shared}
        {...callbacks}
        readOnly
        labels={{ ...filmstripLabels, region: "Filmstrip (read-only)" }}
        testId={`${TEST_ID}-filmstrip-readonly`}
      />
      <h3 className="text-sm font-semibold">PageGrid — editable</h3>
      <PageGrid
        {...shared}
        {...callbacks}
        size={size}
        onSizeChange={setSize}
        maxHeight="24rem"
        labels={pageGridLabels}
        testId={`${TEST_ID}-page-grid-edit`}
      />
      <h3 className="text-sm font-semibold">PageGrid — read-only</h3>
      <PageGrid
        {...shared}
        {...callbacks}
        readOnly
        size={size}
        onSizeChange={setSize}
        maxHeight="24rem"
        labels={{ ...pageGridLabels, region: "Page grid (read-only)" }}
        testId={`${TEST_ID}-page-grid-readonly`}
      />
    </Section>
  );
}
