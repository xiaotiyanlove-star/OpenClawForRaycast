/**
 * OpenClaw Gateway WebSocket 协议类型定义
 * 基于 src/gateway/protocol/schema 的 TypeBox 定义简化
 */

// ===== Gateway 协议帧 =====

/** 请求帧 */
export interface RequestFrame {
  type: "req";
  id: string;
  method: string;
  params?: unknown;
}

/** 响应帧 */
export interface ResponseFrame {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: ErrorShape;
}

/** 事件帧 */
export interface EventFrame {
  type: "event";
  event: string;
  payload?: unknown;
  seq?: number;
  stateVersion?: number;
}

/** 错误结构 */
export interface ErrorShape {
  code: string;
  message: string;
  details?: unknown;
  retryable?: boolean;
  retryAfterMs?: number;
}

/** Gateway 帧联合类型 */
export type GatewayFrame = RequestFrame | ResponseFrame | EventFrame;

// ===== 设备身份 =====

/** connect 请求中的 device 字段 */
export interface DeviceAuth {
  id: string; // base64url (SHA-256 of publicKey)
  publicKey: string; // base64url (raw uncompressed SEC1)
  signature: string; // base64url (ECDSA P1363 签名)
  signedAt: number; // 签名时间戳
  nonce: string; // 来自 connect.challenge 的 nonce
}

/** connect.challenge 事件载荷 */
export interface ConnectChallenge {
  nonce: string;
}

// ===== 连接握手 =====

/** connect 请求参数 */
export interface ConnectParams {
  minProtocol: number;
  maxProtocol: number;
  client: {
    id: string;
    displayName?: string;
    version: string;
    platform: string;
    mode: string;
  };
  role?: string;
  scopes?: string[];
  auth?: {
    token?: string;
    password?: string;
    deviceToken?: string;
  };
  device?: DeviceAuth;
  locale?: string;
  userAgent?: string;
}

/** hello-ok 响应 */
export interface HelloOkPayload {
  type: "hello-ok";
  protocol: number;
  server: {
    version: string;
    commit?: string;
    host?: string;
    connId: string;
  };
  features: {
    methods: string[];
    events: string[];
  };
  snapshot: Record<string, unknown> & {
    sessionDefaults?: {
      mainSessionKey?: string;
      [key: string]: unknown;
    };
  };
  auth?: {
    deviceToken: string;
    role: string;
    scopes: string[];
  };
  policy: {
    maxPayload: number;
    maxBufferedBytes: number;
    tickIntervalMs: number;
    /** 服务端限流时返回，客户端应据此调整心跳/重连间隔 */
    retryAfterMs?: number;
  };
}

// ===== Chat API =====

/** chat.send 参数 */
export interface ChatSendParams {
  sessionKey: string;
  message: string;
  thinking?: string;
  deliver?: boolean;
  attachments?: unknown[];
  timeoutMs?: number;
  idempotencyKey: string;
}

/** chat.history 参数 */
export interface ChatHistoryParams {
  sessionKey: string;
  limit?: number;
  /** 加载此时间戳之前的消息（用于分页） */
  before?: number;
}

/** chat.abort 参数 */
export interface ChatAbortParams {
  sessionKey: string;
  runId?: string;
}

/** chat 事件载荷 */
export interface ChatEventPayload {
  runId: string;
  sessionKey: string;
  seq: number;
  state: "delta" | "final" | "aborted" | "error";
  message?: ChatMessage;
  errorMessage?: string;
  usage?: unknown;
  stopReason?: string;
}

/** 聊天消息（简化） */
export interface ChatMessage {
  role?: string;
  content?: string | ChatContentPart[];
  [key: string]: unknown;
}

/** 多模态内容部分 */
export interface ChatContentPart {
  type: string;
  text?: string;
  [key: string]: unknown;
}

/**
 * 运行时类型守卫：验证 unknown 值是否为合法 ChatMessage
 * 用于历史记录加载前的结构检查，避免断言错误
 */
export function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  // 必须包含 role 字段且为字符串
  if (typeof obj.role !== "string") return false;
  // content 可选，但若存在则必须为字符串或数组
  if (
    obj.content !== undefined &&
    typeof obj.content !== "string" &&
    !Array.isArray(obj.content)
  ) {
    return false;
  }
  return true;
}

/** 历史记录响应（兼容多种格式） */
export type ChatHistoryResponse =
  | ChatMessage[]
  | { messages: ChatMessage[] }
  | { history: ChatMessage[] }
  | { entries: ChatMessage[] };

// ===== Sessions API =====

/** sessions.list 参数 */
export interface SessionsListParams {
  limit?: number;
  activeMinutes?: number;
  includeGlobal?: boolean;
  includeUnknown?: boolean;
  includeDerivedTitles?: boolean;
  includeLastMessage?: boolean;
  label?: string;
  agentId?: string;
  search?: string;
}

/** sessions.reset 参数 */
export interface SessionsResetParams {
  key: string;
}

/** 会话信息（从 sessions.list 返回） */
export interface SessionInfo {
  key: string;
  agentId?: string;
  label?: string;
  model?: string;
  derivedTitle?: string;
  lastMessage?: string;
  lastActiveAt?: number;
  [key: string]: unknown;
}

// ===== Preferences =====

/** Raycast 扩展配置 */
export interface Preferences {
  gatewayUrl: string;
  gatewayToken: string;
  sessionMode: "shared" | "independent";
}

// ===== UI 消息 =====

/** 聊天消息（UI 层） */
export interface DisplayMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}
