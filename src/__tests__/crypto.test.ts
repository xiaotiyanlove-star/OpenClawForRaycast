/**
 * buildDeviceAuthPayload 签名格式单元测试
 */
import { describe, it, expect } from "vitest";
import { buildDeviceAuthPayload } from "../crypto";

describe("buildDeviceAuthPayload", () => {
    const baseParams = {
        deviceId: "abc123def456",
        clientId: "openclaw-control-ui",
        clientMode: "webchat",
        role: "operator",
        scopes: ["operator.admin", "operator.approvals"],
        signedAtMs: 1700000000000,
        token: "my-token",
        nonce: "nonce-xyz",
    };

    it("应生成正确的 v2 格式 payload", () => {
        const result = buildDeviceAuthPayload(baseParams);
        expect(result).toBe(
            "v2|abc123def456|openclaw-control-ui|webchat|operator|operator.admin,operator.approvals|1700000000000|my-token|nonce-xyz",
        );
    });

    it("应以 v2 开头", () => {
        const result = buildDeviceAuthPayload(baseParams);
        expect(result.startsWith("v2|")).toBe(true);
    });

    it("应用 | 分隔各字段", () => {
        const result = buildDeviceAuthPayload(baseParams);
        const parts = result.split("|");
        expect(parts.length).toBe(9);
        expect(parts[0]).toBe("v2");
        expect(parts[1]).toBe("abc123def456");
        expect(parts[2]).toBe("openclaw-control-ui");
        expect(parts[3]).toBe("webchat");
        expect(parts[4]).toBe("operator");
        expect(parts[5]).toBe("operator.admin,operator.approvals");
        expect(parts[6]).toBe("1700000000000");
        expect(parts[7]).toBe("my-token");
        expect(parts[8]).toBe("nonce-xyz");
    });

    it("token 为 null 时应替换为空字符串", () => {
        const result = buildDeviceAuthPayload({
            ...baseParams,
            token: null,
        });
        const parts = result.split("|");
        expect(parts[7]).toBe("");
    });

    it("token 为 undefined 时应替换为空字符串", () => {
        const result = buildDeviceAuthPayload({
            ...baseParams,
            token: undefined,
        });
        const parts = result.split("|");
        expect(parts[7]).toBe("");
    });

    it("nonce 为 null 时应替换为空字符串", () => {
        const result = buildDeviceAuthPayload({
            ...baseParams,
            nonce: null,
        });
        const parts = result.split("|");
        expect(parts[8]).toBe("");
    });

    it("scopes 为空数组时应生成空的 scopes 段", () => {
        const result = buildDeviceAuthPayload({
            ...baseParams,
            scopes: [],
        });
        const parts = result.split("|");
        expect(parts[5]).toBe("");
    });

    it("单个 scope 时不应有逗号分隔", () => {
        const result = buildDeviceAuthPayload({
            ...baseParams,
            scopes: ["single.scope"],
        });
        const parts = result.split("|");
        expect(parts[5]).toBe("single.scope");
    });

    it("signedAtMs 应转为字符串", () => {
        const result = buildDeviceAuthPayload(baseParams);
        const parts = result.split("|");
        expect(parts[6]).toBe("1700000000000");
    });
});
