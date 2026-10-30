FROM node:26-slim
WORKDIR /watcher
COPY package.json .
# --ignore-scripts skips building raknet-native (bedrock-protocol's RakNet transport, which has no
# build for Node 26 here); the watcher only uses NetherNet, and bedrock-protocol loads it lazily.
RUN npm install --omit=dev --no-audit --no-fund --ignore-scripts
COPY watcher.ts .
CMD ["node", "watcher.ts"]
