/**
 * isChatMessage 类型守卫单元测试
 */
import { describe, it, expect } from "vitest";
import { isChatMessage } from "../types";

describe("isChatMessage", () => {
    it("应接受有效的 ChatMessage（role + string content）", () => {
        expect(isChatMessage({ role: "user", content: "你好" })).toBe(true);
    });

    it("应接受有效的 ChatMessage（role + array content）", () => {
        expect(
            isChatMessage({
                role: "assistant",
                content: [{ type: "text", text: "回复" }],
            }),
        ).toBe(true);
    });

    it("应接受只有 role 没有 content 的消息", () => {
        expect(isChatMessage({ role: "system" })).toBe(true);
    });

    it("应接受 content 为 undefined 的消息", () => {
        expect(isChatMessage({ role: "user", content: undefined })).toBe(true);
    });

    it("应拒绝 null", () => {
        expect(isChatMessage(null)).toBe(false);
    });

    it("应拒绝 undefined", () => {
        expect(isChatMessage(undefined)).toBe(false);
    });

    it("应拒绝非对象类型", () => {
        expect(isChatMessage("string")).toBe(false);
        expect(isChatMessage(42)).toBe(false);
        expect(isChatMessage(true)).toBe(false);
    });

    it("应拒绝没有 role 字段的对象", () => {
        expect(isChatMessage({ content: "没有 role" })).toBe(false);
    });

    it("应拒绝 role 为非字符串的对象", () => {
        expect(isChatMessage({ role: 123 })).toBe(false);
        expect(isChatMessage({ role: null })).toBe(false);
    });

    it("应拒绝 content 为非字符串/非数组的对象", () => {
        expect(isChatMessage({ role: "user", content: 42 })).toBe(false);
        expect(isChatMessage({ role: "user", content: { nested: true } })).toBe(
            false,
        );
    });

    it("应接受带额外字段的消息（ChatMessage 允许 [key: string]: unknown）", () => {
        expect(
            isChatMessage({ role: "user", content: "hi", extraField: "value" }),
        ).toBe(true);
    });
});
