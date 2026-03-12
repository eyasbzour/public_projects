<#
.SYNOPSIS
    Plays WAV sounds on laptop lid close / open.
#>

# ======================== CONFIG ========================
$SoundOpenPath   = "path to the sound when opening the lid ( wav file )"
$SoundClosePath  = "path to sound file when closing the lid ( wav file )"
$CloseDebounce   = 20     # SessionLock→Suspend gap is ~13s, so 20 covers it
$OpenDebounce    = 8      # covers the 4× Resume flood
$TestOnStart     = $true
# ========================================================

if (-not ([System.Management.Automation.PSTypeName]'WinMM').Type) {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class WinMM
{
    [DllImport("winmm.dll", SetLastError = true)]
    public static extern bool PlaySound(
        byte[] pszSound, IntPtr hmod, uint fdwSound);
    public const uint SND_SYNC      = 0x0000;
    public const uint SND_ASYNC     = 0x0001;
    public const uint SND_NODEFAULT = 0x0002;
    public const uint SND_MEMORY    = 0x0004;
    public const uint SND_PURGE     = 0x0040;
}
"@
}

[uint32] $CLOSE_FLAGS = 0x0006   # MEMORY | NODEFAULT | SYNC
[uint32] $OPEN_FLAGS  = 0x0007   # MEMORY | NODEFAULT | ASYNC


$abort = $false
foreach ($f in @(
    @{ L = "Close"; P = $SoundClosePath },
    @{ L = "Open "; P = $SoundOpenPath  }
)) {
    if (Test-Path $f.P) {
        $kb = [math]::Round((Get-Item $f.P).Length / 1KB, 1)
        Write-Host "  ✔ $($f.L)  $($f.P)  ($kb KB)" -ForegroundColor Green
    } else {
        Write-Host "  ✘ $($f.L)  $($f.P)  — NOT FOUND" -ForegroundColor Red
        $abort = $true
    }
}
if ($abort) { Write-Host "`n  Fix paths above.`n" -ForegroundColor Red; exit 1 }

$closeBytes = [System.IO.File]::ReadAllBytes($SoundClosePath)
$openBytes  = [System.IO.File]::ReadAllBytes($SoundOpenPath)

function Get-WavSeconds ([byte[]]$w) {
    if ($w.Length -lt 44) { return -1 }
    $byteRate = [BitConverter]::ToInt32($w, 28)
    if ($byteRate -le 0)  { return -1 }
    $i = 12
    while ($i + 8 -lt $w.Length) {
        $id   = [System.Text.Encoding]::ASCII.GetString($w, $i, 4)
        $size = [BitConverter]::ToInt32($w, $i + 4)
        if ($id -eq 'data') { return [math]::Round($size / $byteRate, 1) }
        $i += 8 + $size
    }
    return -1
}

$closeDur = Get-WavSeconds $closeBytes
$openDur  = Get-WavSeconds $openBytes
Write-Host ""
Write-Host "  Loaded → close ${closeDur}s  open ${openDur}s" -ForegroundColor DarkGray

if ($TestOnStart) {
    Write-Host "  Testing open sound..." -ForegroundColor DarkGray
    [WinMM]::PlaySound($openBytes, [IntPtr]::Zero, $CLOSE_FLAGS) | Out-Null
    Write-Host "  ✔ Test passed." -ForegroundColor DarkGray
}

# ── Shared state (no Monitor, no boolean gates) ──────
$state = [hashtable]::Synchronized(@{
    LastClose     = [datetime]::MinValue
    LastOpen      = [datetime]::MinValue
    LastResume    = [datetime]::MinValue
    Close         = $closeBytes
    Open          = $openBytes
    CloseFlags    = $CLOSE_FLAGS
    OpenFlags     = $OPEN_FLAGS
    CloseDebounce = $CloseDebounce
    OpenDebounce  = $OpenDebounce
})

# ── Kill ALL leftover subscriptions ──────────────────
'LidSession', 'LidPower' | ForEach-Object {
    Get-EventSubscriber -SourceIdentifier $_ -EA SilentlyContinue |
        Unregister-Event -Force
}

