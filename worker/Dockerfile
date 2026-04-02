# ---------- build stage ----------
FROM node:22-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# ---------- production stage ----------
FROM node:22-slim

# OS deps for Playwright Chromium (must be before playwright install)
RUN apt-get update && apt-get install -y \
    fonts-liberation libglib2.0-0 libnss3 libnspr4 libdbus-1-3 \
    libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
    libatspi2.0-0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libpango-1.0-0 libcairo2 libasound2 libx11-xcb1 \
    procps --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Install Chromium headless shell (what agent-browser uses with headless:true)
# Uses the playwright version from node_modules (installed by npm ci above)
RUN npx playwright install chromium-headless-shell \
    && rm -rf /tmp/* /var/tmp/*

# Copy compiled output from build stage
COPY --from=build /app/dist ./dist

ENV NODE_ENV=production
ENV PATH="/app/node_modules/.bin:$PATH"

EXPOSE 8080

CMD ["node", "dist/index.js"]
