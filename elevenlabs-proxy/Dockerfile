FROM node:22-alpine

WORKDIR /app
COPY package.json ./
COPY server.mjs generate-demos.mjs voice-demo.json ./

ENV PORT=3099
ENV NODE_OPTIONS=--dns-result-order=ipv4first
EXPOSE 3099

HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3099/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
