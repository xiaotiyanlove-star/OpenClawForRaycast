# Changelog

All notable changes to this project will be documented in this file.

## [3.0.0] - 2026-02-15

### Added
- **Protocol Negotiation**: 从 `hello-ok` 动态获取协议版本，不再硬编码。
- **Error Classification**: 握手失败时根据错误码分类提示（协议不兼容、Token 过期、设备未配对等）。
- **Heartbeat Throttling**: 支持服务端 `retryAfterMs` 限流，动态调整心跳间隔。
- **Storage Migration**: 升级时自动清理旧版存储键（v1/v2），避免身份冲突。
- **Type Guard**: 新增 `isChatMessage()` 运行时类型守卫，增强历史记录加载安全性。
- **Config Validation**: 连接前校验 Token 长度，提前拦截无效配置。

### Changed
- **Reconnect Message**: 重连失败终态提示更具体，引导用户手动重试。
- **README**: 统一 Git 地址为 GitHub，补充 `sessionMode` 选择建议。

## [2.0.0] - 2026-02-15

### Added
- **Smart Reconnect**: Implemented exponential backoff strategy for WebSocket reconnection.
- **History Management**: Added "Clear History" action to reset session context.
- **Config Validation**: Added startup checks for Gateway URL and Token.
- **Strict Typing**: Introduced `ChatHistoryResponse` to replace `unknown` types.
- **Metadata**: Added keywords and categories for Raycast Store discovery.
- **UI Polish**: Full bleed app icon and custom avatars for immersive chat experience.
- **Detail UI**: Synchronized avatars in Markdown detail view.

### Changed
- **UX**: Refactored chat interface to use standard Markdown rendering with deferred updates for better performance.
- **Error Handling**: Unified error messages for network, auth, and API errors using Toast notifications.
- **Code Quality**: Extracted all magic numbers and constants to `src/config.ts`.
- **Protocol**: Updated to Protocol Version 3 to match Gateway requirements.

### Removed
- **Sessions Command**: Removed "Manage Sessions" command to simplify the extension.

## [1.0.0] - 2026-02-15

### Initial Release
- Basic chat functionality with OpenClaw Gateway.
- Ed25519 device authentication.
- Real-time streaming response.
