/**
 * OpenClaw Chat — 主聊天命令
 * 通过 Gateway WebSocket 与 AI 对话
 *
 * 性能策略：
 * 1. 延迟渲染：生成过程中只显示静态占位符，不触发 Markdown 重绘
 * 2. selectedItemId 纯单向绑定：不使用 onSelectionChange，杜绝 render loop
 * 3. 最小化 setState 调用：用 Ref 管理非渲染状态
 */

import {
  List,
  Detail,
  ActionPanel,
  Action,
  Icon,
  showToast,
  Toast,
  getPreferenceValues,
  Color,
} from "@raycast/api";
import { useState, useEffect, useRef, useCallback } from "react";
import { GatewayClient } from "./gateway-client";
import {
  getOrCreateSessionKey,
  generateIdempotencyKey,
} from "./client-manager";
import { stripThinkingBlocks } from "./markdown-utils";
import { HISTORY_LIMIT } from "./config";
import type {
  Preferences,
  DisplayMessage,
  ChatEventPayload,
  ChatMessage,
  ChatHistoryResponse,
} from "./types";
import os from "os";

// ===== 辅助函数 =====

function extractTextContent(msg: ChatMessage | undefined): string {
  if (!msg) return "";
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((p) => p.type === "text" && p.text)
      .map((p) => p.text!)
      .join("\n");
  }
  return "";
}

function parseHistoryEntry(entry: ChatMessage): DisplayMessage | null {
  if (!entry) return null;
  const role = entry.role ?? "unknown";
  if (role !== "user" && role !== "assistant") return null;

  let content = "";
  if (typeof entry.content === "string") {
    content = entry.content;
  } else if (Array.isArray(entry.content)) {
    content = entry.content
      .filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text as string)
      .join("\n");
  }
  if (!content.trim()) return null;

  return {
    id:
      (entry.id as string) ??
      `hist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    role: role as "user" | "assistant",
    content: stripThinkingBlocks(content),
    timestamp: typeof entry.ts === "number" ? entry.ts : Date.now(),
  };
}

function truncate(text: string, maxLen: number): string {
  const oneLine = text.replace(/\n/g, " ").trim();
  return oneLine.length > maxLen ? oneLine.slice(0, maxLen) + "…" : oneLine;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 统一渲染消息 Markdown（用户和 AI 样式一致） */
function renderMessageMarkdown(msg: DisplayMessage): string {
  const icon = msg.role === "user" ? "👤" : "🤖";
  const name = msg.role === "user" ? "You" : "OpenClaw";
  const time = formatTime(msg.timestamp);
  // 使用数组 join 确保换行符正确
  return [`### ${icon} ${name}  \`${time}\``, "", msg.content].join("\n");
}

/** "思考中" 占位符 Markdown */
const THINKING_MARKDOWN = [
  "### 🤖 OpenClaw",
  "",
  "⏳ 正在思考中，完成后自动显示内容...",
].join("\n");

type ConnPhase = "init" | "connecting" | "connected" | "pairing" | "error";

// ===== 主组件 =====

