/**
 * LocalStorage 封装层
 * 兼容 Raycast 异步 LocalStorage API，提供类型安全的读写
 */

import { LocalStorage } from "@raycast/api";
import { DEPRECATED_STORAGE_KEYS, STORAGE_KEY_MIGRATED } from "./config";

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

/**
 * 存储键迁移：清理旧版本残留的设备身份数据
 * 仅在首次升级时执行一次（通过标记键判断）
 */
export async function migrateStorageKeys(): Promise<void> {
  const migrated = await LocalStorage.getItem<string>(STORAGE_KEY_MIGRATED);
  if (migrated) return; // 已迁移，跳过

  for (const key of DEPRECATED_STORAGE_KEYS) {
    await LocalStorage.removeItem(key);
  }

  await LocalStorage.setItem(STORAGE_KEY_MIGRATED, "true");
}
