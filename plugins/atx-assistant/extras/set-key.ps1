# Save an ATX API key locally for the ATX WorkBuddy plugin, without pasting it into chat.
# Writes %USERPROFILE%\.workbuddy\atx-assistant\settings.json and (optionally) updates
# the apiKey of ATX models already present in %USERPROFILE%\.workbuddy\models.json.
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$wb = Join-Path $env:USERPROFILE '.workbuddy'
$settingsDir = Join-Path $wb 'atx-assistant'
$settingsPath = Join-Path $settingsDir 'settings.json'
$modelsPath = Join-Path $wb 'models.json'

Write-Host ''
Write-Host '======== ATX 密钥设置 ========' -ForegroundColor Cyan
Write-Host '在 https://aitransx.com/zh/login 登录后创建 API Key（以 aitx- 开头）。'
Write-Host '粘贴时屏幕不会显示内容，这是正常的。'
Write-Host ''

$key = ''
while ($key -notmatch '^aitx-[A-Za-z0-9]{16,}$') {
    $sec = Read-Host '请粘贴 API Key 后回车' -AsSecureString
    $key = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)).Trim()
    if ($key -notmatch '^aitx-[A-Za-z0-9]{16,}$') { Write-Host '格式不对，应以 aitx- 开头，请重新粘贴。' -ForegroundColor Yellow }
}

Write-Host ''
Write-Host '选择线路：1 = 默认 (api.aitransx.com)   2 = 香港 (api-hk.aitransx.com)'
$line = Read-Host '直接回车选 1'
$base = if ($line -eq '2') { 'https://api-hk.aitransx.com/v1' } else { 'https://api.aitransx.com/v1' }

# Verify for free via the model catalog endpoint.
try {
    Invoke-RestMethod -Uri "$base/models" -Headers @{ Authorization = "Bearer $key" } -TimeoutSec 20 | Out-Null
    Write-Host 'Key 验证通过。' -ForegroundColor Green
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -eq 401) { Write-Host 'Key 无效（401），请到控制台确认后重试。' -ForegroundColor Red; exit 1 }
    Write-Host "暂时无法验证（$code），仍将保存。" -ForegroundColor Yellow
}

New-Item -ItemType Directory -Force -Path $settingsDir | Out-Null
$settings = @{}
if (Test-Path $settingsPath) {
    (Get-Content $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $settings[$_.Name] = $_.Value }
}
$settings['apiKey'] = $key
$settings['baseUrl'] = $base
[IO.File]::WriteAllText($settingsPath, ($settings | ConvertTo-Json -Depth 10), $utf8)
Write-Host "已保存到 $settingsPath" -ForegroundColor DarkGray

# Update existing ATX models in WorkBuddy so chat models use the same key.
if (Test-Path $modelsPath) {
    $raw = [IO.File]::ReadAllText($modelsPath, [Text.Encoding]::UTF8).Trim()
    if ($raw) {
        $data = $raw | ConvertFrom-Json
        $list = if ($data -is [System.Array]) { $data } elseif ($data.models) { $data.models } else { @() }
        $atx = @($list | Where-Object { $_.url -match '^https://([a-z0-9-]+\.)?aitransx\.com/' })
        if ($atx.Count -gt 0) {
            $ans = Read-Host "WorkBuddy 中已有 $($atx.Count) 个 ATX 模型，是否同步更新它们的 Key？(Y/n)"
            if ($ans -ne 'n' -and $ans -ne 'N') {
                Copy-Item $modelsPath "$modelsPath.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
                foreach ($m in $atx) { $m.apiKey = $key }
                [IO.File]::WriteAllText($modelsPath, (ConvertTo-Json -InputObject $data -Depth 10), $utf8)
                Write-Host '已同步，原文件已备份。' -ForegroundColor Green
            }
        }
    }
}

Write-Host ''
Write-Host '完成！回到 WorkBuddy 新开对话，发送：检查 ATX 状态' -ForegroundColor Green
