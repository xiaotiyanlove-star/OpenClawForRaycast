/**
 * LocalStorage 封装层
 * 兼容 Raycast 异步 LocalStorage API，提供类型安全的读写
 */

import { LocalStorage } from "@raycast/api";

/**
 * 类型安全地读取存储项
 */
export async function getStorageItem<T>(
  key: string,
  fallback?: T,
): Promise<T | undefined> {
  try {
    const raw = await LocalStorage.getItem<string>(key);
    if (raw === undefined || raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * 写入存储项（JSON 序列化）
 */
export async function setStorageItem(
  key: string,
  value: unknown,
): Promise<void> {
  await LocalStorage.setItem(key, JSON.stringify(value));
}

/**
 * 删除存储项
 */
export async function removeStorageItem(key: string): Promise<void> {
  await LocalStorage.removeItem(key);
}
