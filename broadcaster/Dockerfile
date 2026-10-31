# syntax=docker/dockerfile:1
# The friends broadcast: MCXboxBroadcast's standalone build, which shows the lobby in its account's
# friends' Friends tab and relays their joins to it. To update, change the build number in the URL
# and the checksum (sha256 of the release's MCXboxBroadcastStandalone.jar) together.
FROM eclipse-temurin:21-jre
ADD --checksum=sha256:16ae71013ebe06f27811df63e007f378fe19d7fa78181bf139b09f7313ddc16b \
    https://github.com/MCXboxBroadcast/Broadcaster/releases/download/162/MCXboxBroadcastStandalone.jar \
    /app/broadcast.jar
COPY entrypoint.sh /app/entrypoint.sh
WORKDIR /data
ENTRYPOINT ["bash", "/app/entrypoint.sh"]
