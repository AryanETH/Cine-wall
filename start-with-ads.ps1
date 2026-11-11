# Start CineWall with advertising enabled
# Set your advertising dashboard password here
if (-not $env:CINEWALL_ADS_PASSWORD) { $env:CINEWALL_ADS_PASSWORD = "9669" }

# Optional: Set custom advertiser form URL
# $env:CINEWALL_ADS_FORM_URL = "https://forms.gle/your-form-id"

Write-Host "Starting CineWall with advertising enabled..." -ForegroundColor Green
Write-Host "Ads dashboard will be available at: http://localhost:4173/advt" -ForegroundColor Cyan
Write-Host ""

node server.js
