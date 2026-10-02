param([string]$BaseUrl = 'http://localhost:4199')
$ErrorActionPreference = 'Stop'
function Post-Json($route, $data) {
    Invoke-RestMethod -Method Post -Uri "$BaseUrl$route" -ContentType 'application/json' -Body ($data | ConvertTo-Json)
}
function Wait-Download($job) {
    $deadline = (Get-Date).AddMinutes(4)
    $lastState = ''
    do {
        Start-Sleep -Seconds 2
        $job = Invoke-RestMethod "$BaseUrl/api/youtube/downloads/$($job.id)"
        if ($job.state -ne $lastState) { Write-Host "$($job.container): $($job.state)"; $lastState = $job.state }
        if ((Get-Date) -gt $deadline) { Post-Json "/api/youtube/downloads/$($job.id)/cancel" @{} | Out-Null; throw 'Integration download timed out' }
    } while ($job.state -in @('downloading', 'converting'))
    if ($job.state -ne 'ready') { throw $job.error }
    $head = Invoke-WebRequest -Method Head -Uri "$BaseUrl$($job.downloadUrl)" -UseBasicParsing
    if ([long]$head.Headers['Content-Length'] -le 0) { throw 'Download file is empty' }
    Write-Host "$($job.container): file ready, $($head.Headers['Content-Length']) bytes"
    return $job
}
$capabilities = Invoke-RestMethod "$BaseUrl/api/youtube/tools"
if (-not $capabilities.ready) { throw 'Download tools are unavailable' }
# Blender's freely licensed Big Buck Bunny is also an official yt-dlp fixture.
$info = Post-Json '/api/youtube/formats' @{ url = 'https://www.youtube.com/watch?v=YE7VzlLtp-4' }
Write-Host "Formats found: $($info.formats.Count) for $($info.title)"
$mp4 = $info.formats | Where-Object { $_.container -eq 'mp4' } | Sort-Object height | Select-Object -First 1
$mp3 = $info.formats | Where-Object { $_.container -eq 'mp3' -and $_.bitrate -eq 128 } | Select-Object -First 1
$videoJob = Wait-Download (Post-Json '/api/youtube/downloads' @{ inspectionId = $info.id; optionId = $mp4.id })
$audioJob = Wait-Download (Post-Json '/api/youtube/downloads' @{ inspectionId = $info.id; optionId = $mp3.id })
$loaded = Post-Json "/api/youtube/downloads/$($videoJob.id)/load" @{}
if ($loaded.state.asset.type -ne 'video/mp4') { throw 'Wall did not receive MP4' }
$request = [System.Net.HttpWebRequest]::Create("$BaseUrl/api/media/stream")
$request.AddRange(0, 1023)
$range = $request.GetResponse()
try { if ([int]$range.StatusCode -ne 206 -or $range.ContentLength -ne 1024) { throw 'Wall video range streaming failed' } }
finally { $range.Close() }
Write-Host 'MP4 download, MP3 conversion, wall loading, and range streaming passed.'
