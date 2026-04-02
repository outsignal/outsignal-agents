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

WORKDIR /app

# Production dependencies first — playwright install must use the version
# that agent-browser depends on (playwright-core 1.58.x)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Install Chromium + headless shell + OS-level deps (libglib, libnss, libatk, etc.)
# Must run AFTER npm ci so npx resolves the correct playwright version.
# agent-browser uses headless:true which needs chromium-headless-shell (separate from chromium).
RUN npx playwright install chromium chromium-headless-shell --with-deps \
    && rm -rf /tmp/* /var/tmp/*

# Copy compiled output from build stage
COPY --from=build /app/dist ./dist

ENV NODE_ENV=production
ENV PATH="/app/node_modules/.bin:$PATH"

EXPOSE 8080

CMD ["node", "dist/index.js"]
