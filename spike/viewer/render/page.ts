// Map viewer spike, steps 3 and 4 (the page serve.ts opens in Edge): for each scene, meshes every
// section in workers, then measures frame rates (one mesh per section, then sections grouped into
// region meshes), memory, the height cut moved a layer at a time (a clipping plane with a cap of
// the cut layer, then re-meshing the cut's sections), and Faded, and posts the numbers back.
import * as THREE from "three";
import { PADDED, SHADE, type SectionMesh } from "./mesher.ts";

/** Sections per region side: a region mesh is 64 blocks a side. */
const REGION = 4;
const status = document.getElementById("status")!;
/** Shows a step, and tells serve.ts, which logs it with the time (so a hang or crash shows where it was). */
const say = (text: string) => {
  status.textContent = text;
  void fetch("/progress", { method: "POST", body: text }).catch(() => {});
};
addEventListener("error", (event) => say(`error: ${event.message}`));
addEventListener("unhandledrejection", (event) => say(`error: ${String(event.reason)}`));

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.localClippingEnabled = true;
renderer.setClearColor(0x9bb8d3);
document.body.appendChild(renderer.domElement);
renderer.domElement.addEventListener("webglcontextlost", () => say("WebGL context lost"));
const gl = renderer.getContext() as WebGL2RenderingContext;
const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
const gpu = debugInfo ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)) : "unknown";
const workers = Array.from({ length: Math.max(2, Math.min(8, navigator.hardwareConcurrency - 1)) }, () => new Worker("worker.js", { type: "module" }));

interface Scene {
  name: string;
  size: [number, number, number];
  volume: Uint16Array;
  colors: Uint8Array;
  drawn: Uint8Array;
}

async function loadScene(name: string): Promise<Scene> {
  const data = await (await fetch(`/scene/${name}`)).arrayBuffer();
  const headerLength = new DataView(data).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(data, 4, headerLength))) as { size: [number, number, number]; colors: number[]; drawn: number[] };
  const start = 4 + headerLength + ((4 + headerLength) % 2);
  return { name, size: header.size, volume: new Uint16Array(data, start), colors: Uint8Array.from(header.colors), drawn: Uint8Array.from(header.drawn) };
}

/** A section's blocks with their border, or undefined when it's all air. Blocks above `cutY` count as air. */
function sectionBlocks(scene: Scene, cx: number, cy: number, cz: number, cutY = Infinity): Uint16Array | undefined {
  const [sx, sy, sz] = scene.size;
  const blocks = new Uint16Array(PADDED ** 3);
  let any = false;
  for (let x = -1; x <= 16; x++) {
    const wx = cx * 16 + x;
    if (wx < 0 || wx >= sx) continue;
    for (let z = -1; z <= 16; z++) {
      const wz = cz * 16 + z;
      if (wz < 0 || wz >= sz) continue;
      const column = (wx * sz + wz) * sy;
      for (let y = -1; y <= 16; y++) {
        const wy = cy * 16 + y;
        if (wy < 0 || wy >= sy || wy > cutY) continue;
        const id = scene.volume[column + wy];
        if (!id) continue;
        blocks[((x + 1) * PADDED + (z + 1)) * PADDED + (y + 1)] = id;
        if (x >= 0 && x < 16 && y >= 0 && y < 16 && z >= 0 && z < 16) any = true;
      }
    }
  }
  return any ? blocks : undefined;
}

/** Meshes sections in the workers; each result has the worker's own time. */
function meshAll(jobs: { key: string; blocks: Uint16Array; offset: [number, number, number] }[]): Promise<Map<string, { mesh: SectionMesh; ms: number }>> {
  const results = new Map<string, { mesh: SectionMesh; ms: number }>();
  return new Promise((resolve) => {
    if (jobs.length === 0) return resolve(results);
    let next = 0;
    let done = 0;
    const feed = (worker: Worker) => {
      if (next >= jobs.length) return;
      const job = jobs[next];
      worker.postMessage({ id: next++, blocks: job.blocks, offset: job.offset }, [job.blocks.buffer]);
    };
    for (const worker of workers) {
      worker.onmessage = (event: MessageEvent) => {
        const { id, mesh, ms } = event.data as { id: number; mesh: SectionMesh; ms: number };
        results.set(jobs[id].key, { mesh, ms });
        if (++done === jobs.length) resolve(results);
        else feed(worker);
      };
      feed(worker);
    }
  });
}

