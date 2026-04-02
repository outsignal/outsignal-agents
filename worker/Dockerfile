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

# Copy production dependencies first (so playwright install uses the correct version)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Install Playwright browsers matching agent-browser's playwright-core version
# Use --with-deps to get OS-level libs (libglib, libnss, libatk, etc.)
RUN npx playwright install --with-deps

# Copy compiled output from build stage
COPY --from=build /app/dist ./dist

ENV NODE_ENV=production
ENV PATH="/app/node_modules/.bin:$PATH"

EXPOSE 8080

CMD ["node", "dist/index.js"]
