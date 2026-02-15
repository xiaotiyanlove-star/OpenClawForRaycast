/**
 * OpenClaw Gateway WebSocket 客户端
 * 支持设备身份认证、connect.challenge 握手、RPC 请求、事件监听、自动重连
 */

import WebSocket from "ws";
import {
  getOrCreateDeviceIdentity,
  buildDeviceAuthPayload,
  signDevicePayload,
  saveDeviceToken,
} from "./crypto";
import os from "os";
import type {
  ConnectParams,
  ConnectChallenge,
  DeviceAuth,
  HelloOkPayload,
  RequestFrame,
  ResponseFrame,
  EventFrame,
  GatewayFrame,
} from "./types";
import type { ErrorShape } from "./types";
import { GatewayError } from "./errors";
import {
  MIN_PROTOCOL_VERSION,
  MAX_PROTOCOL_VERSION,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_MAX_RECONNECTS,
  DEFAULT_TICK_INTERVAL_MS,
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_MAX_DELAY_MS,
  CLIENT_ID,
  CLIENT_MODE,
  CLIENT_VERSION,
  USER_AGENT_PREFIX,
  DEFAULT_SCOPES,
} from "./config";

// ===== 调试日志 =====
const DEBUG = process.env.NODE_ENV !== "production";
function debugLog(tag: string, ...args: unknown[]) {
  if (DEBUG) console.log(`[GatewayClient:${tag}]`, ...args);
}

/** 连接状态 */
export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";

/** 事件处理器 */
type EventHandler = (payload: unknown) => void;

/** 挂起的请求 */
interface PendingRequest {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** 客户端配置 */
export interface GatewayClientOptions {
  url: string;
  token: string;
  /** 可选密码（web dashboard 场景） */
  password?: string;
  /** 请求超时（毫秒） */
  requestTimeoutMs?: number;
  /** 最大重连次数 */
  maxReconnects?: number;
  /** 连接回调 */
  onStateChange?: (state: ConnectionState) => void;
  /** 连接错误回调 */
  onError?: (error: Error) => void;
}

let _idCounter = 0;
function nextId(): string {
  return `raycast-${Date.now()}-${++_idCounter}-${Math.random().toString(36).slice(2, 6)}`;
}

export class GatewayClient {
  private ws: WebSocket | null = null;
  private opts: Required<GatewayClientOptions>;
  private state: ConnectionState = "disconnected";
  private pendingRequests = new Map<string, PendingRequest>();
  private eventHandlers = new Map<string, Set<EventHandler>>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private tickIntervalMs = DEFAULT_TICK_INTERVAL_MS;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private helloPayload: HelloOkPayload | null = null;
  private intentionalClose = false;
  /** 从 hello-ok 动态协商得到的实际协议版本 */
  private _negotiatedProtocol: number = MIN_PROTOCOL_VERSION;

  constructor(opts: GatewayClientOptions) {
    this.opts = {
      password: "",
      requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
      maxReconnects: DEFAULT_MAX_RECONNECTS,
      onStateChange: () => { },
      onError: () => { },
      ...opts,
    };
  }

  /** 当前连接状态 */
  get connectionState(): ConnectionState {
    return this.state;
  }

  /** hello-ok 返回的信息 */
  get hello(): HelloOkPayload | null {
    return this.helloPayload;
  }

  /** 是否已连接 */
  get isConnected(): boolean {
    return this.state === "connected";
  }

  /** 实际协商的协议版本（从 hello-ok 获取） */
  get negotiatedProtocol(): number {
    return this._negotiatedProtocol;
  }

  /** 连接到 Gateway */
  async connect(): Promise<HelloOkPayload> {
    if (this.state === "connected" && this.helloPayload) {
      return this.helloPayload;
    }

    this.intentionalClose = false;
    return this.doConnect();
  }

  /** 断开连接 */
  disconnect(): void {
    debugLog("disconnect", "主动断开连接");
    this.intentionalClose = true;
    this.clearReconnectTimer();
    this.clearTickTimer();
    this.clearPendingRequests(new Error("客户端主动断开连接"));
    // 清理事件监听器，防止 handler 累积泄漏
    this.eventHandlers.clear();
    if (this.ws) {
      this.ws.close(1000, "client disconnect");
      this.ws = null;
    }
    this.setState("disconnected");
  }

