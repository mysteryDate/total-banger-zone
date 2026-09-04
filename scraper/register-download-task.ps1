#Requires -Version 7
<#
Registers the Windows scheduled task that runs download-cron.ps1.
Re-run to update the task in place. Run as your normal user, not elevated.

  ./register-download-task.ps1                    # runs only while logged in
  ./register-download-task.ps1 -RunWhenLoggedOut  # prompts for your Windows password

-RunWhenLoggedOut stores the password with the task so it gets a full logon session.
That is what keeps git push able to decrypt the GitHub token in Credential Manager;
the passwordless "run whether logged on or not" mode cannot, and push would hang.

RE-RUN THIS AFTER EVERY WINDOWS PASSWORD CHANGE. The task keeps the old password and
stops starting, and because it never starts it cannot write to its own log.
#>

[CmdletBinding()]
param([switch]$RunWhenLoggedOut)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TaskName = 'TotalBangerZone-DownloadAudio'
$RunIntervalMinutes = 15
$MaxRunHours = 2
$StartProbeTimeoutSeconds = 30

# Store-packaged pwsh under WindowsApps will not launch from a batch logon, so prefer
# a plain filesystem install. Grab one with:
#   Expand-Archive PowerShell-<ver>-win-x64.zip -DestinationPath $env:LOCALAPPDATA\Programs\PowerShell\7
function Resolve-PwshPath {
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\PowerShell\7\pwsh.exe')
        (Join-Path $env:ProgramFiles 'PowerShell\7\pwsh.exe')
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) { return $candidate }
    }
    $onPath = (Get-Command pwsh -ErrorAction SilentlyContinue)?.Source
    if (-not $onPath) { throw 'pwsh (PowerShell 7) not found' }
    if ($onPath -like '*\WindowsApps\*') {
        throw "Only the Store build of pwsh was found ($onPath). It cannot launch from a scheduled task. Install the zip build to $($candidates[0])"
    }
    $onPath
}

$cronScript = Join-Path $PSScriptRoot 'download-cron.ps1'
if (-not (Test-Path $cronScript)) { throw "Missing $cronScript" }

$pwshPath = Resolve-PwshPath

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

# Prove the task can actually start. A rejected password fails here rather than
# silently months later, since a task that never starts writes no log of its own.
$AccessDenied = 0xC0070005
Start-ScheduledTask -TaskName $TaskName
$deadline = (Get-Date).AddSeconds($StartProbeTimeoutSeconds)
while ((Get-ScheduledTask -TaskName $TaskName).State -eq 'Running' -and (Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
}
$result = (Get-ScheduledTaskInfo -TaskName $TaskName).LastTaskResult
if ($result -eq $AccessDenied) {
    throw "Task registered but will not start (0x{0:X8}, access denied). The password was rejected. Re-run and enter your current Windows password." -f $result
}

$mode = if ($RunWhenLoggedOut) { 'logged in or out, no window' } else { 'while logged in only' }
Write-Host "Registered '$TaskName', every $RunIntervalMinutes min and at logon ($mode)."
Write-Host "pwsh:     $pwshPath"
Write-Host "Probe run exited 0x$('{0:X8}' -f $result)."
Write-Host "Log:      $env:LOCALAPPDATA\total-banger-zone\download-cron.log"