function geometryOf(meshes: SectionMesh[]): THREE.BufferGeometry {
  const vertices = meshes.reduce((sum, mesh) => sum + mesh.positions.length / 3, 0);
  const indexCount = meshes.reduce((sum, mesh) => sum + mesh.indices.length, 0);
  const positions = new Uint8Array(vertices * 3);
  const colors = new Uint8Array(vertices * 4);
  const indices = vertices < 65536 ? new Uint16Array(indexCount) : new Uint32Array(indexCount);
  let v = 0;
  let i = 0;
  for (const mesh of meshes) {
    positions.set(mesh.positions, v * 3);
    colors.set(mesh.colors, v * 4);
    for (let k = 0; k < mesh.indices.length; k++) indices[i + k] = mesh.indices[k] + v;
    v += mesh.positions.length / 3;
    i += mesh.indices.length;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 4, true));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(REGION * 8, REGION * 8, REGION * 8), REGION * 16);
  return geometry;
}

const bytesOf = (geometry: THREE.BufferGeometry) => Object.values(geometry.attributes).reduce((sum, attribute) => sum + (attribute as THREE.BufferAttribute).array.byteLength, 0) + (geometry.index?.array.byteLength ?? 0);

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
}
const round = (value: number) => Math.round(value * 10) / 10;

