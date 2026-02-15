/**
 * Markdown 内容处理工具
 * 移植自 Control UI 的 pd 函数
 */

/**
 * 剥离 AI 回复中的 <think>...</think> 标签块
 * 这些是模型的内部推理过程，不应展示给用户
 */
export function stripThinkingBlocks(content: string): string {
    if (!content) return "";

    // 处理完整的 <think>...</think> 块（含跨行）
    let result = content.replace(/<think>[\s\S]*?<\/think>/gi, "");

    // 处理未闭合的 <think> 标签（流式传输中可能出现）
    const openIdx = result.indexOf("<think>");
    if (openIdx !== -1) {
        result = result.slice(0, openIdx);
    }

    // 清理多余的空行
    result = result.replace(/\n{3,}/g, "\n\n").trim();

    return result;
}
