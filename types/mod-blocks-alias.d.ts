// Packs import the shapes of the shared blocks pack's repaintable blocks as "#mod-blocks" (see
// modBlocksPlugin in tools/build/transport-plugin.ts): block id to "cube", "stairs", "slab", ...
declare module "#mod-blocks" {
  const shapes: Readonly<Record<string, string>>;
  export default shapes;
}
