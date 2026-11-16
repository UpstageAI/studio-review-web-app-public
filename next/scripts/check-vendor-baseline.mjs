#!/usr/bin/env node
// shadcn CLI 가 설치한 파일(src/components/ui/**, src/components/studio-ui-kit/**)의 브라우저 baseline 검사.
// 이 폴더는 ESLint 에서 빠지므로(바이트 그대로 보존) eslint.config.mjs 의 no-restricted-properties 와 같은
// 내장 메서드를 여기서 찾아 경고만 한다. vendor 는 고치지 않고 사용처나 item 업데이트로 다룬다.
// Node 내장 모듈만 쓴다.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR_DIRS = [
  join(ROOT, "src/components/ui"),
  join(ROOT, "src/components/studio-ui-kit"),
];

function listFiles(dir, { recursive, extensions }) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir, { recursive, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => join(entry.parentPath ?? entry.path, entry.name))
    .filter(file => extensions.some(ext => file.endsWith(ext)))
    .sort();
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

const rel = file => relative(ROOT, file);

const BASELINE_RULES = [
  /\.(?:toSorted|toReversed|toSpliced)\(/g,
  /Object\.groupBy/g,
  /Map\.groupBy/g,
  /Promise\.withResolvers/g,
  /Array\.fromAsync/g,
  /URL\.canParse/g,
];

function scanVendorBaseline() {
  const warnings = [];
  for (const dir of VENDOR_DIRS) {
    for (const file of listFiles(dir, {
      recursive: true,
      extensions: [".ts", ".tsx", ".js", ".jsx"],
    })) {
      const text = readFileSync(file, "utf8");
      for (const re of BASELINE_RULES) {
        re.lastIndex = 0;
        for (const match of text.matchAll(re)) {
          warnings.push(
            `${rel(file)}:${lineOf(text, match.index)}: ${match[0]} — 빌드 타깃(firefox 111 / safari 16.4)에 없는 내장 메서드`,
          );
        }
      }
    }
  }
  return warnings;
}

const warnings = scanVendorBaseline();

for (const warning of warnings) console.warn(`warning  ${warning}`);
if (warnings.length > 0) {
  console.warn(
    "vendor 파일은 직접 고치지 않는다. 사용처에서 해당 기능을 피하거나 item 업데이트를 확인한다.",
  );
}

console.log(`check:vendor-baseline — 경고 ${warnings.length}건`);
