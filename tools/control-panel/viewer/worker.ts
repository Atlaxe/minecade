// A meshing worker for the viewer page: gets the looks once, then sections to mesh, and answers
// each with its mesh (mesher.ts), handing the buffers over rather than copying them.
import { meshSection, type SectionMesh } from "./mesher.ts";

interface Scope {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
}

const scope = self as unknown as Scope;
let drawn: Uint8Array = new Uint8Array(0);
let colors: Uint8Array = new Uint8Array(0);

scope.onmessage = (event) => {
  const message = event.data as { looks?: { drawn: Uint8Array; colors: Uint8Array }; id?: number; blocks?: Uint16Array; offset?: [number, number, number] };
  if (message.looks) {
    drawn = message.looks.drawn;
    colors = message.looks.colors;
    return;
  }
  const mesh: SectionMesh = meshSection(message.blocks!, drawn, colors, message.offset!);
  scope.postMessage({ id: message.id, mesh }, [mesh.positions.buffer, mesh.tints.buffer, mesh.occlusion.buffer, mesh.indices.buffer]);
};
