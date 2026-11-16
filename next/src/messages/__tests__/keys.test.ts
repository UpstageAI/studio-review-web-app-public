import { describe, expect, it } from "vitest";

import en from "../en.json";
import ja from "../ja.json";
import ko from "../ko.json";

/** 중첩 메시지 객체의 leaf 키를 `a.b.c` 경로로 모은다. */
function collectKeys(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [prefix];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    collectKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

/** 중첩 메시지 객체의 leaf 를 `a.b.c` 경로 → 문자열로 모은다. */
function collectMessages(value: unknown, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof value === "string") {
    out.set(prefix, value);
    return out;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return out;
  }
  for (const [key, child] of Object.entries(value)) {
    for (const [path, message] of collectMessages(
      child,
      prefix ? `${prefix}.${key}` : key,
    )) {
      out.set(path, message);
    }
  }
  return out;
}

const BRANCHING_TYPES = new Set(["plural", "select", "selectordinal"]);

/**
 * ICU 메시지의 인자 이름(`{name}`·`{name, number}`·`{name, plural, …}` 의 `name`)을 모은다. plural·select
 * 분기 안의 메시지도 따라 들어가고, 분기 키(`one`·`other`·`=0`)와 `'{'` 처럼 따옴표로 감싼 중괄호는 인자가 아니다.
 */
function icuArgumentNames(message: string): string[] {
  const names = new Set<string>();
  let i = 0;

  const skipSpace = () => {
    while (i < message.length && /\s/.test(message[i])) i += 1;
  };
  const readUntil = (stops: string) => {
    const start = i;
    while (i < message.length && !stops.includes(message[i])) i += 1;
    return message.slice(start, i).trim();
  };
  /** 중괄호 짝을 맞춰 현재 인자의 닫는 `}` 뒤로 간다(number·date 서식 등). */
  const skipToClose = () => {
    let depth = 1;
    while (i < message.length && depth > 0) {
      if (message[i] === "{") depth += 1;
      else if (message[i] === "}") depth -= 1;
      i += 1;
    }
  };
  /** 메시지 본문을 읽는다. `nested` 면 짝이 되는 `}` 를 만나면 그 뒤에서 멈춘다. */
  const parseMessage = (nested: boolean) => {
    while (i < message.length) {
      const ch = message[i];
      if (ch === "'") {
        const next = message[i + 1];
        if (next === "'") {
          i += 2;
        } else if (next === "{" || next === "}") {
          const close = message.indexOf("'", i + 1);
          i = close === -1 ? message.length : close + 1;
        } else {
          i += 1;
        }
      } else if (ch === "{") {
        i += 1;
        parseArgument();
      } else if (ch === "}" && nested) {
        i += 1;
        return;
      } else {
        i += 1;
      }
    }
  };
  const parseArgument = () => {
    const name = readUntil(",}");
    if (name) names.add(name);
    if (message[i] === "}") {
      i += 1;
      return;
    }
    i += 1;
    const type = readUntil(",}");
    if (message[i] === "}") {
      i += 1;
      return;
    }
    if (!BRANCHING_TYPES.has(type)) {
      i += 1;
      skipToClose();
      return;
    }
    i += 1;
    while (i < message.length) {
      skipSpace();
      if (message[i] === "}") {
        i += 1;
        return;
      }
      readUntil("{} \t\n");
      skipSpace();
      if (message[i] === "{") {
        i += 1;
        parseMessage(true);
      }
    }
  };

  parseMessage(false);
  return [...names].sort();
}

describe("messages", () => {
  it("ko·ja 의 키 집합이 en 과 같다", () => {
    const base = new Set(collectKeys(en));
    for (const [locale, messages] of [
      ["ko", ko],
      ["ja", ja],
    ] as const) {
      const keys = new Set(collectKeys(messages));
      const missing = [...base].filter(key => !keys.has(key));
      const extra = [...keys].filter(key => !base.has(key));
      expect({ locale, missing, extra }).toEqual({
        locale,
        missing: [],
        extra: [],
      });
    }
  });

  it("ko·ja 의 각 메시지가 en 과 같은 ICU 인자 이름을 쓴다", () => {
    const base = collectMessages(en);
    for (const [locale, messages] of [
      ["ko", ko],
      ["ja", ja],
    ] as const) {
      const mismatched: { key: string; en: string[]; other: string[] }[] = [];
      for (const [key, message] of collectMessages(messages)) {
        const reference = base.get(key);
        if (reference === undefined) continue;
        const expected = icuArgumentNames(reference);
        const actual = icuArgumentNames(message);
        if (expected.join(",") !== actual.join(",")) {
          mismatched.push({ key, en: expected, other: actual });
        }
      }
      expect({ locale, mismatched }).toEqual({ locale, mismatched: [] });
    }
  });
});

describe("icuArgumentNames", () => {
  it("단순 인자와 서식 인자의 이름을 모은다", () => {
    expect(icuArgumentNames("{name}, page {page}")).toEqual(["name", "page"]);
    expect(icuArgumentNames("{size, number} bytes")).toEqual(["size"]);
  });

  it("plural·select 분기 키는 빼고 분기 안의 인자는 모은다", () => {
    expect(
      icuArgumentNames(
        "{count, plural, =0 {none} one {# item} other {# items of {total}}}",
      ),
    ).toEqual(["count", "total"]);
    expect(
      icuArgumentNames("{kind, select, file {a file} other {{name}}}"),
    ).toEqual(["kind", "name"]);
  });

  it("따옴표로 감싼 중괄호와 일반 apostrophe 는 인자가 아니다", () => {
    expect(icuArgumentNames("Don't use '{literal}' here, {name}")).toEqual([
      "name",
    ]);
  });

  it("인자가 없으면 빈 배열", () => {
    expect(icuArgumentNames("No arguments")).toEqual([]);
  });
});
