# syntax=docker/dockerfile:1
# One Dockerfile, two images:
#   --target server        minecade/bds:local         the lobby and every game server
#   --target orchestrator  minecade/orchestrator:local

# ---------------------------------------------------------------------------
# build: compiles the packs and templates (dist/templates), the registry and
# the orchestrator bundle.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/minigame-core/package.json packages/minigame-core/
COPY orchestrator/package.json orchestrator/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---------------------------------------------------------------------------
# bds: Ubuntu + official Bedrock Dedicated Server. Cached independently of the
# TypeScript build so code changes never re-download BDS.
# ---------------------------------------------------------------------------
FROM ubuntu:24.04 AS bds

ARG EULA
ARG BDS_VERSION=1.26.60.6

RUN if [ "$EULA" != "TRUE" ]; then \
      echo "ERROR: set EULA=TRUE in network/.env to accept the Minecraft EULA (https://www.minecraft.net/eula)." >&2; \
      exit 1; \
    fi

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl unzip jq libcurl4 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /bds

RUN curl -fsSL --retry 3 \
      -A "Mozilla/5.0 (X11; Linux x86_64) minecade-bds-builder" \
      -o /tmp/bds.zip \
      "https://www.minecraft.net/bedrockdedicatedserver/bin-linux/bedrock-server-${BDS_VERSION}.zip" \
 && unzip -q /tmp/bds.zip -d /bds \
 && rm /tmp/bds.zip \
 && chmod +x /bds/bedrock_server \
 && echo "${BDS_VERSION}" > /bds/.bds-version

ENV LD_LIBRARY_PATH=/bds

# ---------------------------------------------------------------------------
# server: BDS + the built templates + the entrypoint that picks GAME and MAP.
# ---------------------------------------------------------------------------
FROM bds AS server
COPY --from=build /src/dist/templates /templates
COPY docker/bds/entrypoint.sh /usr/local/bin/minecade-entrypoint
RUN chmod +x /usr/local/bin/minecade-entrypoint
ENTRYPOINT ["/usr/local/bin/minecade-entrypoint"]

# ---------------------------------------------------------------------------
# orchestrator: Node + the bundled orchestrator and the game registry.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS orchestrator
WORKDIR /app
COPY --from=build /src/dist/orchestrator/index.cjs ./index.cjs
COPY --from=build /src/dist/registry.json ./registry.json
ENV REGISTRY_PATH=/app/registry.json
# node:sqlite (player stats) is stable enough for us but still prints an experimental warning.
CMD ["node", "--disable-warning=ExperimentalWarning", "index.cjs"]
