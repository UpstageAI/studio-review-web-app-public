import {
  cloneJson,
  isIntegerNumber,
  isJsonNumber,
  isJsonObject,
  jsonEquals,
  type JsonObject,
  type JsonValue,
} from "./json";
import type { ReviewStep } from "./types";
import { isValidateStepType } from "./step-names";

/** 값 경로. 배열 index 도 문자열 토큰("0")으로 둔다(JSON Pointer 와 같음). */
export type JsonPath = readonly string[];

/** RFC 6901. 빈 경로는 `""`(문서 전체). */
export function toPointer(path: JsonPath): string {
  return path
    .map(token => "/" + token.replace(/~/g, "~0").replace(/\//g, "~1"))
    .join("");
}

/** RFC 6901 역변환. 형식이 틀리면(`/` 로 시작하지 않음, `~0`·`~1` 밖 이스케이프) `null`. */
export function fromPointer(pointer: string): JsonPath | null {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) return null;
  const out: string[] = [];
  for (const token of pointer.slice(1).split("/")) {
    if (/~(?![01])/.test(token)) return null;
    out.push(token.replace(/~1/g, "/").replace(/~0/g, "~"));
  }
  return out;
}

export type ContentLeaf = {
  readonly path: JsonPath;
  readonly value: JsonValue;
};

/**
 * `content` 의 leaf(scalar) 목록. 객체 키 순서·배열 순서를 따른다. scalar
 * `content`(Validate 판정 등)는 경로 `[]` 의 leaf 하나. 빈 객체·배열은 leaf 가 없다.
 */
export function contentLeaves(content: JsonValue): ContentLeaf[] {
  const out: ContentLeaf[] = [];
  const walk = (value: JsonValue, path: string[]) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, [...path, String(index)]));
      return;
    }
    if (isJsonObject(value)) {
      for (const key of Object.keys(value)) {
        walk(value[key] ?? null, [...path, key]);
      }
      return;
    }
    out.push({ path, value });
  };
  walk(content, []);
  return out;
}

// ---------------------------------------------------------------------------
// Schema 탐색
// ---------------------------------------------------------------------------

/**
 * Step `schema` 의 노드. Config 가 주는 임의 JSON Schema 라 모든 키를 방어적으로
 * 읽는다(아래 접근자 사용).
 */
export type SchemaNode = { readonly [key: string]: JsonValue };

export type SchemaMatch = {
  readonly node: SchemaNode;
  /** `anyOf`/`oneOf` 의 `{type:"null"}` 분기나 `type: [..., "null"]` 로 null 을 허용. */
  readonly nullable: boolean;
};

type ValueType =
  "null" | "boolean" | "string" | "number" | "integer" | "object" | "array";

function asNode(value: JsonValue | undefined): SchemaNode | null {
  return isJsonObject(value) ? (value as SchemaNode) : null;
}

function prop(node: SchemaNode, key: string): JsonValue | undefined {
  return Object.hasOwn(node, key) ? node[key] : undefined;
}

function typesOf(node: SchemaNode): string[] {
  const type = prop(node, "type");
  if (typeof type === "string") return [type];
  if (Array.isArray(type)) {
    return type.filter((item): item is string => typeof item === "string");
  }
  return [];
}

function enumOf(node: SchemaNode): readonly JsonValue[] | null {
  const values = prop(node, "enum");
  if (Array.isArray(values)) return values;
  const constant = prop(node, "const");
  return constant === undefined ? null : [constant];
}

function variantsOf(node: SchemaNode): SchemaNode[] | null {
  const variants = prop(node, "anyOf") ?? prop(node, "oneOf");
  if (!Array.isArray(variants)) return null;
  return variants
    .map(item => asNode(item))
    .filter((item): item is SchemaNode => item !== null);
}

const MAX_REF_HOPS = 32;

/** 같은 schema 안의 `$ref: "#/..."` 만 따라간다. */
function deref(node: SchemaNode | null, root: SchemaNode): SchemaNode | null {
  let current = node;
  for (let hop = 0; current && hop < MAX_REF_HOPS; hop++) {
    const ref = prop(current, "$ref");
    if (typeof ref !== "string") return current;
    if (!ref.startsWith("#")) return null;
    const path = fromPointer(ref.slice(1));
    if (!path) return null;
    let target: JsonValue | undefined = root as JsonValue;
    for (const token of path) {
      if (Array.isArray(target)) target = target[Number(token)];
      else if (isJsonObject(target) && Object.hasOwn(target, token)) {
        target = target[token];
      } else target = undefined;
    }
    current = asNode(target);
  }
  return null;
}

