#!/usr/bin/env bash
set -e

# ==============================================================================
# story-architect-mcp 1-Line Installer for macOS & Linux
# ==============================================================================

echo "
╔══════════════════════════════════════════════════════════════════╗
║               STORY-ARCHITECT-MCP INSTALLER                      ║
║    Model Context Protocol Server for AI-Assisted Novel Writing   ║
╚══════════════════════════════════════════════════════════════════╝
"

# 1. Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js chưa được cài đặt trên máy của bạn!"
    echo "👉 Vui lòng cài đặt Node.js (phiên bản >= 20.0.0) tại https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo "⚠️  Node.js phiên bản hiện tại ($(node -v)) quá cũ."
    echo "👉 story-architect-mcp yêu cầu Node.js >= 20.0.0. Vui lòng cập nhật Node.js!"
    exit 1
fi

echo "✅ Đã tìm thấy Node.js $(node -v)"

# 2. Run Setup Wizard via NPX
echo "🚀 Đang khởi chạy Setup Wizard..."
npx -y story-architect-mcp setup "$@"
