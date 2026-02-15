/**
 * Gateway 客户端单例管理
 * 在 Raycast 扩展生命周期内保持单一 WebSocket 连接
 */

import { getPreferenceValues } from "@raycast/api";
import { GatewayClient } from "./gateway-client";
import { getStorageItem, setStorageItem } from "./storage";
import type { Preferences } from "./types";

let _client: GatewayClient | null = null;

/**
 * 获取 Gateway 客户端单例
 * 如果配置发生变化，会重新创建
 */
export function getClient(): GatewayClient {
    const prefs = getPreferenceValues<Preferences>();

    if (_client && _client.isConnected) {
        return _client;
    }

    // 如果存在旧连接，先断开
    if (_client) {
        _client.disconnect();
    }

    _client = new GatewayClient({
        url: prefs.gatewayUrl,
        token: prefs.gatewayToken,
    });

    return _client;
}

/**
 * 断开并清理客户端
 */
export function destroyClient(): void {
    if (_client) {
        _client.disconnect();
        _client = null;
    }
}

/**
 * 获取或创建 Session Key（异步）
 * - shared 模式：从 hello.snapshot.sessionDefaults.mainSessionKey 获取
 * - independent 模式：从 LocalStorage 读取或调用 sessions.create 创建
 */
export async function getOrCreateSessionKey(client: GatewayClient): Promise<string> {
    const prefs = getPreferenceValues<Preferences>();

    if (prefs.sessionMode === "shared") {
        // 共享模式：使用 Gateway 提供的主会话 Key
        const hello = client.hello;
        return hello?.snapshot?.sessionDefaults?.mainSessionKey ?? "main";
    }

    // 独立模式：检查本地是否已有 session key
    const stored = await getStorageItem<string>("raycast-session-key");
    if (stored) return stored;

    // 没有 → 调用 sessions.create 创建新会话
    try {
        const result = await client.request<{ sessionKey: string }>("sessions.create", {
            agentId: "main",
            name: "Raycast",
        });
        if (result?.sessionKey) {
            await setStorageItem("raycast-session-key", result.sessionKey);
            return result.sessionKey;
        }
    } catch {
        // 创建失败则 fallback
    }

    // 最终 fallback
    return "ws:raycast:main";
}

/**
 * 生成唯一的幂等密钥
 */
export function generateIdempotencyKey(): string {
    return `rc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
