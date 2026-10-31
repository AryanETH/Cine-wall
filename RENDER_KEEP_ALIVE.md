# Keep Your Render Service Alive (Free Tier)

Render's free tier puts services to sleep after 15 minutes of inactivity. Use these methods to keep your app awake 24/7.

## Health Endpoint

Your app has a lightweight health endpoint at:
```
https://cine-wall.onrender.com/health
```
Response: `OK` (2 bytes)

## Keep-Alive Methods

### Method 1: Cron-Job.org (Recommended)

**Free external monitoring service**

1. Go to [https://cron-job.org](https://cron-job.org)
2. Create a free account
3. Click "CREATE CRONJOB"
4. Configure:
   - **Title**: Keep CineWall Alive
   - **URL**: `https://cine-wall.onrender.com/health`
   - **Schedule**: Every 14 minutes (`*/14 * * * *`)
5. Click "CREATE" and make sure it's active

### Method 2: UptimeRobot

**Alternative monitoring service**

1. Go to [https://uptimerobot.com](https://uptimerobot.com)
2. Create free account
3. Click "Add New Monitor"
4. Configure:
   - **Monitor Type**: HTTP(s)
   - **Friendly Name**: Render CineWall
   - **URL**: `https://cine-wall.onrender.com/health`
   - **Monitoring Interval**: 5 minutes
5. Create monitor

### Method 3: Google Apps Script

**Uses your Google account**

1. Go to [https://script.google.com](https://script.google.com)
2. New Project
3. Paste this code:

```javascript
function pingRenderService() {
  try {
    UrlFetchApp.fetch("https://cine-wall.onrender.com/health");
    Logger.log("Ping successful: " + new Date());
  } catch (error) {
    Logger.log("Ping failed: " + error);
  }
}
```

4. Save (name it "Render Keep-Alive")
5. Click clock icon ⏰ (Triggers)
6. Add Trigger:
   - Function: `pingRenderService`
   - Event source: Time-driven
   - Type: Minutes timer
   - Interval: Every 10 minutes
7. Save

## Important Notes

- **Free tier**: 750 hours/month = 31 days continuous runtime
- **Keep ONE service awake** per free workspace
- **Ping frequency**: Every 10-14 minutes optimal
- **Bandwidth**: `/health` uses ~6 KB/month (negligible)

## Verification

Check if it's working:
- **Cron-Job.org**: View execution history (green checkmarks)
- **UptimeRobot**: Uptime should be 99-100%
- **Google Script**: View → Execution history
- **Render**: Service stays "Live", no cold starts

## Troubleshooting

**Service still sleeping?**
- Verify ping URL is correct
- Check ping interval is < 15 minutes
- Ensure monitor is active
- Check Render logs for incoming requests

Your app will stay awake 24/7! 🚀
