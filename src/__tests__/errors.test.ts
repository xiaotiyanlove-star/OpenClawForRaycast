/**
 * GatewayError 单元测试
 */
import { describe, it, expect } from "vitest";
import { GatewayError } from "../errors";

describe("GatewayError", () => {
    it("应正确设置默认值", () => {
        const err = new GatewayError({ message: "测试错误" });
        expect(err.message).toBe("测试错误");
        expect(err.name).toBe("GatewayError");
        expect(err.code).toBe("UNKNOWN");
        expect(err.retryable).toBe(false);
        expect(err.retryAfterMs).toBeUndefined();
    });

    it("应正确设置所有字段", () => {
        const cause = new Error("原始错误");
        const err = new GatewayError({
            message: "认证失败",
            code: "AUTH_FAILED",
            retryable: true,
            retryAfterMs: 5000,
            cause,
        });
        expect(err.code).toBe("AUTH_FAILED");
        expect(err.retryable).toBe(true);
        expect(err.retryAfterMs).toBe(5000);
        expect(err.cause).toBe(cause);
    });

    it("应继承自 Error", () => {
        const err = new GatewayError({ message: "test" });
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(GatewayError);
    });

    it("应能被 try/catch 捕获并按 instanceof 判断", () => {
        try {
            throw new GatewayError({ message: "test", code: "WS_ERROR" });
        } catch (e) {
            expect(e).toBeInstanceOf(GatewayError);
            if (e instanceof GatewayError) {
                expect(e.code).toBe("WS_ERROR");
            }
        }
    });
});
