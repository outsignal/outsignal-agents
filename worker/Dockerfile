FROM node:22-slim

# Install Chromium, VNC stack, and noVNC for browser streaming
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxkbcommon0 \
    libgbm1 \
    libasound2 \
    libx11-xcb1 \
    libxcomposite1 \
    libxrandr2 \
    libxdamage1 \
    libpango-1.0-0 \
    libcairo2 \
    libcups2 \
    dbus \
    xvfb \
    x11vnc \
    novnc \
    procps \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV CHROME_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc
RUN npm prune --production

# Expose the session server port (Railway assigns PORT dynamically)
EXPOSE 8080

CMD ["node", "dist/index.js"]
