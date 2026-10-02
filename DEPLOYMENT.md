# CineWall Deployment Guide

## ⚠️ Important: Deployment Limitations

CineWall is designed as a **local network application** with features that require:
- Long-running Node.js server
- Server-Sent Events (SSE) for real-time sync
- File uploads and local file system access
- Persistent WebSocket-like connections
- Local network device discovery

**Vercel and most serverless platforms are NOT suitable** for this application because:
1. Serverless functions have execution time limits (10-60 seconds)
2. No persistent connections (SSE won't work reliably)
3. No local file system persistence
4. Can't maintain real-time sync across multiple devices

## ✅ Recommended Deployment Options

### Option 1: Local Network Only (Recommended)
**Best for: Home/Office use**
- Run `node server.js` on one computer
- Other devices connect via local IP address
- Perfect for the intended use case

### Option 2: VPS/Cloud Server with Node.js
**Best for: Remote access needed**

**Recommended Platforms:**
- **Railway.app** (Easy, affordable, Node.js native)
- **Render.com** (Free tier available)
- **DigitalOcean App Platform**
- **Heroku**
- **AWS EC2** or **Google Cloud Compute**

**Steps for Railway.app (Easiest):**
1. Go to https://railway.app
2. Sign in with GitHub
3. Click "New Project" → "Deploy from GitHub repo"
4. Select this repository
5. Railway will auto-detect Node.js and deploy
6. Get your deployment URL

**Steps for Render.com:**
1. Go to https://render.com
2. Sign in with GitHub
3. Click "New +" → "Web Service"
4. Connect this repository
5. Build Command: `npm install`
6. Start Command: `node server.js`
7. Deploy!

### Option 3: Docker Container
**Best for: Self-hosting with flexibility**

Create a `Dockerfile`:
```dockerfile
FROM node:18
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 4173
CMD ["node", "server.js"]
```

Deploy to:
- Docker Swarm
- Kubernetes
- Any cloud provider with container support

## 🚫 Not Recommended

- ❌ Vercel (Serverless, no persistent connections)
- ❌ Netlify Functions (Same limitations)
- ❌ AWS Lambda (Serverless, time limits)
- ❌ Cloudflare Workers (No Node.js runtime, no SSE)

## Environment Variables

When deploying to a cloud platform, set:
- `PORT` - The port number (usually auto-set by platform)
- `HOST` - Set to `0.0.0.0` for cloud deployment

## Notes

- File uploads are stored in `.cinema-cache/` directory
- Make sure the platform supports persistent storage or use cloud storage
- SSE (Server-Sent Events) requires platforms that support long-lived HTTP connections
- The application is optimized for **local network use** where all devices are on the same WiFi

## Quick Fix for Vercel

If you must use Vercel (not recommended), you would need to:
1. Replace SSE with polling
2. Replace file uploads with cloud storage (S3, etc.)
3. Use a database for state management
4. Rebuild as a true serverless application

This would require significant refactoring and is not the intended use case.
