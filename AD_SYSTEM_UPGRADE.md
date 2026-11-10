# Advanced Advertising System - Implementation Guide

## New Features

### 1. Video Trimming
- Trim uploaded ads to exact durations: 6s, 15s, 30s, 60s
- Uses ffmpeg for precise trimming
- Adjustable start point with visual slider

### 2. Logo Upload & Overlay
- Upload company logo (PNG with transparency recommended)
- Logo appears in corner during ad playback
- Configurable size and position

### 3. YouTube-Style Progress Bar
- Yellow progress line moves during ad playback
- Shows current position in ad
- Smooth animation synchronized with video

### 4. Timeline Markers
- Yellow dots on video timeline showing ad positions
- Appears before playback starts
- Hover shows "Ad break" tooltip

### 5. Smart Ad Placement Rules

#### Duration-Based Ad Count
- **< 1 minute**: No ads
- **1-10 minutes**: 1 ad (pre-roll only)
- **10-50 minutes**: 2 ads (pre-roll + mid-roll)
- **50min - 3hours+**: 3 ads (pre-roll + 2 mid-rolls)

#### Ad Positioning
- Ads distributed evenly throughout video
- Formula: `position = (video_duration / (ad_count + 1)) * ad_number`
- Example for 60min video with 3 ads:
  - Ad 1: 0:00 (start)
  - Ad 2: 15:00 (25%)
  - Ad 3: 30:00 (50%)
  - Ad 4: 45:00 (75%)

#### Slot Reuse
- If only 1 ad slot configured, same ad plays multiple times
- Each playthrough gets fresh progress bar and timing

## Technical Implementation

### Backend Changes

#### `advertising.js`
- Add trim functionality with ffmpeg
- Add logo upload/storage
- Update creative schema to include trim settings and logo

#### `server.js`  
- Calculate ad break positions based on video duration
- Support mid-roll ad triggering
- Track which ad breaks have been shown
- Add timeline marker data to state snapshot

### Frontend Changes

#### `advt/dashboard.html` & `public/ads-admin.js`
- Add trim UI with duration presets and custom range
- Add logo upload form
- Preview trim results
- Show logo in preview

#### `public/wall-ads.js` & `public/wall-ads.css`
- Add yellow progress bar overlay
- Animate progress based on ad position
- Display logo in corner
- Smooth transitions

#### Player Integration
- Add yellow dot markers to timeline
- Calculate marker positions from ad break data
- Show/hide markers based on playback state
- Handle clicks on markers (seek to ad position)

## Data Structures

### Creative Object (Enhanced)
```json
{
  "id": "uuid",
  "title": "Summer Sale 2026",
  "description": "Limited time offer",
  "duration": 15.0,
  "originalDuration": 30.0,
  "trimStart": 5.0,
  "trimEnd": 20.0,
  "size": 2048576,
  "logo": "logo-uuid.png"
}
```

### Ad Break Positions
```json
{
  "adBreaks": [
    { "position": 0, "shown": false },
    { "position": 900, "shown": false },
    { "position": 1800, "shown": false }
  ]
}
```

### State with Ad Data
```json
{
  "asset": {...},
  "adBreaks": [...],
  "nextAdBreak": 0,
  "adProgress": { "current": 5.2, "total": 15.0 }
}
```

## Configuration

### Environment Variables
- `CINEWALL_FFMPEG`: Path to ffmpeg (default: auto-detect)
- `CINEWALL_FFPROBE`: Path to ffprobe (default: auto-detect)

### Limits
- Logo max size: 2 MB
- Logo formats: PNG, JPG, WebP
- Trim precision: 0.1 second
- Maximum ads per video: 10

## User Flow

### Admin Workflow
1. Upload video ad
2. (Optional) Trim to desired length using presets or custom range
3. (Optional) Upload logo
4. Configure slot with format
5. Enable advertising
6. Save settings

### Viewer Experience
1. User selects movie
2. Timeline shows yellow dots at ad positions
3. Pre-roll ad plays with:
   - Yellow progress bar at bottom
   - Logo in top-right corner
   - Skip button (if applicable)
4. Movie starts
5. At mid-roll positions, ad breaks trigger
6. Process repeats for each ad break
7. Movie resumes after each ad

## Implementation Priority

1. ✅ Add description field (DONE)
2. ✅ X buttons for slots (DONE)
3. ✅ Accept any contact URL (DONE)
4. ⬜ Video trimming with ffmpeg
5. ⬜ Logo upload and storage
6. ⬜ Calculate ad break positions
7. ⬜ Timeline markers UI
8. ⬜ Progress bar during ads
9. ⬜ Logo display during playback
10. ⬜ Mid-roll ad triggering
11. ⬜ State management for ad breaks

## Testing Checklist

- [ ] Trim video to each preset duration
- [ ] Upload and display logo
- [ ] Verify ad positions for different video lengths
- [ ] Test single slot reused multiple times
- [ ] Progress bar animates smoothly
- [ ] Timeline markers appear correctly
- [ ] Mid-roll ads trigger at right time
- [ ] Skip button works during mid-roll
- [ ] Logo scales properly on different screens
- [ ] Multiple ad formats in same campaign

