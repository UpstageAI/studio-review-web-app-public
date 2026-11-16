import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": src("./src"),
      // `server-only` 는 React Server 환경 밖에서 import 되면 throw 하므로 빈 모듈로 치환한다.
      "server-only": src("./src/test/stubs/server-only.ts"),
    },
  },
  test: {
    // describe·it·expect 를 전역으로 둔다. Studio UI Kit item 테스트(src/test/studio-ui-kit)가 러너를
    // import 하지 않고 이 전역을 쓴다(host 테스트의 명시적 `vitest` import 는 그대로 동작한다).
    globals: true,
    // `*.test.ts` 는 지금처럼 node 에서, 컴포넌트를 그리는 `*.test.tsx` 만 jsdom 에서 돈다.
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./src/test/setup-dom.ts"],
        },
      },
    ],
  },
});
