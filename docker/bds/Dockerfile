# syntax=docker/dockerfile:1

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
