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

# Install Playwright Chromium + all OS-level dependencies (libglib, libnss, libatk, etc.)
RUN npx playwright install chromium --with-deps

# Copy production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy compiled output from build stage
COPY --from=build /app/dist ./dist

ENV NODE_ENV=production
ENV PATH="/app/node_modules/.bin:$PATH"

EXPOSE 8080

CMD ["node", "dist/index.js"]
