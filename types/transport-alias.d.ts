// Packs import their transport as "#transport". Each bundle resolves it to one implementation
// (see tools/build/transport-plugin.ts); both export this same shape.
declare module "#transport" {
  export const kind: import("../packages/minigame-core/src/protocol/index.ts").TransportKind;
  export const createTransport: import("../packages/minigame-core/src/transport/transport.ts").TransportFactory;
}
