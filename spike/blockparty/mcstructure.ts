// A box of a Bedrock world as a .mcstructure file, read straight from the world's LevelDB with no
// server (Block Party's spike: a minigame's arena brought into a board's world). The file is what
// BDS loads from a behavior pack's structures/ folder and places with structureManager.place: one
// little-endian NBT compound with the box's size, every block's palette index in two layers (the
// blocks, then mostly the water in waterlogged blocks; -1 for none), the palette (each entry the
// world's own name, states and version, unchanged), and the block entities (chests, signs) by
// index. Indices run z fastest, then y, then x. No entities: arenas spawn theirs from map points.
//
// Sub-chunks are read as the map viewer reads them (tools/viewer/subchunk.ts), but the palette
// entries are kept as the world wrote them, version included, which the viewer drops.
import { join } from "node:path";
import nbt from "prismarine-nbt";
import { readWorldDb } from "../../tools/viewer/world-reader.ts";

export type Vec3 = [number, number, number];
export interface Box {
  min: Vec3;
  max: Vec3;
}

/** One palette entry as NBT (name, states, version), and its raw bytes as text, to tell entries apart. */
interface RawEntry {
  key: string;
  value: nbt.Compound["value"];
}

export interface StructureStats {
  size: Vec3;
  /** Blocks that aren't air. */
  blocks: number;
  /** Palette entries. */
  palette: number;
  blockEntities: number;
  /** The newest block version in the palette (a whole number Bedrock writes with every block). */
  version: number;
}

const SUBCHUNK = 47;
const BLOCK_ENTITY = 49;
const AIR = "minecraft:air";
const little = (nbt as unknown as { protos: { little: { parsePacketBuffer(type: string, data: Buffer, offset: number): { data: nbt.NBT; metadata: { size: number } } } } }).protos.little;

/** Reads one little-endian NBT root at `at`: its value and where it ends. */
function readRoot(data: Buffer, at: number): { value: nbt.NBT; end: number } {
  const parsed = little.parsePacketBuffer("nbt", data, at);
  return { value: parsed.data, end: at + parsed.metadata.size };
}

/** A sub-chunk's layers as indices into its own palette, and the palette's raw entries. */
function decodeSubChunk(value: Buffer): { layers: { ids: Uint16Array; palette: RawEntry[] }[] } {
  const version = value[0];
  let at = 1;
  let count = 1;
  if (version === 8 || version === 9) {
    count = value[at++];
    if (version === 9) at++;
  } else if (version !== 1) throw new Error(`a sub-chunk in format ${version}: open the world in BDS once to bring it up to date`);
  const layers: { ids: Uint16Array; palette: RawEntry[] }[] = [];
  for (let layer = 0; layer < count; layer++) {
    const bits = value[at++] >> 1;
    const perWord = bits > 0 ? Math.floor(32 / bits) : 0;
    const wordCount = bits > 0 ? Math.ceil(4096 / perWord) : 0;
    const words = at;
    at += 4 * wordCount;
    const size = value.readInt32LE(at);
    at += 4;
    const palette: RawEntry[] = [];
    for (let i = 0; i < size; i++) {
      const root = readRoot(value, at);
      palette.push({ key: value.subarray(at, root.end).toString("latin1"), value: (root.value as nbt.Compound).value });
      at = root.end;
    }
    const ids = new Uint16Array(4096);
    if (bits > 0) {
      const mask = (1 << bits) - 1;
      let i = 0;
      for (let w = 0; w < wordCount; w++) {
        let word = value.readUInt32LE(words + 4 * w);
        for (let k = 0; k < perWord && i < 4096; k++) {
          ids[i++] = word & mask;
          word >>>= bits;
        }
      }
    }
    layers.push({ ids, palette });
  }
  return { layers };
}

const keyOf = (x: number, z: number, tag: number, y?: number) => {
  const key = Buffer.alloc(y === undefined ? 9 : 10);
  key.writeInt32LE(x, 0);
  key.writeInt32LE(z, 4);
  key[8] = tag;
  if (y !== undefined) key.writeInt8(y, 9);
  return key.toString("latin1");
};

