/**
 * Gateway 结构化错误
 * 包含错误码、是否可重试、限流等信息，便于 UI 层精确分类
 */
export class GatewayError extends Error {
    /** 错误码（来自服务端或客户端自定义） */
    readonly code: string;
    /** 是否可自动重试 */
    readonly retryable: boolean;
    /** 服务端建议的重试延迟（毫秒） */
    readonly retryAfterMs?: number;

    constructor(opts: {
        message: string;
        code?: string;
        retryable?: boolean;
        retryAfterMs?: number;
        cause?: unknown;
    }) {
        super(opts.message, { cause: opts.cause });
        this.name = "GatewayError";
        this.code = opts.code ?? "UNKNOWN";
        this.retryable = opts.retryable ?? false;
        this.retryAfterMs = opts.retryAfterMs;
    }
}
