# play-online.ps1 — 《通识局》联机对战一键通道（零部署）
# 双击 play-online.bat 即可：自动准备构建产物 + 启动服务 + 建立 Cloudflare 隧道，
# 抓到公网链接后复制到剪贴板。关掉本窗口 = 断开通道。
#
# 注意：这里不设置 $ErrorActionPreference='Stop' —— cloudflared 把大量日志
# 写到 stderr，Windows PowerShell 5.1 会将其包装为 ErrorRecord，一旦 Stop
# 会在第一行日志处中断管道。所有错误路径都改为显式检查。
#
# 参数：
#   -Rebuild   无条件重新构建（产物比代码旧时本来就会自动重编，
#              这条留给「产物看着是新的但你不信它」的情况）
#   -Port N    首选端口（默认 3000；被占用时自动往后找一个空闲端口）

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

# ---- 1. 选端口：首选 $Port，被占用就自动往后找一个空闲的 ----
# 旧版本这里是「端口被占用就直接复用那个服务」—— 那正是 500 的来源：
# 端口上的服务多半是 `next dev`，而联机通道要的是 `next start` 的生产服务；
# 两者还共用同一个 .next，dev 的产物会被 build 冲掉，表现为「部分页面 500」。
# 现在联机通道**总是起自己的生产服务**，端口冲突就换端口，绝不复用。
function Get-FreePort([int]$preferred) {
    if (-not (Test-PortInUse $preferred)) { return $preferred }
    for ($p = $preferred + 1; $p -le $preferred + 20; $p++) {
        if (-not (Test-PortInUse $p)) { return $p }
    }
    return 0
}

$serverPort = Get-FreePort $Port
if ($serverPort -eq 0) {
    Write-Host ("错误：{0} ~ {1} 端口都被占用。" -f $Port, ($Port + 20)) -ForegroundColor Red
    pause
    exit 1
}
if ($serverPort -ne $Port) {
    Write-Host ("端口 {0} 已被占用，联机通道改用 {1}。" -f $Port, $serverPort) -ForegroundColor Cyan
}

# ---- 2. 构建产物（npm start 需要构建目录） ----
# 独立 distDir（.next-online）：与 `next dev` 的 .next 彻底隔离，
# 开发服务器和联机通道可以同时跑，build 不会再冲掉 dev 的产物。
# 见 next.config.mjs 的 distDir 说明。
#
# ## 为什么不能只看 BUILD_ID 存不存在
#
# 旧版判据是「有产物就跳过构建」，于是「改过代码但忘了加 -Rebuild」会**静默用旧产物起服务**，
# 表现为「明明已经修好了，双击还是老样子」—— 这个坑实测绊了两次
# （SSE 改 POST 的修复已经落进仓库，隧道上跑的却还是昨天的 bundle）。
# 现在改成：**参与打包的源码只要比 BUILD_ID 新，就重新构建**，并把触发的文件名打出来。
#
# 参与打包的范围 = Next 会编译进产物的东西：
#   app / components / hooks / lib / types 的源文件，
#   content/ 的题库 JSON —— `lib/content/server-bank.ts` 是静态 import，改题库必须重编；
#   根目录的构建配置与依赖清单。
# 不参与打包的一律排除：docs / __tests__ / e2e / scripts 改动不该让人白等一次构建。
$sourceDirs = @('app', 'components', 'hooks', 'lib', 'types', 'content')
$sourceFiles = @(
    'next.config.mjs',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'tailwind.config.ts',
    'postcss.config.mjs'
)

function Get-NewestSource([string]$base, [string[]]$dirs, [string[]]$files) {
    $newest = $null
    foreach ($d in $dirs) {
        $p = Join-Path $base $d
        if (-not (Test-Path $p)) { continue }
        foreach ($f in Get-ChildItem -LiteralPath $p -Recurse -File -ErrorAction SilentlyContinue) {
            if (-not $newest -or $f.LastWriteTime -gt $newest.LastWriteTime) { $newest = $f }
        }
    }
    foreach ($n in $files) {
        $p = Join-Path $base $n
        if (-not (Test-Path $p)) { continue }
        $f = Get-Item -LiteralPath $p
        if (-not $newest -or $f.LastWriteTime -gt $newest.LastWriteTime) { $newest = $f }
    }
    return $newest
}

$env:NEXT_DIST_DIR = '.next-online'
$buildId = Join-Path $root '.next-online\BUILD_ID'