# ══════════════════════════════════════════════════════
#  EVENT 1 — SessionLock → CLOSE
# ══════════════════════════════════════════════════════
Register-ObjectEvent ([Microsoft.Win32.SystemEvents]) SessionSwitch `
    -SourceIdentifier 'LidSession' -MessageData $state -Action {

    $cfg    = $Event.MessageData
    $reason = $Event.SourceEventArgs.Reason

    if ($reason -eq 'SessionLock') {
        $now         = [datetime]::UtcNow
        $sinceResume = ($now - $cfg.LastResume).TotalSeconds
        $sinceClose  = ($now - $cfg.LastClose).TotalSeconds

        # Not a wake-time lock AND not a duplicate
        if ($sinceResume -ge 15 -and $sinceClose -ge $cfg.CloseDebounce) {
            $cfg.LastClose = $now
            Write-Host "  [ $(Get-Date -F 'HH:mm:ss') ] ● LID CLOSED  (session lock)" `
                       -ForegroundColor Red
            [WinMM]::PlaySound($cfg.Close, [IntPtr]::Zero, $cfg.CloseFlags) | Out-Null
        } else {
            Write-Host "  [ $(Get-Date -F 'HH:mm:ss') ]   skipped lock (resume=${sinceResume}s close=${sinceClose}s)" `
                       -ForegroundColor DarkGray
        }
    }
} | Out-Null

# ══════════════════════════════════════════════════════
#  EVENT 2 — PowerModeChanged
# ══════════════════════════════════════════════════════
Register-ObjectEvent ([Microsoft.Win32.SystemEvents]) PowerModeChanged `
    -SourceIdentifier 'LidPower' -MessageData $state -Action {

    $cfg  = $Event.MessageData
    $mode = $Event.SourceEventArgs.Mode

    if ($mode -eq 'Resume') {
        $now        = [datetime]::UtcNow
        $cfg.LastResume = $now               # mark wake — blocks false SessionLock
        $sinceOpen  = ($now - $cfg.LastOpen).TotalSeconds

        if ($sinceOpen -ge $cfg.OpenDebounce) {
            $cfg.LastOpen = $now
            Write-Host "  [ $(Get-Date -F 'HH:mm:ss') ] ● LID OPENED  (resume)" `
                       -ForegroundColor Green
            [WinMM]::PlaySound($cfg.Open, [IntPtr]::Zero, $cfg.OpenFlags) | Out-Null
        } else {
            Write-Host "  [ $(Get-Date -F 'HH:mm:ss') ]   skipped resume (open=${sinceOpen}s)" `
                       -ForegroundColor DarkGray
        }
    }
    elseif ($mode -eq 'Suspend') {
        $now         = [datetime]::UtcNow
        $sinceClose  = ($now - $cfg.LastClose).TotalSeconds

        # Fallback — only fires if SessionLock didn't (20s debounce covers it)
        if ($sinceClose -ge $cfg.CloseDebounce) {
            $cfg.LastClose = $now
            Write-Host "  [ $(Get-Date -F 'HH:mm:ss') ] ● LID CLOSED  (suspend fallback)" `
                       -ForegroundColor DarkRed
            [WinMM]::PlaySound($cfg.Close, [IntPtr]::Zero, $cfg.CloseFlags) | Out-Null
        } else {
            Write-Host "  [ $(Get-Date -F 'HH:mm:ss') ]   skipped suspend (close=${sinceClose}s)" `
                       -ForegroundColor DarkGray
        }
    }
} | Out-Null

Write-Host ""
Write-Host "  Listening.  Close or open your lid." -ForegroundColor Green
Write-Host "  Press Ctrl+C to stop."
Write-Host "  Kill any other lid-sound scripts first!" -ForegroundColor Yellow
Write-Host ""

try {
    while ($true) { Start-Sleep -Seconds 1 }
}
finally {
    Write-Host "`n  Shutting down..." -ForegroundColor Yellow
    [WinMM]::PlaySound($null, [IntPtr]::Zero, [uint32]0x0040) | Out-Null
    'LidSession', 'LidPower' | ForEach-Object {
        Unregister-Event -SourceIdentifier $_ -Force -EA SilentlyContinue
    }
    Get-Process wmplayer -EA SilentlyContinue | Stop-Process -Force
    Write-Host "  Done.`n" -ForegroundColor Cyan
}
