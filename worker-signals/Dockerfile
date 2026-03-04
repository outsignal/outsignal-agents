FROM node:22-slim

WORKDIR /app

# Copy Prisma schema from main project (needed for prisma generate)
COPY prisma ./prisma

COPY worker-signals/package.json worker-signals/package-lock.json* ./
RUN npm install

COPY worker-signals/tsconfig.json ./
COPY worker-signals/src ./src
RUN npx prisma generate
RUN npx tsc
RUN npm prune --production

CMD ["node", "dist/index.js"]
