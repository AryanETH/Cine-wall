FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv ca-certificates \
    && python3 -m venv /opt/download-tools \
    && /opt/download-tools/bin/pip install --no-cache-dir 'yt-dlp[default]' \
    && rm -rf /var/lib/apt/lists/*
ENV PATH="/opt/download-tools/bin:${PATH}" CINEWALL_HOSTED=1 CINEWALL_CACHE_DIR=/tmp/cinewall-cache
WORKDIR /app
COPY . .
CMD ["node", "server.js"]