function isNullOnly(node: SchemaNode): boolean {
  const types = typesOf(node);
  if (types.length > 0) return types.every(type => type === "null");
  const values = enumOf(node);
  return values !== null && values.length > 0 && values.every(v => v === null);
}

function expand(
  node: SchemaNode | null,
  root: SchemaNode,
  depth = 0,
): { branches: SchemaNode[]; nullable: boolean } {
  const resolved = deref(node, root);
  if (!resolved || depth > MAX_REF_HOPS)
    return { branches: [], nullable: false };
  const variants = variantsOf(resolved);
  const structural =
    typesOf(resolved).length > 0 ||
    enumOf(resolved) !== null ||
    prop(resolved, "properties") !== undefined ||
    prop(resolved, "items") !== undefined;
  if (!variants || structural) {
    const types = typesOf(resolved);
    const values = enumOf(resolved);
    return {
      branches: [resolved],
      nullable:
        types.includes("null") || (values !== null && values.includes(null)),
    };
  }
  const branches: SchemaNode[] = [];
  let nullable = false;
  for (const variant of variants) {
    const target = deref(variant, root);
    if (!target) continue;
    if (isNullOnly(target)) {
      nullable = true;
      continue;
    }
    const inner = expand(target, root, depth + 1);
    branches.push(...inner.branches);
    nullable ||= inner.nullable;
  }
  return { branches, nullable };
}

function typeFits(type: string, value: JsonValue): boolean {
  switch (type as ValueType) {
    case "null":
      return value === null;
    case "boolean":
      return typeof value === "boolean";
    case "string":
      return typeof value === "string";
    case "number":
      return isJsonNumber(value);
    case "integer":
      return isJsonNumber(value) && isIntegerNumber(value);
    case "object":
      return isJsonObject(value);
    case "array":
      return Array.isArray(value);
    default:
      return true;
  }
}

function branchFits(node: SchemaNode, value: JsonValue): boolean {
  const values = enumOf(node);
  if (values !== null) return values.some(item => jsonEquals(item, value));
  const types = typesOf(node);
  if (types.length > 0) return types.some(type => typeFits(type, value));
  if (prop(node, "properties") !== undefined) return isJsonObject(value);
  if (prop(node, "items") !== undefined) return Array.isArray(value);
  return true;
}

function canContain(node: SchemaNode, kind: "object" | "array"): boolean {
  const types = typesOf(node);
  if (types.includes(kind)) return true;
  return kind === "object"
    ? prop(node, "properties") !== undefined ||
        prop(node, "additionalProperties") !== undefined
    : prop(node, "items") !== undefined ||
        prop(node, "prefixItems") !== undefined;
}

const INDEX_TOKEN = /^(0|[1-9]\d*)$/;

/** 경로 토큰이 배열 위치(`"0"`·`"12"`)인가. */
export function isIndexToken(key: string): boolean {
  return INDEX_TOKEN.test(key);
}

function child(node: SchemaNode, key: string): SchemaNode | null {
  if (INDEX_TOKEN.test(key)) {
    const prefix = prop(node, "prefixItems");
    if (Array.isArray(prefix) && Number(key) < prefix.length) {
      return asNode(prefix[Number(key)]);
    }
    const items = asNode(prop(node, "items"));
    if (items) return items;
  }
  const properties = asNode(prop(node, "properties"));
  if (properties && Object.hasOwn(properties, key)) {
    return asNode(properties[key]);
  }
  return asNode(prop(node, "additionalProperties"));
}

/**
 * 값 경로의 schema 노드. 객체 키는 `properties`(없으면 `additionalProperties`),
 * 숫자 키는 `items`, `anyOf`/`oneOf` 는 `{type:"null"}` 분기를 빼고 `nullable` 로
 * 알린다. 여러 분기가 남으면 `value` 의 타입에 맞는 분기를 고른다. 경로가 schema
 * 에 없으면 `null`.
 */
export function schemaAt(
  schema: SchemaNode | null | undefined,
  path: JsonPath,
  value?: JsonValue,
): SchemaMatch | null {
  if (!schema) return null;
  const root = schema;
  let node: SchemaNode | null = schema;
  for (const key of path) {
    const { branches } = expand(node, root);
    const kind = INDEX_TOKEN.test(key) ? "array" : "object";
    const container =
      branches.find(branch => canContain(branch, kind)) ??
      branches.find(branch => child(branch, key) !== null) ??
      null;
    node = container ? child(container, key) : null;
    if (!node) return null;
  }
  const { branches, nullable } = expand(node, root);
  if (branches.length === 0) {
    const resolved = deref(node, root);
    return resolved ? { node: resolved, nullable: true } : null;
  }
  const picked =
    (value !== undefined && value !== null
      ? branches.find(branch => branchFits(branch, value))
      : undefined) ?? branches[0];
  return picked ? { node: picked, nullable } : null;
}

