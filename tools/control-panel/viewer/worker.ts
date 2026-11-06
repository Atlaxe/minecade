// A meshing worker for the viewer page: gets the looks once, then sections to mesh, and answers
// each with its mesh (mesher.ts), handing the buffers over rather than copying them.
import { meshSection, prepareLooks, type Looks, type Prepared, type SectionMesh } from "./mesher.ts";

interface Scope {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
}

const scope = self as unknown as Scope;
let looks: Prepared | undefined;

scope.onmessage = (event) => {
  const message = event.data as { looks?: Looks; id?: number; blocks?: Uint16Array; water?: Uint16Array; offset?: [number, number, number] };
  if (message.looks) {
    looks = prepareLooks(message.looks);
    return;
  }
  const mesh: SectionMesh = meshSection(message.blocks!, message.water, looks!, message.offset!);
  const buffers = [mesh.solid, mesh.glass].flatMap((part) => [part.positions.buffer, part.tints.buffer, part.occlusion.buffer, part.indices.buffer]);
  scope.postMessage({ id: message.id, mesh }, buffers);
};
