// Packs import the names of the private packs the build gave their target (games/<id>/private_packs/
// <name>/, git-ignored: tools/build/packs.ts, privatePacks) as "#private-packs", so a script can
// leave out what such a pack would have drawn when it's missing (see privatePacksPlugin in
// tools/build/transport-plugin.ts).
declare module "#private-packs" {
  const packs: string[];
  export default packs;
}
