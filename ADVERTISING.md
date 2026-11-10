# Advertising System

## Setup

The advertising dashboard is password-protected and requires configuration before use.

### Quick Start

1. **Set the password** using one of these methods:

   **Method A: PowerShell (One-time)**
   ```powershell
   $env:CINEWALL_ADS_PASSWORD="your-password"
   npm start
   ```

   **Method B: Use the startup script**
   ```powershell
   # Edit start-with-ads.ps1 and set your password
   .\start-with-ads.ps1
   ```

   **Method C: System Environment Variable (Persistent)**
   - Open System Properties → Environment Variables
   - Add new variable: `CINEWALL_ADS_PASSWORD` with your password value
   - Restart your terminal and run `npm start`

2. **Access the dashboard**
   - Navigate to: `http://localhost:4173/advt`
   - Login with your password

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CINEWALL_ADS_PASSWORD` | **Yes** | Password for accessing `/advt` dashboard |
| `CINEWALL_ADS_FORM_URL` | No | Custom Google Forms URL for advertisers (defaults to provided form) |

## Features

### Dashboard (`/advt`)
- Upload ad videos (MP4, H.264, AAC audio)
- Configure ad slots with formats:
  - **Skippable**: Up to 60s, skip button after 5s
  - **Standard**: Up to 15s, non-skippable
  - **Bumper**: Up to 6s, non-skippable
- Enable/disable advertising
- Set advertiser contact form URL

### Video Requirements
- Format: MP4 (H.264 video + AAC audio or no audio)
- Duration: 0.5 to 60 seconds
- Size: Maximum 25 MiB
- Color space: YUV420p or YUVJ420p

### Wall Display Integration
- Ad breaks play before video content starts
- Synchronized across all screens
- Displays skip button when available
- Shows progress: "Ad 1 of 2"
- Branded with CineWall logo

### Advertiser Portal (`/advertise`)
- Redirects to configured Google Forms URL
- Default contact form provided
- Customize with your own form URL

## API Endpoints

All API endpoints require authentication (login first):

- `POST /advt/api/login` - Login with password
- `POST /advt/api/logout` - Logout current session
- `GET /advt/api/settings` - Get current configuration
- `POST /advt/api/settings` - Update slots and enabled status
- `POST /advt/api/creative?title=Ad+Name` - Upload video (multipart/form-data)
- `DELETE /advt/api/creative/{id}` - Delete video
- `GET /advt/api/media/{id}` - Stream video file

## Security Features

- Password-protected admin access
- Session-based authentication (4-hour sessions)
- Rate limiting: 5 attempts per IP, 12 globally
- 15-minute lockout after failed attempts
- HTTPS-only cookies in production
- Same-origin policy for mutations
- No-index robots meta tag

## Troubleshooting

### "Advertising administration is disabled on this server"
**Cause**: `CINEWALL_ADS_PASSWORD` environment variable is not set.

**Solution**: Set the password using one of the methods above.

### "Video validation is unavailable on this server"
**Cause**: `ffprobe` is not installed or not in PATH.

**Solution**: 
- Install ffmpeg/ffprobe
- Or set `CINEWALL_FFPROBE` environment variable to full path

### "Too many attempts"
**Cause**: Too many failed login attempts.

**Solution**: Wait 15 minutes, then try again.

## File Storage

Ad videos are stored in:
```
.cinema-cache/advertising/
├── settings.json          # Configuration
├── {uuid}.mp4            # Ad video files
```

## Example Configuration

```javascript
{
  "enabled": true,
  "formUrl": "https://forms.gle/x32An3oiyoXfxjiT7",
  "creatives": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "title": "Summer Sale 2026",
      "duration": 15.5,
      "size": 2048576
    }
  ],
  "slots": [
    { "creativeId": "550e8400-e29b-41d4-a716-446655440000", "format": "standard" }
  ]
}
```

## Testing

Run the advertising test suite:
```bash
npm test
```

The test suite covers:
- Password authentication
- Session management
- Video upload and validation
- Slot configuration
- Campaign generation
- Security and rate limiting
