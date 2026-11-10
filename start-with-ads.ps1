# Start CineWall with advertising enabled
# Set your advertising dashboard password here
$env:CINEWALL_ADS_PASSWORD = "admin123"

# Optional: Set custom advertiser form URL
# $env:CINEWALL_ADS_FORM_URL = "https://forms.gle/your-form-id"

Write-Host "Starting CineWall with advertising enabled..." -ForegroundColor Green
Write-Host "Ads dashboard will be available at: http://localhost:4173/advt" -ForegroundColor Cyan
Write-Host "Dashboard password: $env:CINEWALL_ADS_PASSWORD" -ForegroundColor Yellow
Write-Host ""

node server.js
