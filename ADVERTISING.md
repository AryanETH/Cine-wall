# Advertising System

## Setup

The advertising dashboard is password-protected and requires configuration before use.

### Quick Start

1. **Set the password** using one of these methods:

   **Method A: Use npm script (Easiest)**
   ```bash
   npm run start:ads
   ```
   This automatically starts with password: **9669**

   **Method B: PowerShell (One-time)**
   ```powershell
   $env:CINEWALL_ADS_PASSWORD="9669"
   npm start
   ```

   **Method C: Use the startup script**
   ```powershell
   .\start-with-ads.ps1
   ```

   **Method D: System Environment Variable (Persistent)**
   - Open System Properties → Environment Variables
   - Add new variable: `CINEWALL_ADS_PASSWORD` with value `9669`
   - Restart your terminal and run `npm start`

2. **Access the dashboard**
   - Navigate to: `http://localhost:4173/advt`
   - Login with password: **9669** (or your custom password)

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CINEWALL_ADS_PASSWORD` | **Yes** | Password for accessing `/advt` dashboard |
| `CINEWALL_ADS_FORM_URL` | No | Custom Google Forms URL for advertisers (defaults to provided form) |

## Features

### Dashboard (`/advt`)
- Upload ad videos (MP4, H.264, AAC audio)
- Trim clips using 6s, 15s, 30s, and 60s presets or an adjustable start and length. The original upload is retained for future edits.
- Upload a PNG, JPEG, or WebP logo up to 2 MiB. It appears in the top-right corner while an ad plays.
- Configure ad slots with formats:
  - **Skippable**: Up to 60s, skip button after 5s
  - **Standard**: Up to 15s, non-skippable
  - **Bumper**: Up to 6s, non-skippable
- Enable/disable advertising
- Choose the slots and click **Push ad**. **Ads live** shows the published videos and push time. Pause ads to stop upcoming breaks. Edits to the clips, logo, or advertiser links take effect on the next push.
- Add an advertiser website to each video to show a **Visit advertiser** link during playback.
- Set advertiser contact form URL

### Analytics

The dashboard reports impressions, advertiser clicks, CTR, playback milestones, skips, and failures by video. One synchronized ad break counts once across the wall. Impressions and playback milestones come from visible players, so a scheduled ad can be served without receiving an impression. Reports use UTC and retain up to 90 days of aggregate counts in the advertising storage directory.

### Video Requirements
- Format: MP4 (H.264 video + AAC audio or no audio)
- Source duration: 0.5 to 300 seconds; trim to the slot's limit before assigning it
- Size: Maximum 25 MiB
- Color space: YUV420p or YUVJ420p

### Wall Display Integration
| Movie duration | Ads | Positions |
| --- | --- | --- |
| Under 1 minute | 0 | — |
| 1 minute to under 10 minutes | 1 | Halfway |
| 10 minutes to under 50 minutes | 2 | One-third and two-thirds |
| 50 minutes or longer | 3 | One-quarter, halfway, and three-quarters |

Yellow dots mark the breaks on the movie timeline. During each break, a yellow line tracks the ad's progress across the selected screens. Skippable ads can be skipped after five seconds. CineWall cycles through the saved slots, so one configured ad can play at all three breaks.

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
- `POST /advt/api/creative?title=Ad+Name` - Upload raw MP4 bytes
- `POST /advt/api/creative/{id}/trim` - Save the selected start time and duration
- `POST /advt/api/logo` / `DELETE /advt/api/logo` - Upload or remove the company logo
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

**Solution**: Locally, set the password using one of the methods above. For the live site, set the private variable in the hosting service's environment and deploy. The Windows startup script only sets it for your local process.

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
