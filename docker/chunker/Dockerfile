# syntax=docker/dockerfile:1
# minecade/chunker:local: the Chunker CLI (github.com/HiveGamesOSS/Chunker, MIT), used by the map
# editor only to prune Bedrock worlds to chosen chunks (Bedrock to Bedrock, no conversion).
#   docker build -t minecade/chunker:local docker/chunker
#   docker run --rm -v <worlds>:/work minecade/chunker:local -i in -o out -f INPUT -p pruning.json
# The jar is pinned by version and checksum, so a changed download fails the build.
FROM eclipse-temurin:21-jre
ARG CHUNKER_VERSION=1.21.0
ADD --checksum=sha256:63148e587f5ee5a2ca7ebae1079b235c82ae4d1eff8f7a8a8a3398332513dda6 \
    https://github.com/HiveGamesOSS/Chunker/releases/download/${CHUNKER_VERSION}/chunker-cli-${CHUNKER_VERSION}.jar \
    /opt/chunker/chunker-cli.jar
WORKDIR /work
ENTRYPOINT ["java", "-jar", "/opt/chunker/chunker-cli.jar"]