  /** 发送 RPC 请求 */
  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.ws || this.state !== "connected") {
      throw new Error(`Gateway 未连接 (state: ${this.state})`);
    }

    const id = nextId();
    const frame: RequestFrame = { type: "req", id, method };
    if (params !== undefined) {
      frame.params = params;
    }

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(
          new Error(`请求超时: ${method} (${this.opts.requestTimeoutMs}ms)`),
        );
      }, this.opts.requestTimeoutMs);

      this.pendingRequests.set(id, {
        resolve: resolve as (payload: unknown) => void,
        reject,
        timer,
      });

      this.ws!.send(JSON.stringify(frame));
    });
  }

  /** 监听事件 */
  on(event: string, handler: EventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  /** 取消监听 */
  off(event: string, handler: EventHandler): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.eventHandlers.delete(event);
      }
    }
  }

  // ===== 内部实现 =====

  private async doConnect(): Promise<HelloOkPayload> {
    this.setState("connecting");

    // 将 URL 统一为 ws:// 或 wss://
    let wsUrl = this.opts.url;
    if (wsUrl.startsWith("https://")) {
      wsUrl = wsUrl.replace("https://", "wss://");
    } else if (wsUrl.startsWith("http://")) {
      wsUrl = wsUrl.replace("http://", "ws://");
    }
    if (!wsUrl.startsWith("ws://") && !wsUrl.startsWith("wss://")) {
      wsUrl = `wss://${wsUrl}`;
    }

    // 提前获取设备身份
    const identity = await getOrCreateDeviceIdentity();

    // 计算 Origin (通常为 https://host) 以通过 Gateway 的 Origin 检查
    let origin: string | undefined;
    try {
      const u = new URL(wsUrl);
      origin = `${u.protocol.replace("ws", "http")}//${u.host}`;
    } catch {
      // 忽略 URL 解析错误
    }

    const ws = new WebSocket(wsUrl, {
      origin,
      headers: {
        ...(this.opts.token
          ? { Authorization: `Bearer ${this.opts.token}` }
          : {}),
        "User-Agent": `${USER_AGENT_PREFIX}/${CLIENT_VERSION} (${os.platform() === "darwin" ? "macos" : os.platform()}; ${os.arch()}; ${os.release()})`,
      },
    });
    this.ws = ws;

    let handshakeDone = false;
    let connectReqId: string | null = null;

    return new Promise<HelloOkPayload>((resolve, reject) => {
      ws.on("open", () => {
        // 协议规定：不在此处发送 connect
        // 等待服务器下发 connect.challenge 事件
      });

      ws.on("message", async (data) => {
        let frame: GatewayFrame;
        try {
          frame = JSON.parse(data.toString()) as GatewayFrame;
        } catch (parseErr) {
          debugLog("parse", "JSON 解析失败:", (parseErr as Error).message, data.toString().slice(0, 100));
          return;
        }

        // ===== 处理 connect.challenge 事件 =====
        if (
          frame.type === "event" &&
          (frame as EventFrame).event === "connect.challenge"
        ) {
          const challenge = (frame as EventFrame).payload as ConnectChallenge;
          const nonce = challenge.nonce;
          debugLog("challenge", "收到 connect.challenge, nonce:", nonce?.slice(0, 8) + "...");

          try {
            const connectParams = this.buildConnectParams(
              identity,
              nonce,
            );

            connectReqId = nextId();
            const connectFrame: RequestFrame = {
              type: "req",
              id: connectReqId,
              method: "connect",
              params: connectParams,
            };

            ws.send(JSON.stringify(connectFrame));
          } catch (err) {
            debugLog("challenge", "签名失败:", err);
            if (!handshakeDone) {
              handshakeDone = true;
              reject(
                new GatewayError({
                  message: `签名 challenge 失败: ${err instanceof Error ? err.message : String(err)}`,
                  code: "SIGN_FAILED",
                  cause: err,
                }),
              );
              ws.close();
            }
          }
          return;
        }

        // ===== 处理响应帧 =====
        if (frame.type === "res") {
          const res = frame as ResponseFrame;

          // 握手响应（匹配 connect 请求 ID）
          if (!handshakeDone && connectReqId && res.id === connectReqId) {
            const result = this.processHandshakeResponse(res);
            if (result.ok) {
              handshakeDone = true;
              resolve(result.payload!);
            } else {
              handshakeDone = true;
              reject(result.error!);
              ws.close();
            }
            return;
          }

          // 普通 RPC 响应
          const pending = this.pendingRequests.get(res.id);
          if (pending) {
            this.pendingRequests.delete(res.id);
            clearTimeout(pending.timer);
            if (res.ok) {
              // 检查 tick 响应中的 retryAfterMs 限流
              const resPayload = res.payload as
                | Record<string, unknown>
                | undefined;
              if (
                resPayload?.retryAfterMs &&
                typeof resPayload.retryAfterMs === "number"
              ) {
                this.tickIntervalMs = Math.max(
                  this.tickIntervalMs,
                  resPayload.retryAfterMs as number,
                );
                this.startTickTimer(); // 用新间隔重启
              }
              pending.resolve(res.payload);
            } else {
              pending.reject(new Error(res.error?.message ?? "请求失败"));
            }
          }
        }

        // ===== 处理事件帧 =====
        if (frame.type === "event") {
          const evt = frame as EventFrame;
          this.emitEvent(evt.event, evt.payload);
        }
      });

      ws.on("error", (err) => {
        debugLog("ws-error", err.message);
        const wrapped = new GatewayError({
          message: `WebSocket 错误: ${err.message}`,
          code: "WS_ERROR",
          retryable: true,
          cause: err,
        });
        this.opts.onError(wrapped);
        if (!handshakeDone) {
          handshakeDone = true;
          reject(wrapped);
        }
      });

      ws.on("close", (_code, _reason) => {
        this.clearTickTimer();
        this.clearPendingRequests(new Error("连接已关闭"));
        this.ws = null;

        if (!handshakeDone) {
          handshakeDone = true;
          reject(new Error("连接意外关闭"));
          return;
        }

        if (!this.intentionalClose) {
          this.setState("reconnecting");
          this.scheduleReconnect();
        } else {
          this.setState("disconnected");
        }
      });
    });
  }

  // ===== 辅助方法（从 doConnect 拆分） =====

  /**
   * 构建 connect 请求参数
   * 从 doConnect 拆出，便于阅读和单独测试
   */
  private buildConnectParams(
    identity: { deviceId: string; publicKey: string; privateKeyPem: string },
    nonce: string,
  ): ConnectParams {
    const signedAt = Date.now();
    const clientId = CLIENT_ID;
    const clientMode = CLIENT_MODE;
    const role = "operator";
    const scopes = DEFAULT_SCOPES;

    const payload = buildDeviceAuthPayload({
      deviceId: identity.deviceId,
      clientId,
      clientMode,
      role,
      scopes,
      signedAtMs: signedAt,
      token: this.opts.token ?? null,
      nonce,
    });
    const signature = signDevicePayload(identity.privateKeyPem, payload);

    const deviceAuth: DeviceAuth = {
      id: identity.deviceId,
      publicKey: identity.publicKey,
      signature,
      signedAt,
      nonce,
    };

    const hostname = os.hostname().replace(/\.local$/, "");
    const platform = os.platform() === "darwin" ? "macos" : os.platform();
    const arch = os.arch();
    const release = os.release();

    return {
      minProtocol: MIN_PROTOCOL_VERSION,
      maxProtocol: MAX_PROTOCOL_VERSION,
      client: {
        id: clientId,
        displayName: `Raycast (${hostname})`,
        version: CLIENT_VERSION,
        platform,
        mode: clientMode,
      },
      role,
      scopes,
      auth: {
        token: this.opts.token,
        ...(this.opts.password ? { password: this.opts.password } : {}),
      },
      device: deviceAuth,
      locale: "zh-CN",
      userAgent: `${USER_AGENT_PREFIX}/${CLIENT_VERSION} (${platform}; ${arch}; ${release})`,
    };
  }

  /**
   * 处理握手响应
   * 返回 { ok, payload, error } 结构，由 doConnect 统一控制流
   */
  private processHandshakeResponse(res: ResponseFrame): {
    ok: boolean;
    payload?: HelloOkPayload;
    error?: GatewayError;
  } {
    if (res.ok) {
      const payload = res.payload as HelloOkPayload;
      if (payload?.type === "hello-ok") {
        this.helloPayload = payload;
        this._negotiatedProtocol = payload.protocol ?? MIN_PROTOCOL_VERSION;
        this.tickIntervalMs =
          payload.policy?.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS;
        if (payload.policy?.retryAfterMs) {
          this.tickIntervalMs = Math.max(
            this.tickIntervalMs,
            payload.policy.retryAfterMs,
          );
        }
        this.reconnectAttempt = 0;
        this.setState("connected");
        this.startTickTimer();

        if (payload.auth?.deviceToken) {
          saveDeviceToken(
            payload.auth.role,
            payload.auth.deviceToken,
            payload.auth.scopes,
          ).catch(() => { /* 静默 */ });
        }

        debugLog("handshake", "握手成功, protocol:", payload.protocol, "connId:", payload.server?.connId);
        return { ok: true, payload };
      }
    }

    // 握手失败
    const errDetail = res.error as ErrorShape | undefined;
    const gwErr = this.classifyError(errDetail);
    debugLog("handshake", "握手失败:", gwErr.message, gwErr.code);
    return { ok: false, error: gwErr };
  }

  // ===== 内部状态管理 =====

  private setState(state: ConnectionState) {
    if (this.state !== state) {
      debugLog("state", `${this.state} → ${state}`);
      this.state = state;
      this.opts.onStateChange(state);
    }
  }

  private emitEvent(event: string, payload: unknown) {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(payload);
        } catch {
          // 忽略处理器错误
        }
      }
    }

    // 通配符监听
    const allHandlers = this.eventHandlers.get("*");
    if (allHandlers) {
      for (const handler of allHandlers) {
        try {
          handler({ event, payload });
        } catch {
          // 忽略处理器错误
        }
      }
    }
  }

  private startTickTimer() {
    this.clearTickTimer();
    this.tickTimer = setInterval(() => {
      if (this.ws && this.state === "connected") {
        const tickFrame: RequestFrame = {
          type: "req",
          id: nextId(),
          method: "tick",
          params: { ts: Date.now() },
        };
        try {
          this.ws.send(JSON.stringify(tickFrame));
        } catch {
          // 忽略发送错误
        }
      }
    }, this.tickIntervalMs);
  }

  private clearTickTimer() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearPendingRequests(error: Error) {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private scheduleReconnect() {
    if (this.reconnectAttempt >= this.opts.maxReconnects) {
      this.setState("disconnected");
      this.opts.onError(
        new GatewayError({
          message: `已达最大重连次数 (${this.opts.maxReconnects})，请检查网络后手动重试`,
          code: "MAX_RECONNECTS",
          retryable: false,
        }),
      );
      return;
    }

    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempt),
      RECONNECT_MAX_DELAY_MS,
    );
    this.reconnectAttempt++;
    debugLog("reconnect", `第 ${this.reconnectAttempt} 次重连, 延迟 ${delay}ms`);

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.doConnect();
      } catch {
        // doConnect 失败会触发 ws.on("close")，自动继续重连
      }
    }, delay);
  }

  /**
   * 根据错误结构分类，返回结构化 GatewayError
   */
  private classifyError(err: ErrorShape | undefined): GatewayError {
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
        retryAfterMs: (err as unknown as Record<string, unknown>).retryAfterMs as number | undefined,
      });
    }

    return new GatewayError({ message: `连接失败: ${msg}`, code: err.code ?? "UNKNOWN" });
  }
}