$reason = $null
if ($Rebuild) {
    $reason = '指定了 -Rebuild'
} elseif (-not (Test-Path $buildId)) {
    $reason = '还没有构建产物'
} else {
    $newest = Get-NewestSource $root $sourceDirs $sourceFiles
    $builtAt = (Get-Item -LiteralPath $buildId).LastWriteTime
    if ($newest -and $newest.LastWriteTime -gt $builtAt) {
        $rel = $newest.FullName.Substring($root.TrimEnd('\').Length + 1)
        $reason = ("产物比代码旧：{0} 改于 {1:MM-dd HH:mm}，而产物构建于 {2:MM-dd HH:mm}" -f `
                $rel, $newest.LastWriteTime, $builtAt)
    }
}

if ($reason) {
    Write-Host ("正在重新构建（{0}），需要几十秒..." -f $reason) -ForegroundColor Cyan
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host '错误：构建失败，无法启动联机服务。' -ForegroundColor Red
        pause
        exit 1
    }
    if (-not (Test-Path $buildId)) {
        Write-Host '错误：构建结束但找不到 .next-online\BUILD_ID。' -ForegroundColor Red
        pause
        exit 1
    }
    Write-Host '构建完成（产物在 .next-online，不影响 next dev）。' -ForegroundColor Green
} else {
    $builtAt = (Get-Item -LiteralPath $buildId).LastWriteTime
    Write-Host ("构建产物比所有源码都新，跳过构建。（产物 {0:MM-dd HH:mm}）" -f $builtAt) -ForegroundColor DarkGray
}

# ---- 3. 本地服务（npm start，独立最小化窗口） ----
$serverPid = $null
Write-Host ("正在启动服务（npm start，端口 {0}）..." -f $serverPort) -ForegroundColor Cyan
# 注意：-f 只作用到最后一个字符串，混在数组里会把整个数组拼成一个字符串，
# cmd.exe 就会收到一条非法命令。这里先单独拼好命令串再传数组。
$startCmd = 'npm start -- --port {0}' -f $serverPort
$serverPid = (Start-Process -FilePath 'cmd.exe' `
        -ArgumentList '/c', $startCmd `
        -WorkingDirectory $root `
        -WindowStyle Minimized `
        -PassThru).Id

$deadline = (Get-Date).AddSeconds(40)
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    if (Test-PortInUse $serverPort) { break }
}
if (-not (Test-PortInUse $serverPort)) {
    Write-Host '错误：服务启动失败，请确认已安装 Node.js 且可在本项目运行 npm start。' -ForegroundColor Red
    if ($serverPid) { Stop-Process -Id $serverPid -Force -ErrorAction SilentlyContinue }
    pause
    exit 1
}
Write-Host '服务已就绪。' -ForegroundColor Green

# ---- 4. Cloudflare 隧道（本窗口前台运行，关窗即断） ----
Write-Host '正在建立公网隧道（首次连接可能需要十几秒）...' -ForegroundColor Cyan
Write-Host ''

$url = $null
$recentLines = @()

& $cloudflared tunnel --url ("http://localhost:{0}" -f $serverPort) 2>&1 | ForEach-Object {
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
        Write-Host '  1. 双方都打开上面这个链接；'
        Write-Host '  2. 一方点「创建房间」，把 6 位房间码告诉对方；'
        Write-Host '  3. 另一方在「加入房间」输入房间码，即可开战。'
        Write-Host ''
        Write-Host '提示：每日挑战不需要隧道，本地开着也能玩。' -ForegroundColor DarkGray
        Write-Host '注意：对战期间保持本机开机、不要睡眠；关掉本窗口即断开通道。' -ForegroundColor Yellow
        Write-Host ''
    } elseif (-not $url -and $line.Trim().Length -gt 0) {
        # 隧道建立过程的日志（cloudflared 主要写到 stderr）
        Write-Host $line -ForegroundColor DarkGray
    }
}

# ---- 5. 收尾：隧道退出后关掉本次启动的服务 ----
if ($serverPid) {
    # /T 连子进程一起收，否则 npm / node 会变成孤儿进程继续占着端口
    & taskkill.exe /PID $serverPid /T /F 2>&1 | Out-Null
}

if (-not $url) {
    Write-Host ''
    Write-Host '隧道未能建立（可能网络不通或被杀软拦截）。最后输出：' -ForegroundColor Red
    $recentLines | ForEach-Object { Write-Host $_ -ForegroundColor DarkGray }
    Write-Host ''
    Write-Host '提示：确认能正常上网后重试；或手动执行下面命令排查：' -ForegroundColor Yellow
    Write-Host ("  {0} tunnel --url http://localhost:{1}" -f $cloudflared, $serverPort) -ForegroundColor Yellow
} else {
    Write-Host ''
    Write-Host '联机通道已关闭。' -ForegroundColor DarkGray
}
