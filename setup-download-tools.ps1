param([switch]$Update, [ValidateSet('stable', 'nightly')][string]$Channel = 'stable')
$ErrorActionPreference = 'Stop'
$toolsPath = Join-Path $PSScriptRoot 'tools'
$installPath = Join-Path $toolsPath 'install-cache'
New-Item -ItemType Directory -Path $toolsPath, $installPath -Force | Out-Null

function Get-VerifiedDownload($url, $checksumUrl, $name, $destination) {
    Write-Host "Downloading $name from its official release..."
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $destination
    $checksums = (Invoke-WebRequest -UseBasicParsing -Uri $checksumUrl).Content
    if ($checksums -is [byte[]]) { $checksums = [System.Text.Encoding]::UTF8.GetString($checksums) }
    $line = ($checksums -split "`n" | Where-Object { $_.Trim() -match ([regex]::Escape($name) + '$') } | Select-Object -First 1)
    if (-not $line) { throw "Official checksum not found for $name" }
    $expected = ($line.Trim() -split '\s+')[0].ToLowerInvariant()
    $actual = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) { throw "Checksum verification failed for $name" }
}

$ytPath = Join-Path $toolsPath 'yt-dlp.exe'
if ($Update -or -not (Test-Path -LiteralPath $ytPath) -or -not (Test-Path -LiteralPath (Join-Path $toolsPath 'download-tools-ready.txt'))) {
    $releaseRepository = if ($Channel -eq 'nightly') { 'yt-dlp/yt-dlp-nightly-builds' } else { 'yt-dlp/yt-dlp' }
    $stagedYtPath = Join-Path $installPath 'yt-dlp.exe'
    Get-VerifiedDownload "https://github.com/$releaseRepository/releases/latest/download/yt-dlp.exe" "https://github.com/$releaseRepository/releases/latest/download/SHA2-256SUMS" 'yt-dlp.exe' $stagedYtPath
    Copy-Item -LiteralPath $stagedYtPath -Destination $ytPath -Force
}
if (-not (Test-Path -LiteralPath (Join-Path $toolsPath 'ffmpeg.exe'))) {
    $archiveName = 'ffmpeg-master-latest-win64-gpl-shared.zip'
    $archivePath = Join-Path $installPath $archiveName
    Get-VerifiedDownload "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/$archiveName" 'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/checksums.sha256' $archiveName $archivePath
    Expand-Archive -LiteralPath $archivePath -DestinationPath $installPath -Force
    $ffmpegFile = Get-ChildItem -LiteralPath $installPath -Recurse -File -Filter 'ffmpeg.exe' | Select-Object -First 1
    if (-not $ffmpegFile) { throw 'FFmpeg executable was not found in the official archive' }
    Get-ChildItem -LiteralPath $ffmpegFile.Directory.FullName -File | Copy-Item -Destination $toolsPath -Force
    $licenseFile = Get-ChildItem -LiteralPath $installPath -Recurse -File | Where-Object { $_.Name -match '^(LICENSE|COPYING)' } | Select-Object -First 1
    if ($licenseFile) { Copy-Item -LiteralPath $licenseFile.FullName -Destination (Join-Path $toolsPath 'FFMPEG-LICENSE.txt') -Force }
}
& $ytPath --version
& (Join-Path $toolsPath 'ffmpeg.exe') -version | Select-Object -First 1
Write-Host 'CineWall download tools are ready. Restart CineWall if it is running.'
'Official release checksums verified' | Set-Content -LiteralPath (Join-Path $toolsPath 'download-tools-ready.txt')
