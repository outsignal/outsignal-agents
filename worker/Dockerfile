FROM node:22-slim

# agent-browser uses playwright-core which needs these browser dependencies.
# No VNC/Xvfb needed — agent-browser manages its own headless Chromium.
RUN apt-get update && apt-get install -y \
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
    procps \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Install agent-browser CLI globally and its bundled browser
RUN npm install -g agent-browser && agent-browser install

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
