FROM node:26-slim
WORKDIR /spike
COPY package.json .
# --ignore-scripts skips building raknet-native (bedrock-protocol's RakNet transport, which has no
# build for Node 26 here); the spikes only use NetherNet, and bedrock-protocol loads it lazily.
RUN npm install --omit=dev --no-audit --no-fund --ignore-scripts
COPY *.ts ./
# The relay's key and the spare account's sign-in token live here (a Docker volume, not the repo).
ENV PROXY_CACHE_DIR=/cache
CMD ["node", "skins.ts"]