/** The box of `world` (a world folder, with db\ inside) as a .mcstructure file. */
export function worldToStructure(world: string, box: Box): { file: Buffer; stats: StructureStats } {
  const [x0, y0, z0] = box.min;
  const [x1, y1, z1] = box.max;
  const size: Vec3 = [x1 - x0 + 1, y1 - y0 + 1, z1 - z0 + 1];
  const [sx, sy, sz] = size;
  const cx0 = Math.floor(x0 / 16);
  const cx1 = Math.floor(x1 / 16);
  const cz0 = Math.floor(z0 / 16);
  const cz1 = Math.floor(z1 / 16);
  const wanted = (key: Buffer) => {
    if (key.length !== 9 && key.length !== 10) return false;
    const tag = key[8];
    if (!(key.length === 10 ? tag === SUBCHUNK : tag === BLOCK_ENTITY)) return false;
    const cx = key.readInt32LE(0);
    const cz = key.readInt32LE(4);
    return cx >= cx0 && cx <= cx1 && cz >= cz0 && cz <= cz1;
  };
  const { values } = readWorldDb(join(world, "db"), wanted);

  const palette: RawEntry[] = [];
  const byKey = new Map<string, number>();
  const indexOf = (entry: RawEntry) => {
    let index = byKey.get(entry.key);
    if (index === undefined) {
      index = palette.length;
      palette.push(entry);
      byKey.set(entry.key, index);
    }
    return index;
  };
  let version = 0;

  const count = sx * sy * sz;
  const layer0 = new Int32Array(count);
  const layer1 = new Int32Array(count).fill(-1);
  let airIndex = -1;
  const air = () => {
    if (airIndex < 0) {
      // The world's own air entry if any sub-chunk had one; else one written here.
      const known = palette.findIndex((entry) => (entry.value.name as nbt.Tags["string"]).value === AIR);
      airIndex = known >= 0 ? known : indexOf({ key: "air", value: { name: { type: "string", value: AIR }, states: { type: "compound", value: {} }, version: { type: "int", value: version } } });
    }
    return airIndex;
  };
  const filled = new Uint8Array(count);
  const at = (x: number, y: number, z: number) => ((x - x0) * sy + (y - y0)) * sz + (z - z0);

  for (let cx = cx0; cx <= cx1; cx++) {
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cy = Math.floor(y0 / 16); cy <= Math.floor(y1 / 16); cy++) {
        const value = values.get(keyOf(cx, cz, SUBCHUNK, cy));
        if (!value) continue;
        const { layers } = decodeSubChunk(value);
        layers.forEach((layer, n) => {
          if (n > 1) return;
          const ids = layer.palette.map((entry) => {
            const v = entry.value.version as nbt.Tags["int"] | undefined;
            if (v && v.value > version) version = v.value;
            return indexOf(entry);
          });
          for (let lx = 0; lx < 16; lx++) {
            const x = cx * 16 + lx;
            if (x < x0 || x > x1) continue;
            for (let lz = 0; lz < 16; lz++) {
              const z = cz * 16 + lz;
              if (z < z0 || z > z1) continue;
              for (let ly = 0; ly < 16; ly++) {
                const y = cy * 16 + ly;
                if (y < y0 || y > y1) continue;
                const id = ids[layer.ids[(lx << 8) | (lz << 4) | ly]];
                const i = at(x, y, z);
                if (n === 0) {
                  layer0[i] = id;
                  filled[i] = 1;
                } else if ((palette[id].value.name as nbt.Tags["string"]).value !== AIR) layer1[i] = id;
              }
            }
          }
        });
      }
    }
  }
  // Sub-chunks a world never stored are air.
  for (let i = 0; i < count; i++) if (!filled[i]) layer0[i] = air();

  const positionData: Record<string, nbt.Tags["compound"]> = {};
  let blockEntities = 0;
  for (let cx = cx0; cx <= cx1; cx++) {
    for (let cz = cz0; cz <= cz1; cz++) {
      const value = values.get(keyOf(cx, cz, BLOCK_ENTITY));
      if (!value) continue;
      for (let offset = 0; offset < value.length; ) {
        const root = readRoot(value, offset);
        offset = root.end;
        const tags = (root.value as nbt.Compound).value;
        const x = (tags.x as nbt.Tags["int"]).value;
        const y = (tags.y as nbt.Tags["int"]).value;
        const z = (tags.z as nbt.Tags["int"]).value;
        if (x < x0 || x > x1 || y < y0 || y > y1 || z < z0 || z > z1) continue;
        positionData[String(at(x, y, z))] = { type: "compound", value: { block_entity_data: { type: "compound", value: tags } } };
        blockEntities++;
      }
    }
  }

  const airId = palette.findIndex((entry) => (entry.value.name as nbt.Tags["string"]).value === AIR);
  let blocks = 0;
  for (let i = 0; i < count; i++) if (layer0[i] !== airId) blocks++;
  const file = writeStructure(size, box.min, layer0, layer1, palette.map((entry) => entry.value), positionData);
  return { file, stats: { size, blocks, palette: palette.length, blockEntities, version } };
}

/** Writes a .mcstructure file: `layer0` and `layer1` are palette indices, z fastest, then y, then x. */
export function writeStructure(
  size: Vec3,
  origin: Vec3,
  layer0: Int32Array,
  layer1: Int32Array,
  palette: nbt.Compound["value"][],
  positionData: Record<string, nbt.Tags["compound"]> = {},
): Buffer {
  const ints = (values: ArrayLike<number>) => ({ type: "int" as const, value: Array.from(values) });
  const root = {
    type: "compound",
    name: "",
    value: {
      format_version: { type: "int", value: 1 },
      size: { type: "list", value: ints(size) },
      structure: {
        type: "compound",
        value: {
          block_indices: { type: "list", value: { type: "list", value: [ints(layer0), ints(layer1)] } },
          entities: { type: "list", value: { type: "compound", value: [] } },
          palette: {
            type: "compound",
            value: {
              default: {
                type: "compound",
                value: {
                  block_palette: { type: "list", value: { type: "compound", value: palette } },
                  block_position_data: { type: "compound", value: positionData },
                },
              },
            },
          },
        },
      },
      structure_world_origin: { type: "list", value: ints(origin) },
    },
  };
  return nbt.writeUncompressed(root as unknown as nbt.NBT, "little");
}

/** A palette entry for a block with no states (a concrete color), at `version`. */
export function plainBlock(name: string, version: number): nbt.Compound["value"] {
  return { name: { type: "string", value: name }, states: { type: "compound", value: {} }, version: { type: "int", value: version } };
}