// ---------------------------------------------------------------------------
// 위젯·검사·표시
// ---------------------------------------------------------------------------

export type Widget =
  | { kind: "enum"; options: readonly JsonValue[]; nullable: boolean }
  | { kind: "verdict" }
  | { kind: "boolean" }
  | { kind: "number"; integer: boolean }
  | { kind: "text"; multiline: boolean; long?: true }
  | { kind: "object" }
  | { kind: "array" }
  | { kind: "json" };

const MULTILINE_MAX_LENGTH = 120;
const MULTILINE_VALUE_LENGTH = 80;

/**
 * 이보다 긴 문자열은 입력칸 대신 읽기 전용 요약(`long`)으로 그린다. 수 MiB 문자열을 textarea 에
 * 넣으면 레이아웃이 멈추므로, 이런 값은 결과 전체 JSON 편집으로 고친다.
 */
export const LONG_TEXT_LENGTH = 10_000;

function textWidget(node: SchemaNode | null, value: JsonValue): Widget {
  if (typeof value === "string" && value.length > LONG_TEXT_LENGTH) {
    return { kind: "text", multiline: true, long: true };
  }
  const maxLength = node ? prop(node, "maxLength") : undefined;
  const multiline =
    (typeof maxLength === "number" && maxLength > MULTILINE_MAX_LENGTH) ||
    (typeof value === "string" &&
      (value.length > MULTILINE_VALUE_LENGTH || value.includes("\n")));
  return { kind: "text", multiline };
}

function inferWidget(value: JsonValue): Widget {
  if (typeof value === "boolean") return { kind: "boolean" };
  if (isJsonNumber(value)) return { kind: "number", integer: false };
  if (Array.isArray(value)) return { kind: "array" };
  if (isJsonObject(value)) return { kind: "object" };
  // 문자열과 null 은 문자열 입력(null 로 되돌리기는 host 가 둔다).
  return textWidget(null, value);
}

/**
 * leaf 편집 위젯. Validate Step 이면 판정(`verdict`). schema 가 없거나 타입을
 * 말하지 않으면 현재 값 타입으로 추론하고, 타입이 여럿이거나 값과 맞지 않으면 `json`.
 */
export function widgetFor(
  step: Pick<ReviewStep, "type"> | null | undefined,
  match: SchemaMatch | null,
  value: JsonValue,
): Widget {
  if (isValidateStepType(step?.type)) return { kind: "verdict" };
  if (!match) return inferWidget(value);
  const { node } = match;
  let nullable = match.nullable;
  const values = enumOf(node);
  if (values !== null) {
    return {
      kind: "enum",
      options: values.filter(item => item !== null),
      nullable: nullable || values.includes(null),
    };
  }
  const allTypes = typesOf(node);
  nullable ||= allTypes.includes("null");
  const types = allTypes.filter(type => type !== "null");
  if (types.length > 1) return { kind: "json" };
  const type = types[0];
  if (type === undefined) {
    if (prop(node, "properties") !== undefined) return { kind: "object" };
    if (prop(node, "items") !== undefined) return { kind: "array" };
    return inferWidget(value);
  }
  if (value !== null && !typeFits(type, value)) return { kind: "json" };
  switch (type) {
    case "boolean":
      return { kind: "boolean" };
    case "integer":
      return { kind: "number", integer: true };
    case "number":
      return { kind: "number", integer: false };
    case "string":
      return textWidget(node, value);
    case "object":
      return { kind: "object" };
    case "array":
      return { kind: "array" };
    default:
      return { kind: "json" };
  }
}

export type SchemaProblem = {
  /** `"enum"` 이거나 허용 타입을 `|` 로 이은 것(`"integer"`, `"string | null"`). */
  readonly expected: string;
  readonly allowed?: readonly JsonValue[];
};

/**
 * 값이 schema 노드와 맞지 않는 이유, 맞으면 `null`. enum·const·type 만 본다
 * (서버가 업로드 때 같은 schema 전체로 다시 검사한다).
 */
