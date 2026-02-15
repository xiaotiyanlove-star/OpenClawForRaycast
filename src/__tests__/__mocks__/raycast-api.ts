/**
 * @raycast/api 模拟
 * 仅提供测试中需要的最小 API surface
 */
export const LocalStorage = {
    getItem: async (_key: string) => undefined,
    setItem: async (_key: string, _value: string) => { },
    removeItem: async (_key: string) => { },
    allItems: async () => ({} as Record<string, string>),
    clear: async () => { },
};

export function getPreferenceValues() {
    return {};
}

export function showToast() { }

export const Toast = {
    Style: {
        Success: "success",
        Failure: "failure",
        Animated: "animated",
    },
};

export const environment = {
    assetsPath: "/mock/assets",
};
