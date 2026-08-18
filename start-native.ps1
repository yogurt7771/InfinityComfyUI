# Infinity ComfyUI 原生启动脚本（不使用 Docker）
# 直接双击 start-native.bat 即可启动；本脚本也可单独运行。
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$port = 7930

# 1. 检查 Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host '未找到 Node.js，请先安装 Node.js 20+ : https://nodejs.org/' -ForegroundColor Red
    Read-Host '按回车退出'
    exit 1
}
Write-Host "Node.js $(node --version)"

# 2. 安装依赖（首次运行或缺失时）
if (-not (Test-Path 'node_modules')) {
    Write-Host '首次运行，正在安装依赖 (npm install)...' -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) { Write-Host 'npm install 失败' -ForegroundColor Red; Read-Host '按回车退出'; exit 1 }
}

# 3. 构建前端（缺失时）
if (-not (Test-Path 'app-dist\index.html')) {
    Write-Host '正在构建前端 (npm run build)...' -ForegroundColor Yellow
    npm run build
    if ($LASTEXITCODE -ne 0) { Write-Host '构建失败' -ForegroundColor Red; Read-Host '按回车退出'; exit 1 }
}

# 4. 打开浏览器并启动服务
$url = "http://127.0.0.1:$port"
Start-Process $url
Write-Host "Infinity ComfyUI 正在启动: $url （按 Ctrl+C 停止）" -ForegroundColor Green
node server\serve.mjs
