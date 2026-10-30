// Packs import the players whose skin renders the build put in the lobby pack as "#skins" (see
// skinsPlugin in tools/build/transport-plugin.ts).
declare module "#skins" {
  const skins: import("../packages/minigame-core/src/registry.ts").PlayerSkin[];
  export default skins;
}
