FROM node:24

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY artifacts ./artifacts
COPY lib ./lib
COPY scripts ./scripts

RUN npm install -g pnpm
RUN pnpm install --ignore-scripts
RUN pnpm rebuild esbuild
RUN pnpm install

ENV PORT=8080
ENV BASE_PATH=/
ENV NODE_ENV=production

RUN pnpm run build

ENV PORT=

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:8080/ || exit 1

CMD ["sh", "-c", "if [ -z \"$PORT\" ]; then export PORT=8080; fi; pnpm --filter @workspace/meme-factory run serve -- --port $PORT"]
