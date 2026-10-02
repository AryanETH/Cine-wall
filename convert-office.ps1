param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [Parameter(Mandatory = $true)][string]$Extension
)

$ErrorActionPreference = 'Stop'
$extensionName = $Extension.ToLowerInvariant()
$application = $null
$document = $null

try {
  if ($extensionName -in @('.ppt', '.pptx', '.pps', '.ppsx', '.odp')) {
    $application = New-Object -ComObject PowerPoint.Application
    $document = $application.Presentations.Open($InputPath, -1, -1, 0)
    $document.SaveAs($OutputPath, 32)
  }
  elseif ($extensionName -in @('.doc', '.docx', '.rtf')) {
    $application = New-Object -ComObject Word.Application
    $application.Visible = $false
    $application.DisplayAlerts = 0
    $document = $application.Documents.Open($InputPath, $false, $true)
    $document.ExportAsFixedFormat($OutputPath, 17)
  }
  else {
    throw "Unsupported Office document type: $extensionName"
  }

  if (-not (Test-Path -LiteralPath $OutputPath)) {
    throw 'Microsoft Office did not create the PDF output.'
  }
}
finally {
  if ($null -ne $document) {
    try { $document.Close() } catch {}
    try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($document) } catch {}
  }
  if ($null -ne $application) {
    try { $application.Quit() } catch {}
    try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($application) } catch {}
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
