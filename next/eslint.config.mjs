import { readdirSync, readFileSync } from "node:fs";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettier from "eslint-plugin-prettier/recommended";
import globals from "globals";

// 앱 층(아래 import/no-restricted-paths 블록). 경로는 lint 를 실행하는 next/ 기준.
const LAYER1 = [
  "./src/components/job-review",
  "./src/lib/review-model",
  "./src/lib/review-policy",
  "./src/lib/revision-history",
  "./src/lib/review-api",
];
const LAYER2 = [
  "./src/components/collections",
  "./src/components/leave-guard-store.ts",
  "./src/components/leave-guard-link.tsx",
  "./src/lib/review-status.ts",
];
const SHOWCASE_DIR = "./src/components/showcase";
// 3 층 중 제자리(lib)에 남은 파일.
const SHOWCASE_LIBS = [
  "./src/lib/recent-jobs.ts",
  "./src/lib/review-api/activity.ts",
  "./src/lib/upstage/lineage.ts",
  "./src/lib/review-status-aggregate.ts",
];
// 검수 화면이 쓰는 Collection 공용 UI·링크(1 → 2 허용 목록, components/collections 기준).
const LAYER1_ALLOWED_COLLECTIONS = [
  "./links.ts",
  "./review-status-badge.tsx",
  "./list-state.tsx",
  "./cursor-pagination.tsx",
  "./cursor-block.ts",
];

