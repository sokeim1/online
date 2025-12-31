FROM node:20-bookworm

ENV NODE_ENV=production

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ffmpeg ca-certificates curl; \
    rm -rf /var/lib/apt/lists/*; \
    curl -L "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp" -o /usr/local/bin/yt-dlp; \
    chmod a+rx /usr/local/bin/yt-dlp; \
    yt-dlp --version

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 5173

CMD ["node", "server.js"]
