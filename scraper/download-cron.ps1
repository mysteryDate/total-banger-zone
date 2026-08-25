#Requires -Version 7
<#
Scheduled-task wrapper for downloading audio for new tracks.
Runs frequently; exits immediately if nothing is pending.

Register the task: see scraper/register-download-task.ps1
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

# node emits UTF-8; without this, track titles land in the log as mojibake
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$ScraperDir = $PSScriptRoot
$RepoDir = Split-Path -Parent $ScraperDir
$TracksPath = Join-Path $RepoDir 'tracks.json'
$LogPath = Join-Path $env:LOCALAPPDATA 'total-banger-zone\download-cron.log'

$MaxLogLines = 5000
$UnresolvedSubtypes = @('album', 'playlist')
$RequiredTools = @('git', 'node', 'yt-dlp', 'ffmpeg')

function Write-Log {
    param([string]$Message)
    $stamp = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
    $line = "[$stamp] $Message"
    Write-Host $line
    Add-Content -Path $LogPath -Value $line
}

function Limit-LogSize {
    if (-not (Test-Path $LogPath)) { return }
    $lines = @(Get-Content $LogPath)
    if ($lines.Count -le $MaxLogLines) { return }
    Set-Content -Path $LogPath -Value $lines[-$MaxLogLines..-1]
}

function Assert-RequiredTools {
    $missing = $RequiredTools | Where-Object { -not (Get-Command $_ -ErrorAction SilentlyContinue) }
    if ($missing) { throw "Not on PATH: $($missing -join ', ')" }
}

# A yt-dlp more than a few weeks stale starts getting 403s from YouTube.
# Never fatal: a failed update should not stop a run that might still work.
function Update-YtDlp {
    try {
        $output = & yt-dlp -U 2>&1 | Out-String
        if ($output -match 'Updated yt-dlp to (\S+)') { Write-Log "yt-dlp updated to $($Matches[1])" }
    }
    catch { Write-Log "yt-dlp self-update failed, continuing: $_" }
}

function Invoke-Git {
    param([Parameter(ValueFromRemainingArguments)][string[]]$GitArgs)
    $output = & git @GitArgs 2>&1
    if ($LASTEXITCODE -ne 0) { throw "git $($GitArgs -join ' ') failed: $output" }
    $output
}

# Mirrors shouldDownload() in download.mjs
function Get-PendingTrackCount {
    $tracks = Get-Content $TracksPath -Raw | ConvertFrom-Json -AsHashtable
    @($tracks | Where-Object {
        -not $_['audioUrl'] -and
        -not $_['skip'] -and
        -not $_['downloadError'] -and
        $_['subtype'] -notin $UnresolvedSubtypes
    }).Count
}

function Invoke-DownloadRun {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LogPath) | Out-Null
    Write-Log 'tick'

    Assert-RequiredTools
    # dotenv resolves .env relative to the working directory
    Set-Location $ScraperDir

    # --autostash so a half-finished previous run cannot wedge the rebase forever
    Invoke-Git pull --rebase --autostash --quiet | Out-Null

    $pendingCount = Get-PendingTrackCount
    if ($pendingCount -eq 0) {
        Write-Log 'nothing pending'
        return
    }
    Write-Log "$pendingCount tracks pending download"

    Update-YtDlp

    & node 'download.mjs' 2>&1 | ForEach-Object { Write-Log "  $_" }
    if ($LASTEXITCODE -ne 0) { throw "download.mjs exited $LASTEXITCODE" }

    Invoke-Git add -- $TracksPath | Out-Null
    & git diff --cached --quiet -- $TracksPath
    if ($LASTEXITCODE -eq 0) {
        Write-Log 'no tracks.json change to commit'
        return
    }

    $stamp = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
    Invoke-Git commit -m "Add audio $stamp" | Out-Null
    Invoke-Git push --quiet | Out-Null
    Write-Log 'committed and pushed tracks.json'
}

try {
    Invoke-DownloadRun
    Limit-LogSize
    exit 0
}
catch {
    Write-Log "FAILED: $_"
    Limit-LogSize
    exit 1
}
