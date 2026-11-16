$ErrorActionPreference = 'Stop'
$dist = Join-Path $PSScriptRoot 'dist'
$publish = Join-Path $dist 'win-x64'
$payload = Join-Path $dist 'CineWallPayload.zip'
$setup = Join-Path $dist 'CineWall Setup.exe'
$downloads = Join-Path $PSScriptRoot '..\public\downloads'
$logo = Join-Path $PSScriptRoot '..\public\assets\removed_background (24).png'
$framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$compiler = Join-Path $framework 'csc.exe'

dotnet publish (Join-Path $PSScriptRoot 'CineWall.csproj') -c Release -r win-x64 --self-contained false -o $publish
if ($LASTEXITCODE -ne 0) { throw 'CineWall publish failed.' }

$files = foreach ($name in @('CineWall.exe','CineWall.dll','CineWall.deps.json','CineWall.runtimeconfig.json')) {
    Join-Path $publish $name
}
Compress-Archive -LiteralPath $files -DestinationPath $payload -Force
& $compiler /nologo /target:winexe /platform:x64 "/out:$setup" "/resource:$payload,CineWallPayload" "/resource:$logo,CineWallLogo" /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll (Join-Path $PSScriptRoot 'LightTheme.cs') (Join-Path $PSScriptRoot 'installer\Setup.cs')
if ($LASTEXITCODE -ne 0) { throw 'CineWall setup compilation failed.' }
New-Item -ItemType Directory -Path $downloads -Force | Out-Null
Copy-Item -LiteralPath $setup -Destination (Join-Path $downloads 'CineWall-Setup.exe') -Force
Get-Item -LiteralPath (Join-Path $downloads 'CineWall-Setup.exe')
