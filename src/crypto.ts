/**
 * OpenClaw Gateway 设备身份密码学
 * 基于 Ed25519 签名，与 OpenClaw Gateway 协议完全兼容
 *
 * 关键实现细节（来自 Gateway 源码 src/infra/device-identity.ts）：
 * - 算法: Ed25519 (非 P-256)
 * - deviceId: SHA-256(raw 32-byte Ed25519 公钥).hex()
 * - publicKey: base64url(raw 32-byte Ed25519 公钥)
 * - 签名 payload: "v2|deviceId|clientId|clientMode|role|scopes|signedAtMs|token|nonce"
 * - 签名方式: Ed25519Sign(privateKeyPem, payload_utf8)
 */

import crypto from "node:crypto";
import { getStorageItem, setStorageItem } from "./storage";

// ===== 常量 =====
// 修改此 key 会强制所有用户重新生成设备身份
const DEVICE_IDENTITY_KEY = "openclaw-device-identity-v3";
const DEVICE_AUTH_KEY = "openclaw-device-auth-v3";

// Ed25519 SPKI DER 前缀 (12 bytes)，用于从 SPKI 中提取 raw 32-byte 公钥
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

// ===== 类型定义 =====
export interface DeviceIdentity {
  version: 1;
  deviceId: string; // SHA-256(raw pubkey).hex(), 64 chars
  publicKey: string; // base64url(raw 32-byte Ed25519 pubkey)
  publicKeyPem: string; // PEM 格式公钥 (用于调试)
  privateKeyPem: string; // PEM 格式私钥 (用于签名)
}

export interface DeviceTokenStore {
  version: 1;
  tokens: Record<
    string,
    {
      token: string;
      scopes: string[];
      updatedAtMs: number;
    }
  >;
}

/** 构建签名 payload 的参数 */
export interface DeviceAuthPayloadParams {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token?: string | null;
  nonce?: string | null;
}

// ===== Base64url 编解码 =====
function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

// ===== 内部工具函数 =====

/**
 * 从 PEM 格式公钥中提取 raw 32-byte Ed25519 公钥
 */
function derivePublicKeyRaw(publicKeyPem: string): Buffer {
  const key = crypto.createPublicKey(publicKeyPem);
  const spki = key.export({ type: "spki", format: "der" }) as Buffer;
  // Ed25519 SPKI = 12-byte prefix + 32-byte raw key
  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return spki;
}

/**
 * 计算 deviceId = SHA-256(raw pubkey).hex()
 */
function fingerprintPublicKey(publicKeyPem: string): string {
  const raw = derivePublicKeyRaw(publicKeyPem);
  return crypto.createHash("sha256").update(raw).digest("hex");
}

// ===== 设备身份管理 =====

/**
 * 生成新的 Ed25519 设备身份
 */
export function generateDeviceIdentity(): DeviceIdentity {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey
    .export({ type: "spki", format: "pem" })
    .toString();
  const privateKeyPem = privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();
  const deviceId = fingerprintPublicKey(publicKeyPem);
  const publicKeyRaw = derivePublicKeyRaw(publicKeyPem);

  return {
    version: 1,
    deviceId,
    publicKey: base64UrlEncode(publicKeyRaw),
    publicKeyPem,
    privateKeyPem,
  };
}

/**
 * 从 Raycast LocalStorage 加载设备身份
 */
export async function loadDeviceIdentity(): Promise<DeviceIdentity | null> {
  try {
    const data = await getStorageItem<DeviceIdentity>(DEVICE_IDENTITY_KEY);
    if (
      data?.version === 1 &&
      data.deviceId &&
      data.publicKeyPem &&
      data.privateKeyPem
    ) {
      return data;
    }
  } catch {
    /* 静默处理 */
  }
  return null;
}

/**
 * 保存设备身份到 Raycast LocalStorage
 */
export async function saveDeviceIdentity(
  identity: DeviceIdentity,
): Promise<void> {
  await setStorageItem(DEVICE_IDENTITY_KEY, identity);
}

/**
 * 获取或创建设备身份（单例模式）
 */
export async function getOrCreateDeviceIdentity(): Promise<DeviceIdentity> {
  let identity = await loadDeviceIdentity();
  if (!identity) {
    identity = generateDeviceIdentity();
    await saveDeviceIdentity(identity);
  }
  return identity;
}

// ===== 签名 =====

/**
 * 构建设备认证 payload（与 Gateway device-auth.ts 完全一致）
 *
 * 格式: "v2|deviceId|clientId|clientMode|role|scopes|signedAtMs|token|nonce"
 * 其中 scopes 用逗号连接
 */
export function buildDeviceAuthPayload(
  params: DeviceAuthPayloadParams,
): string {
  const scopes = params.scopes.join(",");
  const token = params.token ?? "";
  const nonce = params.nonce ?? "";
  const base = [
    "v2",
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    scopes,
    String(params.signedAtMs),
    token,
    nonce,
  ];
  return base.join("|");
}

/**
 * 用 Ed25519 私钥签名 payload 字符串
 *
 * @param privateKeyPem PEM 格式的 Ed25519 私钥
 * @param payload 待签名的 payload 字符串
 * @returns base64url 编码的签名
 */
export function signDevicePayload(
  privateKeyPem: string,
  payload: string,
): string {
  const key = crypto.createPrivateKey(privateKeyPem);
  const sig = crypto.sign(null, Buffer.from(payload, "utf8"), key);
  return base64UrlEncode(sig);
}

// ===== 设备令牌管理 =====

/**
 * 保存 Gateway 返回的设备令牌
 */
export async function saveDeviceToken(
  role: string,
  token: string,
  scopes: string[],
): Promise<void> {
  let data: DeviceTokenStore = { version: 1, tokens: {} };
  try {
    const existing = await getStorageItem<DeviceTokenStore>(DEVICE_AUTH_KEY);
    if (existing?.version === 1) data = existing;
  } catch {
    /* 静默处理 */
  }

  data.tokens[role] = {
    token,
    scopes,
    updatedAtMs: Date.now(),
  };
  await setStorageItem(DEVICE_AUTH_KEY, data);
}
