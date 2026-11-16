"use client";

import { ChevronRightIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { FieldRow } from "@/components/job-review/field-row";
import { StatusChip } from "@/components/job-review/status-chip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  arrayBounds,
  contentLeaves,
  fieldDescription,
  fieldTitle,
  isJsonObject,
  jsonEquals,
  missingProperties,
  schemaAt,
  templateFor,
  toPointer,
  widgetFor,
  type JsonObject,
  type JsonPath,
  type JsonValue,
  type SchemaMatch,
} from "@/lib/review-model";
import {
  ARRAY_BATCH,
  autoOpenKey,
  batchLimitFor,
  firstItemUnder,
  itemIndexUnder,
  shouldAutoOpen,
} from "./array-batches";
import { ArrayTable } from "./array-table";
import { propertyOrder, tableColumns } from "./array-table-model";
import {
  TreeContext,
  nodeId,
  useTree,
  type ContentTreeProps,
  type Parent,
  type TreeContextValue,
} from "./content-tree-context";
import { AddFieldMenu, NodeError, NodeMenu } from "./content-tree-menus";
import {
  boundErrorMessage,
  type FieldError,
  type ValueBoundError,
} from "./field-errors";
import { isFieldPathShown } from "./field-filter";
import {
  displayValue,
  firstLeafPointer,
  isHiddenWrapper,
  schemaPath,
  valueAt,
} from "./value-fields";
import { ValueWidget } from "./value-widget";
import { clearedValue } from "./cleared-value";

export type { ContentTreeProps, ValueEdit } from "./content-tree-context";

/** 묶음을 처음부터 펼쳐 둘 leaf 수 상한. 그보다 크면 접어 둔다. */
const OPEN_GROUP_MAX_LEAVES = 10;

/** 새 자리로 포커스를 옮기는 요청이 유효한 시간(ms). */
const PENDING_FOCUS_MS = 1000;

/**
 * 결과 `content` 를 schema 를 따라 걷는 트리. 객체는 키 순서대로 자식과 "필드 추가"(schema 의
 * 없는 키), 배열은 접는 묶음과 "항목 추가"·항목 메뉴(위로·아래로·삭제), scalar 는 값 행과 행
 * 메뉴(비우기·필드 삭제). 항목 하나짜리 배열 래퍼(`[{…}]`)는 단계로 그리지 않는다.
 */
