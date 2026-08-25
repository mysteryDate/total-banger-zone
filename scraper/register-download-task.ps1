#Requires -Version 7
<#
Registers the Windows scheduled task that runs download-cron.ps1.
Re-run to update the task in place. Run as your normal user, not elevated.

  ./register-download-task.ps1                    # runs only while logged in
  ./register-download-task.ps1 -RunWhenLoggedOut  # prompts for your Windows password

-RunWhenLoggedOut stores the password with the task so it gets a full logon session.
That is what keeps git push able to decrypt the GitHub token in Credential Manager;
the passwordless "run whether logged on or not" mode cannot, and push would hang.
#>

[CmdletBinding()]
param([switch]$RunWhenLoggedOut)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TaskName = 'TotalBangerZone-DownloadAudio'
$RunIntervalMinutes = 15
$MaxRunHours = 2

$cronScript = Join-Path $PSScriptRoot 'download-cron.ps1'
if (-not (Test-Path $cronScript)) { throw "Missing $cronScript" }

$pwshPath = (Get-Command pwsh -ErrorAction SilentlyContinue)?.Source
if (-not $pwshPath) { throw 'pwsh (PowerShell 7) not found on PATH' }

$action = New-ScheduledTaskAction -Execute $pwshPath `
    -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$cronScript`""

$repeatingTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes $RunIntervalMinutes)
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

$settings = New-ScheduledTaskSettingsSet `
    -MultipleInstances IgnoreNew `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -RunOnlyIfNetworkAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours $MaxRunHours)

$account = "$env:USERDOMAIN\$env:USERNAME"
$register = @{
    TaskName    = $TaskName
    Action      = $action
    Trigger     = @($repeatingTrigger, $logonTrigger)
    Settings    = $settings
    Description = 'Downloads audio for new Total Banger Zone tracks, uploads to R2, commits tracks.json.'
    Force       = $true
}

if ($RunWhenLoggedOut) {
    $credential = Get-Credential -UserName $account -Message 'Windows password for the scheduled task'
    $register.User = $account
    $register.Password = $credential.GetNetworkCredential().Password
    $register.RunLevel = 'Limited'
}
else {
    $register.Principal = New-ScheduledTaskPrincipal -UserId $account `
        -LogonType Interactive -RunLevel Limited
}

Register-ScheduledTask @register | Out-Null

$mode = if ($RunWhenLoggedOut) { 'logged in or out, no window' } else { 'while logged in only' }
Write-Host "Registered '$TaskName', every $RunIntervalMinutes min and at logon ($mode)."
Write-Host "Run now:  Start-ScheduledTask -TaskName $TaskName"
Write-Host "Log:      $env:LOCALAPPDATA\total-banger-zone\download-cron.log"