export default function ChatCommand() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [connPhase, setConnPhase] = useState<ConnPhase>("init");
  const [connError, setConnError] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [selectedId, setSelectedId] = useState<string | undefined>();

  const isMounted = useRef(true);
  const clientRef = useRef<GatewayClient | null>(null);
  const sessionKeyRef = useRef("");
  const streamingRunIdRef = useRef("");
  const streamingAccumulator = useRef("");

  // ── 连接逻辑 ──
  const connect = useCallback(async () => {
    if (clientRef.current) clientRef.current.disconnect();

    const prefs = getPreferenceValues<Preferences>();
    setConnPhase("connecting");
    setIsLoading(true);

    // ── 配置校验 ──
    if (!prefs.gatewayUrl?.trim()) {
      setConnPhase("error");
      setConnError("Gateway URL 未配置，请在设置中填写");
      return;
    }
    if (!prefs.gatewayToken?.trim()) {
      setConnPhase("error");
      setConnError("Gateway Token 未配置，请在设置中填写");
      return;
    }
    try {
      new URL(prefs.gatewayUrl);
    } catch {
      setConnPhase("error");
      setConnError("Gateway URL 格式错误 (应为 ws:// 或 wss://)");
      return;
    }

    // 连接中提示
    showToast({ style: Toast.Style.Animated, title: "正在连接 Gateway..." });

    try {
      const client = new GatewayClient({
        url: prefs.gatewayUrl,
        token: prefs.gatewayToken,
        onStateChange: (state) => {
          if (!isMounted.current) return;
          if (state === "connected") {
            setConnPhase("connected");
            showToast({ style: Toast.Style.Success, title: "已连接 ✓" });
          } else if (state === "reconnecting") {
            showToast({
              style: Toast.Style.Animated,
              title: "网络波动，正在重连...",
            });
          } else if (state === "disconnected") {
            // 仅在非主动断开时提示
            if (connPhase === "connected") {
              showToast({ style: Toast.Style.Failure, title: "连接已断开" });
            }
          }
        },
        onError: (err) => {
          if (!isMounted.current) return;
          let msg = err.message;

          // 友好错误提示
          if (msg.includes("401") || msg.includes("403"))
            msg = "认证失败：Token 无效或过期";
          else if (msg.includes("ENOTFOUND") || msg.includes("ECONNREFUSED"))
            msg = "无法连接到服务器，请检查 URL";
          else if (msg.includes("1006")) msg = "网络连接意外中断 (1006)";

          // 特殊状态判断
          if (
            msg.includes("pairing") ||
            msg.includes("not paired") ||
            msg.includes("pending")
          ) {
            setConnPhase("pairing");
          } else {
            setConnPhase("error");
            setConnError(msg);
          }
          showToast({
            style: Toast.Style.Failure,
            title: "连接错误",
            message: msg,
          });
        },
      });
      clientRef.current = client;

      // ── 聊天事件 ──
      client.on("chat", (payload) => {
        if (!isMounted.current) return;
        const evt = payload as ChatEventPayload;
        if (evt.sessionKey !== sessionKeyRef.current) return;

        if (evt.state === "delta") {
          if (
            streamingRunIdRef.current &&
            streamingRunIdRef.current !== evt.runId
          )
            return;

          // 第一个 delta：标记流式、切换到 "思考中" 标签
          if (!streamingRunIdRef.current) {
            streamingRunIdRef.current = evt.runId;
            setIsStreaming(true);
            setSelectedId("streaming-placeholder");
          }

          // 仅累积到 Ref，不 setState
          const text = extractTextContent(evt.message);
          if (text) streamingAccumulator.current += text;
        } else if (evt.state === "final") {
          const finalContent = stripThinkingBlocks(
            extractTextContent(evt.message),
          );
          const completeContent =
            finalContent || stripThinkingBlocks(streamingAccumulator.current);
          streamingAccumulator.current = "";
          const finalId = `final-${evt.runId}`;

          if (completeContent) {
            setMessages((prev) => {
              if (prev.some((m) => m.id === finalId)) return prev;
              const last = prev[prev.length - 1];
              if (
                last?.role === "assistant" &&
                last.content === completeContent
              )
                return prev;
              return [
                ...prev,
                {
                  id: finalId,
                  role: "assistant" as const,
                  content: completeContent,
                  timestamp: Date.now(),
                },
              ];
            });
            setSelectedId(finalId);
          }
          // 延迟关闭 streaming，确保选中先切换到 final
          setTimeout(() => {
            if (isMounted.current) setIsStreaming(false);
          }, 0);
          streamingRunIdRef.current = "";
        } else if (evt.state === "error") {
          streamingAccumulator.current = "";
          setIsStreaming(false);
          streamingRunIdRef.current = "";
          showToast({
            style: Toast.Style.Failure,
            title: "AI 响应错误",
            message: evt.errorMessage ?? "未知错误",
          });
        } else if (evt.state === "aborted") {
          streamingAccumulator.current = "";
          setIsStreaming(false);
          streamingRunIdRef.current = "";
        }
      });

      await client.connect();

      if (isMounted.current) {
        const sk = await getOrCreateSessionKey(client);
        sessionKeyRef.current = sk;
        setConnPhase("connected");
        showToast({ style: Toast.Style.Success, title: "已连接 ✓" });
      }

      // ── 加载历史消息 ──
      try {
        const histRaw = await client.request<ChatHistoryResponse>(
          "chat.history",
          {
            sessionKey: sessionKeyRef.current,
            limit: HISTORY_LIMIT,
          },
        );

        // 兼容多种返回格式
        let entries: ChatMessage[] = [];
        if (Array.isArray(histRaw)) {
          entries = histRaw;
        } else if (histRaw && typeof histRaw === "object") {
          if ("messages" in histRaw && Array.isArray(histRaw.messages))
            entries = histRaw.messages;
          else if ("history" in histRaw && Array.isArray(histRaw.history))
            entries = histRaw.history;
          else if ("entries" in histRaw && Array.isArray(histRaw.entries))
            entries = histRaw.entries;
        }

        if (entries.length > 0) {
          const parsed = entries
            .map(parseHistoryEntry)
            .filter((m): m is DisplayMessage => m !== null);
          if (isMounted.current && parsed.length > 0) {
            const sorted = parsed.sort((a, b) => a.timestamp - b.timestamp);
            setMessages(sorted);
            setSelectedId(sorted[sorted.length - 1].id);
            showToast({
              style: Toast.Style.Success,
              title: `已加载 ${sorted.length} 条历史消息`,
            });
          }
        }
      } catch (err) {
        showToast({
          style: Toast.Style.Failure,
          title: "历史加载失败",
          message: err instanceof Error ? err.message : String(err),
        });
      }

      if (isMounted.current) setIsLoading(false);
    } catch (err) {
      if (!isMounted.current) return;
      setIsLoading(false);
      const msg = err instanceof Error ? err.message : String(err);
      setConnPhase(
        msg.includes("pairing") ||
          msg.includes("not paired") ||
          msg.includes("pending")
          ? "pairing"
          : "error",
      );
      setConnError(msg);
      showToast({
        style: Toast.Style.Failure,
        title: "连接失败",
        message: msg,
      });
    }
  }, []);

  useEffect(() => {
    isMounted.current = true;
    connect();
    return () => {
      isMounted.current = false;
      clientRef.current?.disconnect();
      clientRef.current = null;
    };
  }, [connect]);

  // ── 发送消息 ──
  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || !clientRef.current?.isConnected) return;

    const newId = `user-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      {
        id: newId,
        role: "user" as const,
        content: text.trim(),
        timestamp: Date.now(),
      },
    ]);
    setSelectedId(newId);
    setSearchText("");

    try {
      await clientRef.current.request("chat.send", {
        sessionKey: sessionKeyRef.current,
        message: text.trim(),
        idempotencyKey: generateIdempotencyKey(),
      });
    } catch (err) {
      showToast({
        style: Toast.Style.Failure,
        title: "发送失败",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const resetSession = useCallback(async () => {
    if (!clientRef.current?.isConnected) return;
    try {
      await clientRef.current.request("sessions.reset", {
        key: sessionKeyRef.current,
      });
      setMessages([]);
      setIsStreaming(false);
      setSelectedId(undefined);
      showToast({ style: Toast.Style.Success, title: "会话已重置" });
    } catch (err) {
      showToast({
        style: Toast.Style.Failure,
        title: "重置失败",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const abortGeneration = useCallback(async () => {
    if (!clientRef.current?.isConnected || !streamingRunIdRef.current) return;
    try {
      await clientRef.current.request("chat.abort", {
        sessionKey: sessionKeyRef.current,
        runId: streamingRunIdRef.current,
      });
    } catch {
      /* 忽略 */
    }
  }, []);

  // ===== 渲染 =====

  if (connPhase === "pairing") {
    const hostname = os.hostname().replace(/\.local$/, "");
    return (
      <Detail
        markdown={[
          "# ⏳ 等待配对",
          "",
          `设备 **Raycast (${hostname})** 已发送请求。`,
          "",
          "```bash",
          "openclaw devices approve <ID>",
          "```",
        ].join("\n")}
        actions={
          <ActionPanel>
            <Action
              title="重试"
              icon={Icon.ArrowClockwise}
              onAction={connect}
            />
          </ActionPanel>
        }
      />
    );
  }

  if (connPhase === "error") {
    return (
      <Detail
        markdown={[
          "# ❌ 连接失败",
          "",
          `> ${connError}`,
          "",
          "请检查配置。",
        ].join("\n")}
        actions={
          <ActionPanel>
            <Action
              title="重试"
              icon={Icon.ArrowClockwise}
              onAction={connect}
            />
          </ActionPanel>
        }
      />
    );
  }

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="输入消息... (Enter 发送)"
      searchText={searchText}
      onSearchTextChange={setSearchText}
      isShowingDetail={true}
      filtering={false}
      selectedItemId={selectedId}
      actions={
        <ActionPanel>
          {searchText.trim() && (
            <Action
              title="发送消息"
              icon={Icon.ArrowRight}
              onAction={() => sendMessage(searchText)}
            />
          )}
          {isStreaming && (
            <Action
              title="停止生成"
              icon={Icon.Stop}
              shortcut={{ modifiers: ["cmd"], key: "." }}
              onAction={abortGeneration}
            />
          )}
          <Action
            title="清空历史"
            icon={Icon.Trash}
            shortcut={{ modifiers: ["cmd", "shift"], key: "backspace" }}
            onAction={resetSession}
          />
          <Action
            title="重置会话"
            icon={Icon.ArrowClockwise}
            shortcut={{ modifiers: ["cmd", "shift"], key: "r" }}
            onAction={resetSession}
          />
        </ActionPanel>
      }
    >
      {messages.length === 0 && !isStreaming && (
        <List.EmptyView
          title="OpenClaw Chat"
          description={
            connPhase === "connected" ? "在上方输入消息开始对话" : "正在连接..."
          }
          icon={Icon.Message}
        />
      )}

      {messages.map((msg) => (
        <List.Item
          key={msg.id}
          id={msg.id}
          title={msg.role === "user" ? "👤 You" : "🤖 OpenClaw"}
          subtitle={truncate(msg.content, 50)}
          icon={msg.role === "user" ? Icon.Person : Icon.ComputerChip}
          accessories={[{ text: formatTime(msg.timestamp) }]}
          detail={<List.Item.Detail markdown={renderMessageMarkdown(msg)} />}
          actions={
            <ActionPanel>
              {searchText.trim() && (
                <Action
                  title="发送消息"
                  icon={Icon.ArrowRight}
                  onAction={() => sendMessage(searchText)}
                />
              )}
              <Action.CopyToClipboard title="复制消息" content={msg.content} />
              <Action
                title="重置会话"
                icon={Icon.Trash}
                shortcut={{ modifiers: ["cmd", "shift"], key: "r" }}
                onAction={resetSession}
              />
            </ActionPanel>
          }
        />
      ))}

      {isStreaming && (
        <List.Item
          id="streaming-placeholder"
          title="🤖 OpenClaw"
          subtitle="思考中..."
          icon={{ source: Icon.CircleProgress, tintColor: Color.Blue }}
          accessories={[{ tag: { value: "生成中", color: Color.Blue } }]}
          detail={<List.Item.Detail markdown={THINKING_MARKDOWN} />}
        />
      )}
    </List>
  );
}
