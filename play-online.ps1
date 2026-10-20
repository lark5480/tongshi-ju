# play-online.ps1 — 《通识局》联机对战一键通道（零部署）
# 双击 play-online.bat 即可：自动准备构建产物 + 启动服务 + 建立 Cloudflare 隧道，
# 抓到公网链接后复制到剪贴板。关掉本窗口 = 断开通道。
#
# 注意：这里不设置 $ErrorActionPreference='Stop' —— cloudflared 把大量日志
# 写到 stderr，Windows PowerShell 5.1 会将其包装为 ErrorRecord，一旦 Stop
# 会在第一行日志处中断管道。所有错误路径都改为显式检查。
#
# 参数：
#   -Rebuild   强制重新构建（改过代码后用）
#   -Port N    指定端口（默认 3000）

param(
    [switch]$Rebuild,
    [int]$Port = 3000
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

# ---- 0. 定位 cloudflared（项目根目录优先，其次 PATH） ----
$localTunnel = Join-Path $root 'cloudflared.exe'
$cloudflared = $null
if (Test-Path $localTunnel) {
    $cloudflared = $localTunnel
} else {
    $cmd = Get-Command 'cloudflared' -ErrorAction SilentlyContinue
    if ($cmd) { $cloudflared = $cmd.Source }
}
if (-not $cloudflared) {
    Write-Host '错误：找不到 cloudflared。' -ForegroundColor Red
    Write-Host '方式一：把 cloudflared.exe 放到项目根目录。' -ForegroundColor Red
    Write-Host '方式二：安装到 PATH（winget install --id Cloudflare.cloudflared）。' -ForegroundColor Red
    Write-Host '下载地址：https://developers.cloudflare.com/cloudflared/' -ForegroundColor Red
    pause
    exit 1
}

function Test-PortInUse([int]$p) {
    $listener = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
    return [bool]$listener
}

# ---- 1. 构建产物（npm start 需要 .next） ----
$buildId = Join-Path $root '.next\BUILD_ID'
if ($Rebuild -or -not (Test-Path $buildId)) {
    Write-Host '正在构建（首次运行或指定 -Rebuild，需要几十秒）...' -ForegroundColor Cyan
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host '错误：构建失败，无法启动联机服务。' -ForegroundColor Red
        pause
        exit 1
    }
    if (-not (Test-Path $buildId)) {
        Write-Host '错误：构建结束但找不到 .next\BUILD_ID。' -ForegroundColor Red
        pause
        exit 1
    }
    Write-Host '构建完成。' -ForegroundColor Green
} else {
    Write-Host '检测到已有构建产物，跳过构建（改过代码请用 -Rebuild 重跑）。' -ForegroundColor DarkGray
}

# ---- 2. 本地服务（npm start，独立最小化窗口） ----
$serverPid = $null
if (Test-PortInUse $Port) {
    Write-Host ("端口 {0} 已有服务在运行，直接复用（结束后请手动关闭那个窗口）。" -f $Port) -ForegroundColor Cyan
} else {
    $serverPid = (Start-Process -FilePath 'cmd.exe' `
            -ArgumentList '/c', 'npm start' `
            -WorkingDirectory $root `
            -WindowStyle Minimized `
            -PassThru).Id
    Write-Host '正在启动服务（npm start）...' -ForegroundColor Cyan

    $deadline = (Get-Date).AddSeconds(40)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 500
        if (Test-PortInUse $Port) { break }
    }
    if (-not (Test-PortInUse $Port)) {
        Write-Host '错误：服务启动失败，请确认已安装 Node.js 且可在本项目运行 npm start。' -ForegroundColor Red
        if ($serverPid) { Stop-Process -Id $serverPid -Force -ErrorAction SilentlyContinue }
        pause
        exit 1
    }
    Write-Host '服务已就绪。' -ForegroundColor Green
}

# ---- 3. Cloudflare 隧道（本窗口前台运行，关窗即断） ----
Write-Host '正在建立公网隧道（首次连接可能需要十几秒）...' -ForegroundColor Cyan
Write-Host ''

$url = $null
$recentLines = @()

& $cloudflared tunnel --url ("http://localhost:{0}" -f $Port) 2>&1 | ForEach-Object {
    $line = [string]$_
    $recentLines = @($recentLines + $line) | Select-Object -Last 6

    if (-not $url -and $line -match 'https://[a-z0-9-]+\.trycloudflare\.com') {
        $url = $matches[0]
        $duelUrl = $url + '/duel'
        $duelUrl | clip
        Write-Host '============================================================' -ForegroundColor Green
        Write-Host ('  联机入口（已自动复制到剪贴板）：' + $duelUrl) -ForegroundColor Green
        Write-Host '  直接粘贴发给朋友即可。' -ForegroundColor Green
        Write-Host '============================================================' -ForegroundColor Green
        Write-Host ''
        Write-Host '玩法：' -ForegroundColor Cyan
        Write-Host '  1. 双方都打开上面这个链接；' -ForegroundColor Cyan
        Write-Host '  2. 一方点「创建房间」，把 6 位房间码告诉对方；' -ForegroundColor Cyan
        Write-Host '  3. 另一方在「加入房间」输入房间码，即可开战。' -ForegroundColor Cyan
        Write-Host ''
        Write-Host '提示：每日挑战不需要隧道，本地开着也能玩。' -ForegroundColor DarkGray
        Write-Host '注意：对战期间保持本机开机、不要睡眠；关掉本窗口即断开通道。' -ForegroundColor Yellow
        Write-Host ''
    } elseif (-not $url -and $line.Trim().Length -gt 0) {
        # 隧道建立过程的日志（cloudflared 主要写到 stderr）
        Write-Host $line -ForegroundColor DarkGray
    }
}

# ---- 4. 收尾：隧道退出后关掉本次启动的服务 ----
if ($serverPid) {
    Stop-Process -Id $serverPid -Force -ErrorAction SilentlyContinue
}

if (-not $url) {
    Write-Host ''
    Write-Host '隧道未能建立（可能网络不通或被杀软拦截）。最后输出：' -ForegroundColor Red
    $recentLines | ForEach-Object { Write-Host $_ -ForegroundColor DarkGray }
    Write-Host ''
    Write-Host '提示：确认能正常上网后重试；或手动执行下面命令排查：' -ForegroundColor Yellow
    Write-Host ("  {0} tunnel --url http://localhost:{1}" -f $cloudflared, $Port) -ForegroundColor Yellow
} else {
    Write-Host ''
    Write-Host '联机通道已关闭。' -ForegroundColor DarkGray
}