export function schemaProblem(
  match: SchemaMatch | null,
  value: JsonValue,
): SchemaProblem | null {
  if (!match) return null;
  const { node } = match;
  const types = typesOf(node);
  if (value === null && allowsNull(match)) return null;
  const values = enumOf(node);
  if (values !== null) {
    return values.some(item => jsonEquals(item, value))
      ? null
      : { expected: "enum", allowed: values };
  }
  if (types.length === 0) return null;
  if (types.some(type => typeFits(type, value))) return null;
  // `anyOf` 의 null 분기·`nullable: true` 처럼 type 밖에서 null 을 허용하면 문구에 함께 보인다.
  const shown =
    allowsNull(match) && !types.includes("null") ? [...types, "null"] : types;
  return { expected: shown.join(" | ") };
}

/** 결과가 항목 하나짜리 배열인가(`[{…}]`). */
export function isSingleWrapped(content: JsonValue): boolean {
  return Array.isArray(content) && content.length === 1;
}

/**
 * 항목 하나짜리 배열 결과가 서버 저장 형식의 래퍼인가: 루트 schema 가 배열이 아닌데(schema
 * 가 없어도) 값이 `[{…}]` 이면 그 항목이 실제 값이다. 래퍼는 화면에 단계로 그리지 않고 배열
 * 조작도 두지 않으며, schema 는 래퍼를 뺀 경로로 찾는다.
 */
export function isHiddenWrapper(
  schema: SchemaNode | null | undefined,
  content: JsonValue,
): boolean {
  if (!isSingleWrapped(content)) return false;
  const match = schemaAt(schema, []);
  // 값 대신 `null` 을 넘겨 schema 가 말하는 타입만 본다.
  return match === null || widgetFor(undefined, match, null).kind !== "array";
}

/** schema 를 찾을 경로(래퍼의 맨 앞 `0` 을 뺀 것). */
export function schemaPath(wrapped: boolean, path: JsonPath): JsonPath {
  return wrapped && path[0] === "0" ? path.slice(1) : path;
}

/** 필드 표시 이름: schema `title`, 없으면 경로 마지막 토큰. */
export function fieldTitle(node: SchemaNode | null, path: JsonPath): string {
  const title = node ? prop(node, "title") : undefined;
  if (typeof title === "string" && title.trim() !== "") return title;
  return path[path.length - 1] ?? "";
}

export function fieldDescription(node: SchemaNode | null): string | null {
  const description = node ? prop(node, "description") : undefined;
  return typeof description === "string" && description.trim() !== ""
    ? description
    : null;
}

// ---------------------------------------------------------------------------
// 빈 값 템플릿·빈 필드·한도
// ---------------------------------------------------------------------------

/**
 * `null` 을 넣을 수 있는가: `anyOf`/`oneOf` 의 null 분기, `type` 의 `"null"`,
 * OpenAPI `nullable: true`, null 을 담은 `enum`. schema 가 없으면(`match` 가 `null`)
 * 제약이 없으므로 `true`.
 */
export function allowsNull(match: SchemaMatch | null): boolean {
  if (!match) return true;
  const { node } = match;
  if (match.nullable || typesOf(node).includes("null")) return true;
  if (prop(node, "nullable") === true) return true;
  const values = enumOf(node);
  return values !== null && values.includes(null);
}

function nonNegativeInteger(value: JsonValue | undefined): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

/** 배열 한도(`minItems`·`maxItems`). 서버는 보지 않으므로 안내용이다. */
export function arrayBounds(match: SchemaMatch | null): {
  readonly min?: number;
  readonly max?: number;
} {
  if (!match) return {};
  const min = nonNegativeInteger(prop(match.node, "minItems"));
  const max = nonNegativeInteger(prop(match.node, "maxItems"));
  return {
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
  };
}

/** 문자열 길이 한도(`minLength`·`maxLength`, code point 기준). 서버는 보지 않으므로 안내용이다. */
export function stringBounds(match: SchemaMatch | null): {
  readonly min?: number;
  readonly max?: number;
} {
  if (!match) return {};
  const min = nonNegativeInteger(prop(match.node, "minLength"));
  const max = nonNegativeInteger(prop(match.node, "maxLength"));
  return {
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
  };
}

function requiredOf(node: SchemaNode): string[] {
  const required = prop(node, "required");
  return Array.isArray(required)
    ? required.filter((item): item is string => typeof item === "string")
    : [];
}

function propertiesOf(node: SchemaNode): SchemaNode | null {
  return asNode(prop(node, "properties"));
}

/** 객체 schema 에서 `key` 가 `required` 인가. */
export function isRequiredKey(match: SchemaMatch | null, key: string): boolean {
  return match ? requiredOf(match.node).includes(key) : false;
}

export type MissingProperty = {
  readonly key: string;
  readonly title: string;
  readonly description: string | null;
  readonly required: boolean;
};

