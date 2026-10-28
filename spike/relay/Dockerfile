FROM node:22-slim
WORKDIR /app
COPY package.json .
RUN npm install --omit=dev --no-audit --no-fund
COPY relay.mjs .
CMD ["node", "relay.mjs"]
