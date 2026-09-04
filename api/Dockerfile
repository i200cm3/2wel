FROM node:22-alpine

RUN apk add --no-cache ffmpeg docker-cli openssl util-linux font-noto fontconfig

WORKDIR /app
COPY api/package.json api/package-lock.json ./
RUN npm ci --omit=dev
ARG API_CACHEBUST=1
COPY api/ ./
COPY prompts/ ./prompts/

ENV PORT=3000
EXPOSE 3000

CMD ["node", "--import", "tsx", "start.ts"]
