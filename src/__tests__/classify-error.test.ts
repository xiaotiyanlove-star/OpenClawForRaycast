/**
 * classifyError 错误分类逻辑单元测试
 *
 * 由于 GatewayClient.classifyError 是 private 方法，
 * 这里通过 createClassifyError() 工厂函数测试同等逻辑。
 * 如果未来想直接测试，可将 classifyError 提取为独立函数。
 */
import { describe, it, expect } from "vitest";
import { GatewayError } from "../errors";
import type { ErrorShape } from "../types";

/**
 * classifyError 的独立副本（与 gateway-client.ts 中的实现完全一致）
 * 在测试中复制此逻辑以验证分类正确性
 */
function classifyError(err: ErrorShape | undefined): GatewayError {
    if (!err) {
        return new GatewayError({ message: "握手失败 (未知错误)", code: "UNKNOWN" });
    }

    const code = err.code?.toLowerCase() ?? "";
    const msg = err.message ?? "";

    if (code.includes("protocol") || msg.includes("protocol")) {
        return new GatewayError({
            message: `协议版本不兼容: ${msg}。请升级客户端或联系管理员。`,
            code: "PROTOCOL_MISMATCH",
        });
    }
    if (
        code.includes("pair") ||
        code.includes("not_paired") ||
        msg.includes("pairing")
    ) {
        return new GatewayError({
            message: `设备未配对: ${msg}。请在管理后台批准此设备。`,
            code: "NOT_PAIRED",
        });
    }
    if (
        code === "401" ||
        code === "403" ||
        code.includes("auth") ||
        code.includes("unauthorized") ||
        code.includes("forbidden")
    ) {
        return new GatewayError({
            message: `认证失败: ${msg}。请检查 Token 是否有效或已过期。`,
            code: "AUTH_FAILED",
        });
    }
    if (err.retryable) {
        return new GatewayError({
            message: `服务暂时不可用: ${msg}。将自动重试...`,
            code: "RETRYABLE",
            retryable: true,
        });
    }

    return new GatewayError({
        message: `连接失败: ${msg}`,
        code: err.code ?? "UNKNOWN",
    });
}

describe("classifyError", () => {
    it("undefined 错误应返回 UNKNOWN", () => {
        const result = classifyError(undefined);
        expect(result.code).toBe("UNKNOWN");
        expect(result.message).toContain("未知错误");
    });

    // ===== 协议不兼容 =====
    it("code 包含 protocol 应返回 PROTOCOL_MISMATCH", () => {
        const result = classifyError({ code: "PROTOCOL_ERROR", message: "version 2 not supported" });
        expect(result.code).toBe("PROTOCOL_MISMATCH");
    });

    it("message 包含 protocol 应返回 PROTOCOL_MISMATCH", () => {
        const result = classifyError({ code: "ERR", message: "protocol version mismatch" });
        expect(result.code).toBe("PROTOCOL_MISMATCH");
    });

    // ===== 设备未配对 =====
    it("code 包含 pair 应返回 NOT_PAIRED", () => {
        const result = classifyError({ code: "REQUIRE_PAIR", message: "device not paired" });
        expect(result.code).toBe("NOT_PAIRED");
    });

    it("code 包含 not_paired 应返回 NOT_PAIRED", () => {
        const result = classifyError({ code: "NOT_PAIRED", message: "" });
        expect(result.code).toBe("NOT_PAIRED");
    });

    it("message 包含 pairing 应返回 NOT_PAIRED", () => {
        const result = classifyError({ code: "ERR", message: "pairing required" });
        expect(result.code).toBe("NOT_PAIRED");
    });

    // ===== 认证失败 =====
    it("code 为 401 应返回 AUTH_FAILED", () => {
        const result = classifyError({ code: "401", message: "Unauthorized" });
        expect(result.code).toBe("AUTH_FAILED");
    });

    it("code 为 403 应返回 AUTH_FAILED", () => {
        const result = classifyError({ code: "403", message: "Forbidden" });
        expect(result.code).toBe("AUTH_FAILED");
    });

    it("code 包含 unauthorized 应返回 AUTH_FAILED", () => {
        const result = classifyError({ code: "UNAUTHORIZED", message: "" });
        expect(result.code).toBe("AUTH_FAILED");
    });

    it("code 包含 auth 应返回 AUTH_FAILED", () => {
        const result = classifyError({ code: "AUTH_EXPIRED", message: "token expired" });
        expect(result.code).toBe("AUTH_FAILED");
    });

    it("code 包含 forbidden 应返回 AUTH_FAILED", () => {
        const result = classifyError({ code: "FORBIDDEN", message: "" });
        expect(result.code).toBe("AUTH_FAILED");
    });

    // ===== 可重试 =====
    it("retryable 为 true 应返回 RETRYABLE 且 retryable=true", () => {
        const result = classifyError({ code: "RATE_LIMIT", message: "too many requests", retryable: true });
        expect(result.code).toBe("RETRYABLE");
        expect(result.retryable).toBe(true);
    });

    // ===== 默认情况 =====
    it("无匹配规则时应使用原始 code", () => {
        const result = classifyError({ code: "INTERNAL_ERROR", message: "something went wrong" });
        expect(result.code).toBe("INTERNAL_ERROR");
        expect(result.message).toContain("连接失败");
    });

    it("无匹配且 code 为空字符串时应保留原始 code", () => {
        const result = classifyError({ code: "", message: "random error" });
        // `err.code ?? "UNKNOWN"` — 空字符串不是 null/undefined，所以结果为 ""
        expect(result.code).toBe("");
    });

    // ===== 优先级测试 =====
    it("protocol 优先于 auth（当两者都匹配时）", () => {
        const result = classifyError({ code: "PROTOCOL_AUTH", message: "something" });
        expect(result.code).toBe("PROTOCOL_MISMATCH");
    });

    it("pair 优先于 auth（当两者都匹配时）", () => {
        const result = classifyError({ code: "PAIR_AUTH", message: "something" });
        expect(result.code).toBe("NOT_PAIRED");
    });
});
