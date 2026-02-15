/**
 * OpenClaw Raycast Extension 配置常量
 */

// ===== Gateway 连接配置 =====
export const DEFAULT_GATEWAY_URL = "wss://openclaw.example.com";
export const PROTOCOL_VERSION = 3;

// ===== 超时与重连 =====
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_RECONNECTS = 5;
export const DEFAULT_TICK_INTERVAL_MS = 15_000;

// ===== 重连策略 (Exponential Backoff) =====
export const RECONNECT_BASE_DELAY_MS = 1000;
export const RECONNECT_MAX_DELAY_MS = 30_000;

// ===== UI 与交互 =====
export const HISTORY_LIMIT = 50;
export const TOAST_DURATION_MS = 3000;

// ===== 存储 Keys =====
// 修改此 key 会强制所有用户重新生成设备身份
export const STORAGE_KEY_DEVICE_IDENTITY = "openclaw-device-identity-v3";
export const STORAGE_KEY_DEVICE_AUTH = "openclaw-device-auth-v3";

// ===== 客户端信 =====
export const CLIENT_ID = "openclaw-control-ui"; // 保持与 Control UI 一致
export const CLIENT_MODE = "webchat";
export const CLIENT_VERSION = "1.0.0";
export const USER_AGENT_PREFIX = "raycast-openclaw";

// ===== 权限 Scopes =====
export const DEFAULT_SCOPES = [
  "operator.admin",
  "operator.approvals",
  "operator.pairing",
];
