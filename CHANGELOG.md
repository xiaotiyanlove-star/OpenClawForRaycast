# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- **Smart Reconnect**: Implemented exponential backoff strategy for WebSocket reconnection.
- **History Management**: Added "Clear History" action to reset session context.
- **Config Validation**: Added startup checks for Gateway URL and Token.
- **Strict Typing**: Introduced `ChatHistoryResponse` to replace `unknown` types.
- **Metadata**: Added keywords and categories for Raycast Store discovery.

### Changed
- **UX**: Refactored chat interface to use standard Markdown rendering with deferred updates for better performance.
- **Error Handling**: Unified error messages for network, auth, and API errors using Toast notifications.
- **Code Quality**: Extracted all magic numbers and constants to `src/config.ts`.

### Removed
- **Sessions Command**: Removed "Manage Sessions" command to simplify the extension.

## [1.0.0] - 2024-01-01

### Initial Release
- Basic chat functionality with OpenClaw Gateway.
- Ed25519 device authentication.
- Real-time streaming response.
