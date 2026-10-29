// Packs import the build's game registry as "#registry" (see registryPlugin in
// tools/build/transport-plugin.ts).
declare module "#registry" {
  const registry: import("../packages/minigame-core/src/registry.ts").Registry;
  export default registry;
}
