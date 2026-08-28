# ==============================================================================
# story-architect-mcp 1-Line Installer for Windows (PowerShell)
# Usage:
#   iwr -useb https://raw.githubusercontent.com/PTCuong-1102/story-architect-mcp/main/scripts/install.ps1 | iex
# ==============================================================================

Write-Host @"
╔══════════════════════════════════════════════════════════════════╗
║               STORY-ARCHITECT-MCP INSTALLER                      ║
║    Model Context Protocol Server for AI-Assisted Novel Writing   ║
╚══════════════════════════════════════════════════════════════════╝
"@ -ForegroundColor Cyan

# 1. Check Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Node.js chưa được cài đặt trên máy của bạn!" -ForegroundColor Red
    Write-Host "👉 Vui lòng tải và cài đặt Node.js (>= 20.0.0) tại https://nodejs.org/" -ForegroundColor Yellow
    Exit 1
}

$nodeVer = (node -v).TrimStart('v').Split('.')[0]
if ([int]$nodeVer -lt 20) {
    Write-Host "⚠️ Node.js phiên bản hiện tại ($(node -v)) quá cũ." -ForegroundColor Yellow
    Write-Host "👉 story-architect-mcp yêu cầu Node.js >= 20.0.0. Vui lòng cập nhật Node.js!" -ForegroundColor Yellow
    Exit 1
}

Write-Host "✅ Đã tìm thấy Node.js $(node -v)" -ForegroundColor Green

# 2. Run Setup Wizard via NPX
Write-Host "🚀 Đang khởi chạy Setup Wizard..." -ForegroundColor Cyan
npx -y story-architect-mcp setup $args
