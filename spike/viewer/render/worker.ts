// A meshing worker: gets the look tables once, then sections to mesh; answers each with its mesh
// and how long it took.
import { meshSection } from "./mesher.ts";

let drawn = new Uint8Array(0);
let colors = new Uint8Array(0);

self.onmessage = (event: MessageEvent) => {
  const message = event.data as { init?: { drawn: Uint8Array; colors: Uint8Array }; id?: number; blocks?: Uint16Array; offset?: [number, number, number] };
  if (message.init) {
    drawn = message.init.drawn;
    colors = message.init.colors;
    return;
  }
  const started = performance.now();
  const mesh = meshSection(message.blocks!, drawn, colors, message.offset!);
  const ms = performance.now() - started;
  (self as unknown as Worker).postMessage({ id: message.id, mesh, ms }, [mesh.positions.buffer, mesh.colors.buffer, mesh.indices.buffer]);
};