export function ContentTree(props: ContentTreeProps) {
  const {
    result,
    baseResult,
    step,
    selectedHighlightId,
    onEdit,
    errors,
    errorPointers,
  } = props;
  const visibleNodes = props.visibleNodes ?? null;
  const visibleFields = props.visibleFields ?? null;
  const schema = step?.schema ?? null;
  const content = result.content;
  const wrapped = useMemo(
    () => isHiddenWrapper(schema, content),
    [schema, content],
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<{ target: string; at: number } | null>(null);
  const [toggled, setToggled] = useState<Readonly<Record<string, boolean>>>({});
  // 배열 pointer → 사용자가 늘린 항목 한도("더 보기"·항목 추가·아래로). 없으면 `ARRAY_BATCH`.
  const [limits, setLimits] = useState<Readonly<Record<string, number>>>({});
  // 배열 pointer → 마지막으로 자동 펼친 이유. 묶음이 다시 마운트돼도 같은 이유로는 다시 펼치지 않는다.
  const autoOpened = useRef<Record<string, string>>({});

  const selectedPointer =
    selectedHighlightId?.startsWith(`${result.id}#`) === true
      ? selectedHighlightId.slice(result.id.length + 1)
      : null;

  // 새 항목·필드를 넣은 뒤 그 자리의 첫 입력으로 포커스를 옮긴다.
  useEffect(() => {
    const pending = pendingFocus.current;
    if (pending === null) return;
    // 적용되지 않은 변경의 포커스 요청이 나중의 다른 변경에 따라붙지 않게 한다.
    if (performance.now() - pending.at > PENDING_FOCUS_MS) {
      pendingFocus.current = null;
      return;
    }
    const { target } = pending;
    const frame = requestAnimationFrame(() => {
      pendingFocus.current = null;
      const root = rootRef.current;
      if (!root) return;
      const escaped = CSS.escape(target);
      const node = root.querySelector<HTMLElement>(
        `[data-field-id="${escaped}"], [data-node-id="${escaped}"]`,
      );
      if (!node) return;
      node.scrollIntoView({ block: "nearest" });
      // 입력이 없는 자리(입력 없는 묶음, 비운 배열)는 첫 버튼(펼치기·메뉴)으로.
      const input = node.matches("[data-field-input]")
        ? node
        : (node.querySelector<HTMLElement>("[data-field-input]") ??
          node.querySelector<HTMLElement>("button:not(:disabled)"));
      input?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [content]);

  const hasErrorUnder = useCallback(
    (pointer: string) =>
      errorPointers.some(item => item.startsWith(`${pointer}/`)),
    [errorPointers],
  );
  const errorAt = useCallback(
    (pointer: string) => errors.get(pointer) ?? null,
    [errors],
  );

  const value = useMemo<TreeContextValue>(() => {
    const matchAt = (path: JsonPath, at?: JsonValue) =>
      schemaAt(schema, schemaPath(wrapped, path), at);
    return {
      props,
      schema,
      baseContent: baseResult?.content,
      selectedPointer,
      errorPointers,
      errorAt,
      hasErrorUnder,
      matchAt,
      templateAt: path => (schema ? templateFor(matchAt(path), schema) : null),
      edit: (edit, focusPath) => {
        pendingFocus.current =
          focusPath === undefined
            ? null
            : { target: nodeId(result.id, focusPath), at: performance.now() };
        onEdit(result.id, edit);
      },
      hasPendingFocus: () => pendingFocus.current !== null,
      // 필터 중에는 남은 행이 적으니 사용자가 직접 닫은 묶음만 빼고 모두 펼친다. 아래에 오류가
      // 있는 묶음은 사용자가 접기 전까지 펼쳐 둔다.
      isOpen: (pointer, leafCount) =>
        selectedPointer?.startsWith(`${pointer}/`) === true ||
        (visibleNodes !== null
          ? toggled[pointer] !== false
          : (toggled[pointer] ??
            (hasErrorUnder(pointer) || leafCount <= OPEN_GROUP_MAX_LEAVES))),
      setOpen: (pointer, open) =>
        setToggled(current =>
          current[pointer] === open ? current : { ...current, [pointer]: open },
        ),
      filtering: visibleNodes !== null,
      isVisible: path =>
        isFieldPathShown(visibleFields, path, wrapped) &&
        (visibleNodes === null || visibleNodes.has(toPointer(path))),
      isFieldShown: path => isFieldPathShown(visibleFields, path, wrapped),
      itemLimit: (pointer, count, needed) =>
        Math.min(
          count,
          batchLimitFor(limits[pointer] ?? ARRAY_BATCH, needed, ARRAY_BATCH),
        ),
      extendItems: (pointer, atLeast) =>
        setLimits(current =>
          (current[pointer] ?? ARRAY_BATCH) >= atLeast
            ? current
            : { ...current, [pointer]: atLeast },
        ),
      markAutoOpen: (pointer, key) => {
        const opened = autoOpened.current;
        const open = shouldAutoOpen(opened[pointer] ?? null, key);
        if (key === null) delete opened[pointer];
        else opened[pointer] = key;
        return open;
      },
    };
  }, [
    props,
    schema,
    wrapped,
    baseResult?.content,
    selectedPointer,
    errorPointers,
    errorAt,
    hasErrorUnder,
    toggled,
    limits,
    visibleNodes,
    visibleFields,
    onEdit,
    result.id,
  ]);

  const rootPath: JsonPath = wrapped ? ["0"] : [];
  const rootValue =
    wrapped && Array.isArray(content) ? (content[0] ?? null) : content;
  // 루트 객체는 묶음 머리가 없으므로 그 오류(필수 필드 등)를 트리 맨 위에 보인다. 래핑된 결과의
  // 바깥 배열(`""`)도 그리는 노드가 없어 여기서 보인다. 루트 배열·값은 그 노드가 보인다.
  const rootErrors = [
    wrapped ? (errors.get("") ?? null) : null,
    isJsonObject(rootValue) ? (errors.get(toPointer(rootPath)) ?? null) : null,
  ];

  return (
    <TreeContext value={value}>
      <div ref={rootRef} className="flex min-w-0 flex-col gap-1">
        {rootErrors.map((error, index) =>
          error ? <NodeError key={index} error={error} /> : null,
        )}
        <TreeNode path={rootPath} value={rootValue} parent={null} />
      </div>
    </TreeContext>
  );
}

function TreeNode({
  path,
  value,
  parent,
}: {
  path: JsonPath;
  value: JsonValue;
  parent: Parent | null;
}) {
  const t = useTranslations("review.values.tree");
  const tree = useTree();
  // 필터가 거른 leaf·빈 묶음은 그리지 않는다(루트는 늘 그린다).
  if (parent !== null && !tree.isVisible(path)) return null;
  const match = tree.matchAt(path, value);
  const title =
    parent === null
      ? ""
      : parent.kind === "array"
        ? String(parent.index + 1)
        : fieldTitle(match?.node ?? null, [parent.key]);

  if (Array.isArray(value)) {
    return (
      <ArrayNode
        path={path}
        value={value}
        match={match}
        title={title || t("rootArray")}
        parent={parent}
      />
    );
  }
  if (isJsonObject(value)) {
    const body = <ObjectBody path={path} value={value} match={match} />;
    if (parent === null) return body;
    if (parent.kind === "array") {
      return (
        <ItemBlock path={path} parent={parent} value={value}>
          {body}
        </ItemBlock>
      );
    }
    return (
      <Group
        path={path}
        title={title}
        count={Object.keys(value).length}
        leafCount={contentLeaves(value).length}
        error={tree.errorAt(toPointer(path))}
        actions={
          <NodeMenu
            path={path}
            value={value}
            match={match}
            parent={parent}
            title={title}
          />
        }
      >
        {body}
      </Group>
    );
  }
  return (
    <ValueRow
      path={path}
      value={value}
      match={match}
      title={title}
      parent={parent}
    />
  );
}

/** 접는 묶음(배열·중첩 객체). 머리에 펼침 버튼·제목·개수와 조작 버튼, 그 아래 묶음 오류. */
function Group({
  path,
  title,
  count,
  leafCount,
  error = null,
  extra,
  actions,
  children,
}: {
  path: JsonPath;
  title: string;
  count: number;
  leafCount: number;
  error?: FieldError | null;
  extra?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const tree = useTree();
  const bodyId = useId();
  const pointer = toPointer(path);
  const open = tree.isOpen(pointer, leafCount);
  return (
    <div
      data-node-id={nodeId(tree.props.result.id, path)}
      className="min-w-0 rounded-md border border-border"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-1 px-1 py-1">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => tree.setOpen(pointer, !open)}
          data-testid="job-review-field-group-toggle"
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-sm px-1 py-1 text-left text-sm font-medium focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden"
        >
          <ChevronRightIcon
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
              open && "rotate-90",
            )}
          />
          <span className="min-w-0 break-words">{title}</span>
          <span className="shrink-0 text-xs font-normal text-muted-foreground">
            {countText(count)}
          </span>
        </button>
        {extra}
        {actions}
      </div>
      {error ? <NodeError error={error} /> : null}
      {open ? (
        <div id={bodyId} className="flex min-w-0 flex-col gap-1 px-1 pb-1">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** 묶음 요약의 개수(숫자만 — 단위 없는 표기라 번역이 필요 없다). */
function countText(count: number): string {
  return `(${count})`;
}

function ArrayNode({
  path,
  value,
  match,
  title,
  parent,
}: {
  path: JsonPath;
  value: readonly JsonValue[];
  match: SchemaMatch | null;
  title: string;
  parent: Parent | null;
}) {
  const t = useTranslations("review.values.tree");
  const tree = useTree();
  const { locked } = tree.props;
  const bounds = arrayBounds(match);
  const full = bounds.max !== undefined && value.length >= bounds.max;
  const pointer = toPointer(path);

  // 그릴 후보 항목(필터 중에는 보이는 leaf 를 품은 항목만) 중 앞에서 `limit` 개. 선택·오류 항목은
  // 그 위치까지 묶음 단위로 자동 확장한다.
  const { filtering, isVisible, selectedPointer, errorPointers } = tree;
  const indexes = useMemo(() => {
    const all = value.map((_, index) => index);
    return filtering
      ? all.filter(index => isVisible([...path, String(index)]))
      : all;
  }, [value, filtering, isVisible, path]);
  const needed = Math.max(
    indexes.indexOf(itemIndexUnder(pointer, selectedPointer) ?? -1),
    // 오류는 첫 오류 항목까지만 늘린다(뒤 오류는 "더 보기").
    indexes.indexOf(firstItemUnder(pointer, errorPointers)?.index ?? -1),
  );
  const limit = tree.itemLimit(
    pointer,
    indexes.length,
    needed >= 0 ? needed : null,
  );
  const shown = indexes.slice(0, limit);
  const remaining = indexes.length - shown.length;
  // 평평한 객체 항목이면 표로 그린다(열은 schema 항목 properties 순서를 먼저 따른다).
  const itemSchemaNode = tree.matchAt([...path, "0"], value[0])?.node;
  const columns = useMemo(
    () => tableColumns(value, propertyOrder(itemSchemaNode)),
    [value, itemSchemaNode],
  );

  // 선택·오류 항목까지 자동으로 늘린 한도와 펼침을 "더 보기"·펼침 버튼과 같은 상태에 남겨, 선택이
  // 바뀌어도 줄거나 접히지 않게 한다. 한도는 이미 그 값이면 같은 상태를 돌려주므로 다시 그리지 않는다.
  // 펼침은 선택·오류 항목이 새로 이 배열을 가리키게 된 때 한 번만 하고, 그 뒤 사용자가 접으면 접힌
  // 채 둔다.
  const autoOpenReason =
    needed < 0 ? null : autoOpenKey(pointer, selectedPointer, errorPointers);
  const { extendItems, setOpen, markAutoOpen } = tree;
  useEffect(() => {
    if (needed >= 0) extendItems(pointer, limit);
    if (markAutoOpen(pointer, autoOpenReason)) setOpen(pointer, true);
  }, [
    extendItems,
    setOpen,
    markAutoOpen,
    pointer,
    limit,
    needed,
    autoOpenReason,
  ]);

  const add = () => {
    const at: JsonPath = [...path, String(value.length)];
    const template = tree.templateAt(at);
    tree.setOpen(pointer, true);
    // 새 항목이 묶음 한도 밖이면 포커스를 줄 DOM 이 생기지 않으므로 먼저 한도를 늘린다.
    tree.extendItems(pointer, indexes.length + 1);
    tree.edit(
      { kind: "insert_item", path, index: value.length, value: template },
      at,
    );
    // 새 항목(첫 필드)을 선택 행으로 만들어 값 필터가 켜져 있어도 보이고 포커스가 갈 수 있게 한다.
    tree.props.onSelectPointer?.(
      tree.props.result.id,
      firstLeafPointer(at, template),
    );
  };

  return (
    <Group
      path={path}
      title={title}
      count={value.length}
      // 표는 한 묶음(50 행) 이하면 처음부터 펼친다(행이 낮아 길어지지 않는다).
      leafCount={
        columns !== null && value.length <= ARRAY_BATCH
          ? 0
          : contentLeaves(value as JsonValue).length
      }
      error={tree.errorAt(pointer)}
      extra={
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={locked || full}
            onClick={add}
            data-testid="job-review-tree-button-add-item"
            className="cursor-pointer"
          >
            + {t("addItem")}
          </Button>
          {full ? (
            <span className="text-xs text-muted-foreground">
              {t("maxItems", { max: bounds.max ?? 0 })}
            </span>
          ) : null}
        </>
      }
      actions={
        parent ? (
          <NodeMenu
            path={path}
            value={value as JsonValue}
            match={match}
            parent={parent}
            title={title}
          />
        ) : null
      }
    >
      {value.length === 0 ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">
          {t("emptyArray")}
        </p>
      ) : columns !== null ? (
        <ArrayTable
          path={path}
          value={value}
          indexes={shown}
          columns={columns}
          min={bounds.min}
        />
      ) : (
        shown.map(index => (
          <TreeNode
            key={index}
            path={[...path, String(index)]}
            value={value[index] ?? null}
            parent={{
              kind: "array",
              path,
              index,
              length: value.length,
              min: bounds.min,
            }}
          />
        ))
      )}
      {remaining > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => tree.extendItems(pointer, limit + ARRAY_BATCH)}
          data-testid="job-review-tree-button-show-more"
          className="cursor-pointer self-start"
        >
          {t("showMore", { count: remaining })}
        </Button>
      ) : null}
    </Group>
  );
}

/** 객체 배열의 항목 하나: 순번 머리줄과 항목 메뉴, 그 아래 필드들. */
function ItemBlock({
  path,
  parent,
  value,
  children,
}: {
  path: JsonPath;
  parent: Extract<Parent, { kind: "array" }>;
  value: JsonValue;
  children: ReactNode;
}) {
  const tree = useTree();
  const title = String(parent.index + 1);
  const error = tree.errorAt(toPointer(path));
  return (
    <div
      data-node-id={nodeId(tree.props.result.id, path)}
      className="flex min-w-0 flex-col gap-1 pt-1"
    >
      <div className="flex min-w-0 items-center gap-2 px-2 text-xs text-muted-foreground">
        <span className="shrink-0 font-medium">{title}</span>
        <span aria-hidden="true" className="h-px min-w-0 flex-1 bg-border" />
        <NodeMenu
          path={path}
          value={value}
          match={null}
          parent={parent}
          title={title}
        />
      </div>
      {error ? <NodeError error={error} /> : null}
      <div className="flex min-w-0 flex-col gap-1 pl-2">{children}</div>
    </div>
  );
}

function ObjectBody({
  path,
  value,
  match,
}: {
  path: JsonPath;
  value: JsonObject;
  match: SchemaMatch | null;
}) {
  const t = useTranslations("review.values");
  const tree = useTree();
  const keys = Object.keys(value);
  // "필드" 메뉴로 숨긴 맨 위 필드는 "필드 추가" 에도 넣지 않는다(추가해도 보이지 않으므로).
  const { isFieldShown } = tree;
  const missing = useMemo(
    () =>
      missingProperties(match, value, tree.schema ?? undefined).filter(item =>
        isFieldShown([...path, item.key]),
      ),
    [match, value, tree.schema, isFieldShown, path],
  );
  return (
    <>
      {keys.map(key => (
        <TreeNode
          key={key}
          path={[...path, key]}
          value={value[key] ?? null}
          parent={{ kind: "object", path, match, key, siblings: keys }}
        />
      ))}
      {keys.length === 0 && missing.length === 0 ? (
        <p className="px-2 py-1 text-sm text-muted-foreground">
          {t("noFields")}
        </p>
      ) : null}
      {missing.length > 0 ? (
        <AddFieldMenu path={path} missing={missing} />
      ) : null}
    </>
  );
}

function ValueRow({
  path,
  value,
  match,
  title,
  parent,
}: {
  path: JsonPath;
  value: JsonValue;
  match: SchemaMatch | null;
  title: string;
  parent: Parent | null;
}) {
  const t = useTranslations("review.values");
  const tc = useTranslations("review.chips");
  const tree = useTree();
  const {
    result,
    step,
    locked,
    highlights,
    errors,
    onEditJson,
    onSelectHighlight,
    onHoverHighlight,
    onApply,
    onRevert,
  } = tree.props;
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const warningId = `${inputId}-warning`;
  const descriptionId = `${inputId}-description`;
  // 위젯이 거부한 입력의 오류는 그때의 값에 묶는다. 배열 행은 `key={index}` 라 항목을 지우거나
  // 옮기면 이 컴포넌트가 다른 항목을 그리는데, 그 항목에 오류가 넘어가지 않게 한다.
  const [error, setError] = useState<ValueBoundError | null>(null);
  const pointer = toPointer(path);
  // 위젯 파싱 오류가 먼저, 없으면 이 행을 가리키는 서버·schema 오류. 입력과 aria 로 연결한다.
  // 경고(글자 수 한도 등)는 저장을 막지 않으므로 오류 행으로 그리지 않고 흐린 문구로 설명만 잇는다.
  const fieldError = errors.get(pointer) ?? null;
  const rowError =
    boundErrorMessage(error, value) ??
    (fieldError?.severity === "error" ? fieldError.message : null);
  const rowWarning =
    rowError === null && fieldError?.severity === "warning"
      ? fieldError.message
      : null;
  const widget = widgetFor(step, match, value);
  const machine =
    tree.baseContent === undefined
      ? undefined
      : valueAt(tree.baseContent, path);
  const changed = !jsonEquals(machine, value);
  const highlight = highlights.get(pointer) ?? null;
  const selected = tree.selectedPointer === pointer;
  const revert = useCallback(
    () => onRevert(result.id, path),
    [onRevert, result.id, path],
  );

  // schema 설명은 값 패널의 "설명 보기" 를 켰을 때만 보인다(기본 숨김).
  const description = tree.props.showDescription
    ? fieldDescription(match?.node ?? null)
    : null;
  // 오류, 경고가 먼저, 그 뒤 도움말. 도움말은 한 줄로 줄어 보여도 화면 낭독기는 전체를 읽는다.
  const describedBy =
    [
      rowError ? errorId : rowWarning ? warningId : null,
      description ? descriptionId : null,
    ]
      .filter(id => id !== null)
      .join(" ") || undefined;

  return (
    <FieldRow
      title={title}
      fieldKey={parent?.kind === "object" ? parent.key : undefined}
      description={description}
      descriptionId={descriptionId}
      labelFor={inputId}
      pointer={pointer}
      // 원본 값 줄은 바뀐 행에만 보인다(바뀌지 않은 행은 입력값이 곧 원본 값).
      machineValue={
        !changed || machine === undefined
          ? undefined
          : displayValue(machine) || t("empty")
      }
      changed={changed}
      onRevert={revert}
      selected={selected}
      onSelect={highlight ? () => onSelectHighlight(highlight) : undefined}
      onHoverChange={
        highlight
          ? hovering => onHoverHighlight(hovering ? highlight.id : null)
          : undefined
      }
      locked={locked}
      chip={
        changed ? <StatusChip kind="changed">{tc("changed")}</StatusChip> : null
      }
      actions={
        <NodeMenu
          path={path}
          value={value}
          match={match}
          parent={parent}
          title={title}
        />
      }
      error={rowError}
      errorId={errorId}
      labels={{
        revert: t("revert"),
        machine: t("machine"),
        keyTitle: key => t("keyTitle", { key }),
        descriptionTitle: text => t("descriptionTitle", { text }),
      }}
      data-field-id={nodeId(result.id, path)}
      testId="job-review-field-row"
    >
      <ValueWidget
        id={inputId}
        widget={widget}
        value={value}
        disabled={locked}
        invalid={rowError !== null}
        describedBy={describedBy}
        onCommit={next =>
          onApply(
            result.id,
            path,
            clearedValue(
              next,
              tree.props.originalValueAt
                ? tree.props.originalValueAt(result.id, path)
                : machine,
            ),
          )
        }
        onError={message =>
          setError(message === null ? null : { value, message })
        }
        onEditJson={onEditJson}
        testId="job-review-field"
      />
      {rowWarning ? (
        <p
          id={warningId}
          data-testid="job-review-field-row-warning"
          className="pt-1 text-xs break-words text-muted-foreground"
        >
          {rowWarning}
        </p>
      ) : null}
    </FieldRow>
  );
}
