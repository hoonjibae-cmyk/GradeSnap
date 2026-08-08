import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * `@/`를 tsconfig와 같게 풀어줍니다.
 *
 * 없으면 **타입만 쓰는 파일은 통과하고 값을 쓰는 파일만 실패합니다** —
 * 타입 import는 컴파일에서 지워지기 때문입니다. 그 차이를 모르고 있으면
 * 테스트를 하나 더 쓸 때마다 상대 경로로 돌려놓게 됩니다.
 */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
});