async function run(name: string): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = { scene: name };
  say(`${name}: loading`);
  let started = performance.now();
  const scene = await loadScene(name);
  result.loadMs = round(performance.now() - started);
  const [sx, sy, sz] = scene.size;
  result.size = scene.size;
  for (const worker of workers) worker.postMessage({ init: { drawn: scene.drawn, colors: scene.colors } });

  // Mesh every section.
  say(`${name}: meshing`);
  started = performance.now();
  const jobs: { key: string; blocks: Uint16Array; offset: [number, number, number] }[] = [];
  const sections = [Math.ceil(sx / 16), Math.ceil(sy / 16), Math.ceil(sz / 16)];
  for (let cx = 0; cx < sections[0]; cx++) {
    for (let cy = 0; cy < sections[1]; cy++) {
      for (let cz = 0; cz < sections[2]; cz++) {
        const blocks = sectionBlocks(scene, cx, cy, cz);
        if (blocks) jobs.push({ key: `${cx},${cy},${cz}`, blocks, offset: [(cx % REGION) * 16, (cy % REGION) * 16, (cz % REGION) * 16] });
      }
    }
  }
  const extractMs = performance.now() - started;
  const meshed = await meshAll(jobs);
  const meshWallMs = performance.now() - started;
  const times = [...meshed.values()].map((entry) => entry.ms);
  const quads = [...meshed.values()].reduce((sum, entry) => sum + entry.mesh.quads, 0);
  Object.assign(result, {
    sections: `${jobs.length} of ${sections[0] * sections[1] * sections[2]} not empty`,
    extractMs: round(extractMs),
    meshWallMs: round(meshWallMs),
    workers: workers.length,
    meshPerSectionMs: { average: round(times.reduce((a, b) => a + b, 0) / times.length), p95: round(percentile(times, 0.95)), max: round(Math.max(...times)) },
    quads,
    triangles: quads * 2,
  });

  const world = new THREE.Scene();
  const center = new THREE.Vector3(sx / 2, sy / 2, sz / 2);
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 1, 5000);
  const distance = Math.max(sx, sy, sz) * 1.4;
  /** No cut: far above everything. */
  const NO_CUT = 1e6;
  const cutPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), NO_CUT);
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, clippingPlanes: [cutPlane] });

  /** Orbits the camera for a while: frame times from requestAnimationFrame, render() call times, and frames forced to finish. */
  const orbit = (seconds: number): Promise<Record<string, number>> =>
    new Promise((resolve) => {
      const deltas: number[] = [];
      const calls: number[] = [];
      const begin = performance.now();
      let last = begin;
      const frame = (now: number) => {
        if (now - last > 1000) say(`a frame took ${Math.round(now - last)} ms`);
        deltas.push(now - last);
        last = now;
        const angle = ((now - begin) / 1000) * 0.5;
        camera.position.set(center.x + Math.cos(angle) * distance, center.y + distance * 0.55, center.z + Math.sin(angle) * distance);
        camera.lookAt(center);
        const before = performance.now();
        renderer.render(world, camera);
        calls.push(performance.now() - before);
        if (now - begin < seconds * 1000) requestAnimationFrame(frame);
        else {
          // Frames forced to finish (a pixel read back), so the GPU's time counts too.
          const pixel = new Uint8Array(4);
          const finished: number[] = [];
          for (let k = 0; k < 20; k++) {
            const t = performance.now();
            renderer.render(world, camera);
            gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
            finished.push(performance.now() - t);
          }
          const frames = deltas.slice(2);
          resolve({ fps: round(1000 / (frames.reduce((a, b) => a + b, 0) / frames.length)), frameP95Ms: round(percentile(frames, 0.95)), renderCallMs: round(calls.reduce((a, b) => a + b, 0) / calls.length), finishedFrameMs: round(percentile(finished, 0.5)), drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles });
        }
      };
      requestAnimationFrame(frame);
    });

  // One mesh per section.
  say(`${name}: one mesh per section`);
  const perSection = new THREE.Group();
  for (const [key, { mesh }] of meshed) {
    const [cx, cy, cz] = key.split(",").map(Number);
    const object = new THREE.Mesh(geometryOf([mesh]), material);
    object.position.set(Math.floor(cx / REGION) * REGION * 16, Math.floor(cy / REGION) * REGION * 16, Math.floor(cz / REGION) * REGION * 16);
    perSection.add(object);
  }
  world.add(perSection);
  say(`${name}: meshed, ${quads} quads; orbiting`);
  result.perSection = await orbit(4);
  world.remove(perSection);
  for (const object of perSection.children) (object as THREE.Mesh).geometry.dispose();

  // Sections grouped into region meshes.
  say(`${name}: region meshes`);
  started = performance.now();
  const sectionMeshes = new Map([...meshed].map(([key, { mesh }]) => [key, mesh]));
  const regions = new Map<string, THREE.Mesh>();
  const buildRegion = (rx: number, ry: number, rz: number) => {
    const key = `${rx},${ry},${rz}`;
    const old = regions.get(key);
    if (old) {
      world.remove(old);
      old.geometry.dispose();
      regions.delete(key);
    }
    const parts: SectionMesh[] = [];
    for (let x = 0; x < REGION; x++) for (let y = 0; y < REGION; y++) for (let z = 0; z < REGION; z++) {
      const mesh = sectionMeshes.get(`${rx * REGION + x},${ry * REGION + y},${rz * REGION + z}`);
      if (mesh && mesh.quads > 0) parts.push(mesh);
    }
    if (parts.length === 0) return;
    const object = new THREE.Mesh(geometryOf(parts), material);
    object.position.set(rx * REGION * 16, ry * REGION * 16, rz * REGION * 16);
    regions.set(key, object);
    world.add(object);
  };
  const regionCounts = sections.map((n) => Math.ceil(n / REGION));
  for (let rx = 0; rx < regionCounts[0]; rx++) for (let ry = 0; ry < regionCounts[1]; ry++) for (let rz = 0; rz < regionCounts[2]; rz++) buildRegion(rx, ry, rz);
  result.regionBuildMs = round(performance.now() - started);
  renderer.render(world, camera);
  const geometryBytes = [...regions.values()].reduce((sum, object) => sum + bytesOf(object.geometry), 0);
  result.memory = {
    volumeMB: round(scene.volume.byteLength / 2 ** 20),
    geometryMB: round(geometryBytes / 2 ** 20),
    jsHeapMB: round(((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 2 ** 20),
    edge: await (await fetch("/measure", { method: "POST" })).json(),
  };
  say(`${name}: regions built; orbiting`);
  result.regions = await orbit(4);

  // The height cut, a layer at a time: a clipping plane (instant) and a cap of the cut layer's
  // tops that the layer above hid (built here, one layer of the whole map).
  say(`${name}: height cut with a clipping plane`);
  const capMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
  let cap: THREE.Mesh | undefined;
  const at = (x: number, y: number, z: number) => (y < 0 || y >= sy ? 0 : scene.volume[(x * sz + z) * sy + y]);
  const buildCap = (layer: number) => {
    if (cap) {
      world.remove(cap);
      cap.geometry.dispose();
    }
    const mask = new Uint16Array(sx * sz);
    for (let x = 0; x < sx; x++) for (let z = 0; z < sz; z++) {
      const id = at(x, layer, z);
      if (scene.drawn[id] && scene.drawn[at(x, layer + 1, z)]) mask[x * sz + z] = id;
    }
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    for (let x = 0; x < sx; x++) {
      for (let z = 0; z < sz; ) {
        const id = mask[x * sz + z];
        if (!id) {
          z++;
          continue;
        }
        let depth = 1;
        while (z + depth < sz && mask[x * sz + z + depth] === id) depth++;
        let width = 1;
        grow: while (x + width < sx) {
          for (let k = 0; k < depth; k++) if (mask[(x + width) * sz + z + k] !== id) break grow;
          width++;
        }
        for (let w = 0; w < width; w++) for (let k = 0; k < depth; k++) mask[(x + w) * sz + z + k] = 0;
        const base = positions.length / 3;
        const y = layer + 1;
        positions.push(x, y, z, x, y, z + depth, x + width, y, z + depth, x + width, y, z);
        for (let k = 0; k < 4; k++) colors.push(scene.colors[id * 12], scene.colors[id * 12 + 1], scene.colors[id * 12 + 2], 255);
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        z += depth;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(positions), 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(Uint8Array.from(colors), 4, true));
    geometry.setIndex(indices);
    cap = new THREE.Mesh(geometry, capMaterial);
    world.add(cap);
  };
  const pixel = new Uint8Array(4);
  const capTimes: number[] = [];
  const stepTimes: number[] = [];
  camera.position.set(center.x + distance * 0.7, center.y + distance * 0.7, center.z + distance * 0.7);
  camera.lookAt(center);
  for (let k = 0; k < 20; k++) {
    const layer = Math.floor(sy * 0.75) - k;
    const t = performance.now();
    buildCap(layer);
    capTimes.push(performance.now() - t);
    cutPlane.constant = layer + 1.001;
    renderer.render(world, camera);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    stepTimes.push(performance.now() - t);
    await new Promise(requestAnimationFrame);
  }
  result.cutWithPlane = { capBuildMs: round(capTimes.reduce((a, b) => a + b, 0) / capTimes.length), capMaxMs: round(Math.max(...capTimes)), stepToFinishedFrameMs: round(stepTimes.reduce((a, b) => a + b, 0) / stepTimes.length), stepMaxMs: round(Math.max(...stepTimes)) };
  await new Promise((resolve) => setTimeout(resolve, 300));
  await fetch(`/shot/${name}-cut`, { method: "POST", body: await canvasPng() });

  // Faded: everything past the cut drawn again, see-through, without its own clipping.
  say(`${name}: faded`);
  const above = new THREE.Plane(new THREE.Vector3(0, 1, 0), -cutPlane.constant);
  const faded = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.15, depthWrite: false, clippingPlanes: [above] });
  const ghosts = [...regions.values()].map((object) => {
    const ghost = new THREE.Mesh(object.geometry, faded);
    ghost.position.copy(object.position);
    world.add(ghost);
    return ghost;
  });
  say(`${name}: faded set up; orbiting`);
  result.faded = await orbit(4);
  say(`${name}: faded orbit done`);
  await fetch(`/shot/${name}-faded`, { method: "POST", body: await canvasPng() });
  for (const ghost of ghosts) world.remove(ghost);
  if (cap) world.remove(cap);
  cutPlane.constant = NO_CUT;
  await fetch(`/shot/${name}`, { method: "POST", body: await canvasPng(true) });

  // The other way: re-mesh the sections the cut layer is in (and the row it left), then their regions.
  say(`${name}: height cut by re-meshing`);
  const remesh: number[] = [];
  let previousRow = -1;
  for (let k = 0; k < 10; k++) {
    const layer = Math.floor(sy * 0.75) - k;
    const t = performance.now();
    const row = layer >> 4;
    const rows = previousRow >= 0 && previousRow !== row ? [row, previousRow] : [row];
    previousRow = row;
    const rowJobs: typeof jobs = [];
    for (const cy of rows) for (let cx = 0; cx < sections[0]; cx++) for (let cz = 0; cz < sections[2]; cz++) {
      const blocks = sectionBlocks(scene, cx, cy, cz, layer);
      if (blocks) rowJobs.push({ key: `${cx},${cy},${cz}`, blocks, offset: [(cx % REGION) * 16, (cy % REGION) * 16, (cz % REGION) * 16] });
      else sectionMeshes.delete(`${cx},${cy},${cz}`);
    }
    for (const [key, { mesh }] of await meshAll(rowJobs)) sectionMeshes.set(key, mesh);
    for (const cy of rows) for (let rx = 0; rx < regionCounts[0]; rx++) for (let rz = 0; rz < regionCounts[2]; rz++) buildRegion(rx, Math.floor(cy / REGION), rz);
    renderer.render(world, camera);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    remesh.push(performance.now() - t);
    await new Promise(requestAnimationFrame);
  }
  result.cutByRemeshing = { stepMs: round(remesh.reduce((a, b) => a + b, 0) / remesh.length), stepMaxMs: round(Math.max(...remesh)) };

  for (const object of regions.values()) object.geometry.dispose();
  renderer.renderLists.dispose();
  return result;

  async function canvasPng(home = false): Promise<Blob> {
    if (home) {
      camera.position.set(center.x + distance * 0.75, center.y + distance * 0.6, center.z + distance * 0.75);
      camera.lookAt(center);
    }
    renderer.render(world, camera);
    return new Promise((resolve) => renderer.domElement.toBlob((blob) => resolve(blob!), "image/png"));
  }
}

const scenes = (await (await fetch("/scenes")).json()) as string[];
const all: Record<string, unknown>[] = [];
for (const name of scenes) {
  try {
    const result = await run(name);
    all.push(result);
    await fetch("/result", { method: "POST", body: JSON.stringify(result) });
  } catch (error) {
    await fetch("/result", { method: "POST", body: JSON.stringify({ scene: name, error: String((error as Error).stack ?? error) }) });
  }
}
await fetch("/done", { method: "POST", body: JSON.stringify({ gpu, devicePixelRatio, canvas: [renderer.domElement.width, renderer.domElement.height], userAgent: navigator.userAgent, cores: navigator.hardwareConcurrency, shade: SHADE }) });
say("done");
