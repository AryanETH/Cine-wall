# Start CineWall with advertising enabled
# Never place a password in this script or the command history.
$cinewallPrompted = [string]::IsNullOrWhiteSpace($env:CINEWALL_ADS_PASSWORD)
if ($cinewallPrompted) {
    $cinewallSecure = Read-Host "Ads dashboard PIN (six digits)" -AsSecureString
    $cinewallPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($cinewallSecure)
    try {
        $env:CINEWALL_ADS_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($cinewallPointer)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($cinewallPointer)
        $cinewallSecure.Dispose()
    }
}

# Optional: Set custom advertiser form URL
# $env:CINEWALL_ADS_FORM_URL = "https://forms.gle/your-form-id"

Write-Host "Starting CineWall with advertising enabled..." -ForegroundColor Green
Write-Host "Ads dashboard will be available at: http://localhost:4173/advt" -ForegroundColor Cyan
Write-Host ""

try {
    if ($env:CINEWALL_ADS_PASSWORD -notmatch '\A[0-9]{6}\z') {
        throw "Set CINEWALL_ADS_PASSWORD to a private six-digit PIN."
    }
    node (Join-Path $PSScriptRoot "server.js")
} finally {
    if ($cinewallPrompted) { Remove-Item Env:CINEWALL_ADS_PASSWORD -ErrorAction SilentlyContinue }
}