// app/** 아래 첫 문장이 "use client" 인 파일(브라우저로 번들된다). 설정 로드 때 파일을 읽어 목록을 만든다.
// 경로의 [locale] 같은 대괄호는 glob 문자로 읽히므로 글자 그대로 맞도록 [[] · []] 로 바꾼다.
const APP_DIR = "src/app";
const USE_CLIENT_FIRST =
  /^(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*["']use client["']/;
const appClientFiles = readdirSync(new URL(`./${APP_DIR}`, import.meta.url), {
  recursive: true,
})
  .map(file => String(file).replaceAll("\\", "/"))
  .filter(file => /\.tsx?$/.test(file))
  .filter(file =>
    USE_CLIENT_FIRST.test(
      readFileSync(new URL(`./${APP_DIR}/${file}`, import.meta.url), "utf8"),
    ),
  )
  .map(file => `./${APP_DIR}/${file}`.replace(/[[\]]/g, char => `[${char}]`));

// UI Kit 데모 화면 폴더의 파일은 "use client" 가 없어도 client 파일(demo-view.tsx 등)이 import 해 브라우저로
// 번들되므로 page.tsx 를 뺀 전부를 브라우저 코드로 본다. page.tsx 는 서버 진입 파일(env 플래그를 요청 시점에
// 읽는 Server Component)이라 zone 밖에 둔다. layout 류 진입 파일이 생기면 같은 이유로 뺀다.
const DEMO_DIR = "src/app/[locale]/ui-kit-demo";
const DEMO_SERVER_ENTRY =
  /(?:^|\/)(?:page|layout|template|default|loading|not-found|route)\.tsx?$/;
const demoBrowserFiles = readdirSync(
  new URL(`./${DEMO_DIR}`, import.meta.url),
  { recursive: true },
)
  .map(file => String(file).replaceAll("\\", "/"))
  .filter(file => /\.tsx?$/.test(file) && !DEMO_SERVER_ENTRY.test(file))
  .map(file => `./${DEMO_DIR}/${file}`.replace(/[[\]]/g, char => `[${char}]`));

// 브라우저로 번들되는 코드(컴포넌트·브라우저 lib·층 밖 클라이언트 유틸·app/** 의 client 파일·i18n)와
// 서버 전용 모듈.
const BROWSER_CODE = [
  "./src/components",
  "./src/lib/review-api",
  "./src/lib/review-model",
  "./src/lib/review-policy",
  "./src/lib/revision-history",
  "./src/lib/abort.ts",
  "./src/lib/browser-storage.ts",
  "./src/lib/format.ts",
  "./src/lib/leave-confirm.ts",
  "./src/lib/links.ts",
  "./src/lib/recent-jobs.ts",
  "./src/lib/relative-time.ts",
  "./src/lib/resource-id.ts",
  "./src/lib/use-resource.ts",
  "./src/lib/utils.ts",
  "./src/i18n",
  ...new Set([...appClientFiles, ...demoBrowserFiles]),
];
const SERVER_ONLY = [
  "./src/lib/upstage",
  "./src/lib/prisma.ts",
  "./src/lib/review-status.ts",
  "./src/lib/review-status-aggregate.ts",
  "./src/app/api",
];

// showcaseExcept: 2 층 파일이 import 해도 되는 showcase 모듈(components/showcase 기준). except 는
// from 하나에 대해서만 풀리므로 showcase 폴더와 3 층 lib 를 zone 을 나눠 둔다.
// 새 zone 은 이 함수 안에만 더한다 — 아래 층 블록과 뒤 블록 3 개(검수 화면 facade, 목록·상세 예외)가
// 이 함수를 다시 펼쳐 쓰므로, 블록 하나에만 더하면 그 블록 대상 파일에서는 다른 zone 이 사라진다.
function layerZones(showcaseExcept = []) {
  const toShowcase =
    "3 층(showcase: 홈·lineage·현황 집계·검수 큐·설정 메뉴·헤더 포털)은 데모 부가 기능이라";
  return [
    {
      target: LAYER1,
      from: [SHOWCASE_DIR, ...SHOWCASE_LIBS],
      message: `1 층(검수 화면·모델·검수 API·정책)은 3 층을 import 하지 않습니다. ${toShowcase} 검수 화면은 그것 없이 동작해야 합니다. 필요한 값은 composition root(app/**)에서 props·hook 으로 넘기세요.`,
    },
    {
      target: LAYER2,
      from: SHOWCASE_DIR,
      except: showcaseExcept,
      message: `2 층(Collection 목록·상세)은 3 층을 import 하지 않습니다. ${toShowcase} 목록·상세는 그것 없이 동작해야 합니다. 조립은 composition root(app/**)에서 하세요.`,
    },
    {
      target: LAYER2,
      from: SHOWCASE_LIBS,
      message: `2 층(Collection 목록·상세·검수 상태 저장)은 3 층 lib 를 import 하지 않습니다. ${toShowcase} 2 층은 그것 없이 동작해야 합니다.`,
    },
    {
      target: "./src/components/job-review",
      from: "./src/components/collections",
      except: LAYER1_ALLOWED_COLLECTIONS,
      message:
        "검수 화면(1 층)은 Collection 모듈 중 링크·검수 상태 배지·목록 상태·커서 페이지만 import 합니다. 그 밖에 필요한 것은 1 층이나 층 밖 lib 로 옮기세요.",
    },
    {
      target: [
        "./src/components/collections",
        "./src/components/leave-guard-store.ts",
        "./src/components/leave-guard-link.tsx",
      ],
      from: "./src/components/job-review",
      message:
        "2 층(Collection 목록·상세·이탈 확인 store)은 검수 화면(1 층) 모듈을 import 하지 않습니다. 함께 쓰는 코드는 층 밖 lib 로 옮기세요.",
    },
    {
      target: BROWSER_CODE,
      from: SERVER_ONLY,
      message:
        "브라우저 코드는 서버 전용 모듈(lib/upstage·prisma·review-status·app/api)을 import 하지 않습니다. API 키와 DB 접근은 서버에만 있어야 합니다. 같은 origin BFF(@/lib/review-api)를 거치세요.",
    },
  ];
}

// host 코드의 import 제한(아래 host 블록). flat config 는 같은 규칙 키의 옵션을 합치지 않고 통째로
// 바꾸므로, 같은 파일에 이 규칙을 다시 거는 블록(모델 순수성)은 이 값을 펼쳐 쓴다.
const HOST_RESTRICTED_PATHS = [
  {
    name: "next/link",
    message: "링크는 @/i18n/navigation 의 Link 를 쓰세요.",
  },
  {
    name: "next/navigation",
    allowImportNames: ["useSearchParams", "notFound"],
    message:
      "이동은 @/i18n/navigation 을 쓰세요. 읽기 전용 useSearchParams·notFound 만 허용합니다.",
  },
];

// 모델(lib/review-model) 운영 코드는 순수 TypeScript — 어떤 런타임·BFF 로도 옮길 수 있게 한다.
const MODEL_PURITY_MESSAGE =
  "검수 모델(lib/review-model)은 순수 TypeScript 입니다. 모델 안 상대 경로만 import 하고, 화면·요청·환경 값은 host 가 인자로 넘기세요.";
const MODEL_RESTRICTED_GLOBALS = [
  "window",
  "document",
  "fetch",
  "localStorage",
  "sessionStorage",
  "navigator",
  "process",
].map(name => ({ name, message: MODEL_PURITY_MESSAGE }));

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build output directories
    "**/dist/**",
    "**/node_modules/**",
    // shadcn CLI 가 관리하는 파일 — 바이트 그대로 보존해 재설치·업데이트 시 변경 없음으로 인식되게 한다
    "src/components/ui/**",
    "src/components/studio-ui-kit/**",
  ]),
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        {
          allowConstantExport: true,
          // Next 가 페이지·레이아웃 파일에서 읽는 export.
          allowExportNames: [
            "generateStaticParams",
            "generateMetadata",
            "metadata",
          ],
        },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      // 브라우저 베이스라인 가드 — Next 16 의 기본 빌드 타깃은
      // chrome 111 / edge 111 / firefox 111 / safari 16.4 이고, SWC 는 "문법"만
      // 낮춰준다. 이 타깃보다 나중에 들어온 "내장 메서드"는 폴리필 없이 그대로
      // 나가서 해당 브라우저에서 `x.foo is not a function` 으로 죽는다.
      // 여기 목록은 전부 firefox 111 에 없는 것들이다.
      "no-restricted-properties": [
        "error",
        {
          property: "toSorted",
          message:
            "toSorted 는 Firefox 115+ 필요 (빌드 타깃은 firefox 111). `[...arr].sort(...)` 를 쓰세요.",
        },
        {
          property: "toReversed",
          message:
            "toReversed 는 Firefox 115+ 필요. `[...arr].reverse()` 를 쓰세요.",
        },
        {
          property: "toSpliced",
          message:
            "toSpliced 는 Firefox 115+ 필요. 복사본을 만든 뒤 splice 하세요.",
        },
        {
          object: "Object",
          property: "groupBy",
          message: "Object.groupBy 는 Firefox 119+ 필요. reduce 로 모으세요.",
        },
        {
          object: "Map",
          property: "groupBy",
          message: "Map.groupBy 는 Firefox 119+ 필요. reduce 로 모으세요.",
        },
        {
          object: "Promise",
          property: "withResolvers",
          message:
            "Promise.withResolvers 는 Firefox 121+ 필요. new Promise 로 resolve/reject 를 꺼내 쓰세요.",
        },
        {
          object: "Array",
          property: "fromAsync",
          message:
            "Array.fromAsync 는 Safari 18.4+ 필요. for await 루프로 모으세요.",
        },
        {
          object: "URL",
          property: "canParse",
          message:
            "URL.canParse 는 Firefox 115+ 필요. try/catch + new URL 로 판정하세요.",
        },
      ],
    },
  },
  // host 코드 — 링크·이동은 locale 을 붙이는 @/i18n/navigation 을 쓰고, 대체가 없는 읽기 전용
  // useSearchParams·notFound 만 허용한다.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { paths: HOST_RESTRICTED_PATHS }],
    },
  },
  // 모델 순수성 — 운영 코드는 React·Next·앱 모듈(@/*)과 브라우저·Node 전역을 쓰지 않는다. host 블록의
  // 같은 규칙을 덮어쓰므로 host 옵션을 펼쳐 넣는다. 테스트(__tests__)는 vitest·node:fs 를 쓰므로 뺀다.
  {
    files: ["src/lib/review-model/**/*.ts"],
    ignores: ["**/__tests__/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            ...HOST_RESTRICTED_PATHS,
            ...["react", "react-dom", "next"].map(name => ({
              name,
              message: MODEL_PURITY_MESSAGE,
            })),
          ],
          patterns: [
            {
              group: ["@/*", "react/*", "react-dom/*", "next/*"],
              message: MODEL_PURITY_MESSAGE,
            },
          ],
        },
      ],
      "no-restricted-globals": ["error", ...MODEL_RESTRICTED_GLOBALS],
    },
  },
  // 앱 층 방향 — 1 층(검수 화면·모델·검수 API·정책) ← 2 층(Collection 목록·상세, 이탈 확인 store,
  // 검수 상태 저장) ← 3 층(showcase: 홈·lineage·현황 집계·검수 큐·설정 메뉴·헤더 포털). 화살표 반대
  // 방향(아래 층이 위 층을 import)만 허용한다. 3 층과 composition root(app/**, app-header)는 제한 없음.
  // 브라우저 코드가 서버 전용 모듈을 import 하는 것도 여기서 막는다. 새 zone 은 layerZones() 안에만
  // 더한다 — 뒤 블록 3 개가 이 함수를 다시 펼쳐 쓴다.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "import/no-restricted-paths": ["error", { zones: layerZones() }],
    },
  },
  // 검수 화면의 BFF 연산은 facade(`lib/review-api/review-screen.ts`)로만 부른다 — 다른 BFF 로 바꿀 때 고칠
  // 곳이 한 모듈로 보이게. 앱 연산(검수 상태 저장)을 쓰는 use-review-status.ts 와 테스트는 client 를 직접 쓴다.
  {
    files: ["src/components/job-review/**/*.{ts,tsx}"],
    ignores: [
      "src/components/job-review/use-review-status.ts",
      "src/components/job-review/**/__tests__/**",
    ],
    rules: {
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            ...layerZones(),
            {
              target: "./src/components/job-review",
              from: "./src/lib/review-api/client.ts",
              message:
                "검수 화면은 BFF 연산을 @/lib/review-api/review-screen(facade)에서 import 합니다. 검수 상태 저장(setReviewStatus)만 use-review-status.ts 가 client 를 직접 씁니다.",
            },
          ],
        },
      ],
    },
  },
  // 2 → 3 허용 목록 — 목록·상세 화면이 데모 부가 기능(lineage 보기·현황 카드·검수 큐 시작)을 조립한다.
  // 목록·상세에 주입점을 만들지 않고 이 두 파일의 지금 import 만 허용한다. 새 3 층 import 는 막는다.
  {
    files: ["src/components/collections/collections-list-view.tsx"],
    rules: {
      "import/no-restricted-paths": [
        "error",
        {
          zones: layerZones([
            "./lineage/collection-lineage-view.tsx",
            "./review-overview/review-overview.tsx",
            "./review-overview/review-overview-model.ts",
            "./review-overview/use-review-overview.ts",
          ]),
        },
      ],
    },
  },
  {
    files: ["src/components/collections/collection-detail-view.tsx"],
    rules: {
      "import/no-restricted-paths": [
        "error",
        {
          zones: layerZones([
            "./review-overview/review-progress.tsx",
            "./review-queue/review-queue.ts",
            "./review-queue/review-queue-storage.ts",
          ]),
        },
      ],
    },
  },
  prettier, // Prettier는 마지막에 추가하여 다른 포매팅 규칙을 덮어씁니다
]);

export default eslintConfig;
