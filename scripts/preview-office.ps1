param(
  [string]$InputPath,
  [string]$OutputPath,
  [Parameter(Mandatory=$true)][string]$ProcessMarker,
  [switch]$Cleanup
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

if ($Cleanup) {
  if (Test-Path -LiteralPath $ProcessMarker) {
    $marker = Get-Content -LiteralPath $ProcessMarker -Raw | ConvertFrom-Json
    if ($marker.owned -eq $true -and $marker.pid -gt 0) {
      $process = Get-Process -Id $marker.pid -ErrorAction SilentlyContinue
      if ($process -and $process.ProcessName -eq 'POWERPNT' -and $process.StartTime.ToUniversalTime().Ticks.ToString() -eq $marker.started -and $process.MainWindowHandle -eq 0) {
        Stop-Process -Id $process.Id
      }
    }
  }
  exit 0
}

if ([IO.Path]::GetExtension($InputPath) -ine '.pptx') {
  Write-Output '{"errorCode":"unsupported"}'
  exit 1
}

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class OfficePreviewWindow {
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
}
'@

$before = @(Get-Process POWERPNT -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
$application = $null
$presentation = $null
$owned = $false
$security = $null
$alerts = $null
$failure = $null

try {
  try { $application = New-Object -ComObject PowerPoint.Application }
  catch { $failure = 'unavailable'; throw }
  [uint32]$officePid = 0
  [void][OfficePreviewWindow]::GetWindowThreadProcessId([IntPtr]$application.HWND, [ref]$officePid)
  $owned = $officePid -gt 0 -and $before -notcontains [int]$officePid
  $process = Get-Process -Id $officePid
  @{pid=$officePid;owned=$owned;started=$process.StartTime.ToUniversalTime().Ticks.ToString()} | ConvertTo-Json -Compress | Set-Content -LiteralPath $ProcessMarker -Encoding UTF8
  $security = $application.AutomationSecurity
  $alerts = $application.DisplayAlerts
  $application.AutomationSecurity = 3
  $application.DisplayAlerts = 1
  # Read-only and WithWindow=false preserve the local source and keep the presentation hidden.
  $presentation = $application.Presentations.Open($InputPath, -1, 0, 0)
  $presentation.SaveAs($OutputPath, 32)
  Write-Output '{"ok":true}'
} catch {
  if (-not $failure) { $failure = 'conversion-failed' }
} finally {
  if ($presentation) {
    try { $presentation.Saved = -1; $presentation.Close() } catch {}
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation)
  }
  if ($application) {
    try {
      if ($null -ne $security) { $application.AutomationSecurity = $security }
      if ($null -ne $alerts) { $application.DisplayAlerts = $alerts }
      # PowerPoint can reuse a user's instance; only quit a new instance with no documents.
      if ($owned -and $application.Presentations.Count -eq 0) { $application.Quit() }
    } catch {}
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($application)
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}

if ($failure) {
  Write-Output (@{errorCode=$failure} | ConvertTo-Json -Compress)
  exit 1
}
