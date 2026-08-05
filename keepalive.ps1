# keepalive.ps1
# Keeps the Puffer Workbench published app alive so CloudStudio does not recycle it
# after 30 days idle. Free, no WorkBuddy credits. Run by Windows Task Scheduler.
$url = "https://5a4c4cb6bede4b17bd780a2867f68f1f.bj10.agentos-app.net"
$log = Join-Path $PSScriptRoot "keepalive.log"
try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 20
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $log -Value "$ts OK HTTP $($r.StatusCode)"
} catch {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $log -Value "$ts FAIL $($_.Exception.Message)"
}
