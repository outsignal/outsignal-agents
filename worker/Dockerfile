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

# Install Playwright Chromium matching the version agent-browser depends on
RUN npx playwright install chromium --with-deps

# Copy compiled output from build stage
COPY --from=build /app/dist ./dist

ENV NODE_ENV=production
ENV PATH="/app/node_modules/.bin:$PATH"

EXPOSE 8080

CMD ["node", "dist/index.js"]
