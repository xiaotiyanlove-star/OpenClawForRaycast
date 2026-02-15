import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["src/__tests__/**/*.test.ts"],
        globals: true,
        // 模拟 Raycast API 和 ws（它们在纯 Node 测试中无法解析）
        alias: {
            "@raycast/api": new URL(
                "./src/__tests__/__mocks__/raycast-api.ts",
                import.meta.url,
            ).pathname,
        },
    },
});