/**
 * 객체 `value` 에 없는 schema `properties` 키(schema 순서). 값이 객체가 아니거나
 * `properties` 가 없으면 빈 배열. `root` 를 주면 속성의 `$ref` 를 따라 제목을 읽는다.
 */
export function missingProperties(
  match: SchemaMatch | null,
  value: JsonValue,
  root?: SchemaNode,
): MissingProperty[] {
  if (!match || !isJsonObject(value)) return [];
  const properties = propertiesOf(match.node);
  if (!properties) return [];
  const required = requiredOf(match.node);
  return Object.keys(properties)
    .filter(key => !Object.hasOwn(value, key))
    .map(key => {
      const raw = asNode(properties[key]);
      const node = root ? deref(raw, root) : raw;
      return {
        key,
        title: fieldTitle(node, [key]),
        description: fieldDescription(node),
        required: required.includes(key),
      };
    });
}

/** 템플릿이 만드는 배열 항목 수 상한(`minItems` 가 비정상적으로 클 때). */
const MAX_TEMPLATE_ITEMS = 100;

function objectWith(entries: readonly (readonly [string, JsonValue])[]) {
  const out: JsonObject = {};
  for (const [key, value] of entries) {
    // `__proto__` 같은 키도 데이터로 둔다.
    Object.defineProperty(out, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

function templateOfNode(
  node: SchemaNode | null,
  root: SchemaNode,
  depth: number,
): JsonValue {
  if (depth > MAX_REF_HOPS) return null;
  const resolved = deref(node, root);
  if (!resolved) return null;
  const fallback = prop(resolved, "default");
  if (fallback !== undefined) return cloneJson(fallback);
  const { branches, nullable } = expand(resolved, root);
  const branch = branches[0];
  if (!branch) return null;
  return templateOfBranch({ node: branch, nullable }, root, depth);
}

function templateOfBranch(
  match: SchemaMatch,
  root: SchemaNode,
  depth: number,
): JsonValue {
  const { node } = match;
  const fallback = prop(node, "default");
  if (fallback !== undefined) return cloneJson(fallback);
  const constant = prop(node, "const");
  if (constant !== undefined) return cloneJson(constant);
  const values = prop(node, "enum");
  if (Array.isArray(values)) {
    if (allowsNull(match)) return null;
    const first = values.find(item => item !== null);
    return first === undefined ? null : cloneJson(first);
  }
  const types = typesOf(node).filter(type => type !== "null");
  const kind =
    types[0] ??
    (prop(node, "properties") !== undefined
      ? "object"
      : prop(node, "items") !== undefined ||
          prop(node, "prefixItems") !== undefined
        ? "array"
        : undefined);
  // 객체·배열은 nullable 이어도 빈 모양을 만든다(채우려고 추가하는 자리이고, 서버는
  // 객체 배열 항목의 null 을 받지 않는다). scalar 는 nullable 이면 null.
  if (kind !== "object" && kind !== "array" && allowsNull(match)) return null;
  switch (kind) {
    case "string":
      return "";
    case "number":
    case "integer":
      return 0;
    case "boolean":
      return false;
    case "array": {
      const count = Math.min(arrayBounds(match).min ?? 0, MAX_TEMPLATE_ITEMS);
      return Array.from({ length: count }, (_, index) =>
        templateOfNode(child(node, String(index)), root, depth + 1),
      );
    }
    case "object": {
      const properties = propertiesOf(node);
      if (!properties) return {};
      const required = requiredOf(node);
      const keys = required.length > 0 ? required : Object.keys(properties);
      return objectWith(
        keys.map(key => [
          key,
          templateOfNode(
            Object.hasOwn(properties, key) ? asNode(properties[key]) : null,
            root,
            depth + 1,
          ),
        ]),
      );
    }
    default:
      return null;
  }
}

/**
 * 새 자리(배열 항목·추가 필드)의 시작 값. `default` → `const` → `enum`(null 허용이면
 * `null`, 아니면 첫 값) → null 허용 scalar 는 `null` → 타입별 빈 값(`""`·`0`·`false`,
 * 배열 `[]` 또는 `minItems` 만큼 항목 템플릿, 객체는 `required` 키 — `required` 가
 * 없으면 `properties` 전부 — 를 재귀로). `anyOf`/`oneOf` 는 첫 분기, 타입 정보가
 * 없으면 `null`. null 을 받지 않는 자리에 `null` 을 넣지 않는다.
 */
export function templateFor(
  match: SchemaMatch | null,
  root: SchemaNode,
): JsonValue {
  if (!match) return null;
  return templateOfBranch(match, root, 0);
}
