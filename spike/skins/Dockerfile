FROM node:26-slim
WORKDIR /spike
COPY package.json .
RUN npm install --omit=dev --no-audit --no-fund
COPY skins.ts .
# The relay's key and the spare account's sign-in token live here (a Docker volume, not the repo).
ENV PROXY_CACHE_DIR=/cache
CMD ["node", "skins.ts"]
