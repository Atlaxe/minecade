// Writes Paintball's painted blocks (games/paintball/behavior_pack/blocks/, and their geometries,
// names and textures in its resource pack): for each team's dye, a wall, fence, fence gate, pane,
// trapdoor, door and vertical slab in that color's concrete, the shapes vanilla concrete doesn't come
// in (games/paintball/behavior_pack/scripts/shapes.ts). Their textures are vanilla's own concrete
// (textures/blocks/concrete_<dye>), so no vanilla file is copied. Each shape is drawn as vanilla
// draws it, from boxes in Java's block coordinates (0 to 16, x east, z south); a box's bone shows
// for the states that use it, so nothing is turned. It also writes the map editor's marker for
// Power-up spots: the guns pack's floating rifle in white, raised as the pickup floats.
// Rerun after changing them, and commit the files:
//
//     npx tsx tools/assets/paint-blocks.ts
//
// A test checks the committed files match (games/paintball/test/paintball.test.ts).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import config from "../../games/paintball/game.config.ts";
import { OPENING_SHAPES, PAINT_SHAPES, PAINT_USE, SHAPE_STATES, SIDES, paintBlock, paintDyes, type PaintShape, type Side } from "../../games/paintball/behavior_pack/scripts/shapes.ts";

const root = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));
const paintball = (path: string) => root(`games/paintball/${path}`);

/** A box in Java's block coordinates: x1, y1, z1, x2, y2, z2. */
type Box = readonly [number, number, number, number, number, number];
/** A condition on the block's states, as Molang. */
type When = string;

const is = (state: string, value: string): When => `q.block_state('minecade:${state}') == '${value}'`;
const any = (...conditions: When[]): When => (conditions.length === 1 ? conditions[0] : `(${conditions.join(" || ")})`);
const all = (...conditions: When[]): When => conditions.join(" && ");

/** Swaps x and z: a box along one axis as the same box along the other. */
const swapXZ = ([x1, y1, z1, x2, y2, z2]: Box): Box => [z1, y1, x1, z2, y2, x2];
/** Mirrors z (south to north). */
const flipZ = ([x1, y1, z1, x2, y2, z2]: Box): Box => [x1, y1, 16 - z2, x2, y2, 16 - z1];
/** Mirrors x (east to west). */
const flipX = ([x1, y1, z1, x2, y2, z2]: Box): Box => [16 - x2, y1, z1, 16 - x1, y2, z2];
/** A box on the north side turned to `side` (north is as given). */
function toSide(box: Box, side: Side): Box {
  if (side === "north") return box;
  if (side === "south") return flipZ(box);
  const west = swapXZ(box);
  return side === "west" ? west : flipX(west);
}

/** A shape: its pieces (bones, each shown when its condition holds), and its collision and selection by state. */
interface ShapeDef {
  pieces: { name: string; boxes: Box[]; when: When }[];
  /** Permutations' collision boxes and selection box: conditions in order, the first that holds wins. */
  boxes: { when: When; collision: Box[]; selection?: Box }[];
  /** Vanilla fences, walls and panes joining it (minecraft:connection_rule), by condition. */
  connections: { when?: When; rule: Record<string, unknown> }[];
  /** Extra permutations (a gate in a wall sits lower). */
  extra?: { when: When; components: Record<string, unknown> }[];
}

/** Every combination of the states named, as { state: value } lists. */
function combinations(states: Record<string, string[]>): Record<string, string>[] {
  let list: Record<string, string>[] = [{}];
  for (const [name, values] of Object.entries(states)) list = list.flatMap((partial) => values.map((value) => ({ ...partial, [name.replace("minecade:", "")]: value })));
  return list;
}
const exactly = (combo: Record<string, string>): When => all(...Object.entries(combo).map(([state, value]) => is(state, value)));

/** The smallest box around `boxes`, at most a block tall (a selection box). */
function around(boxes: Box[]): Box {
  const low = [0, 1, 2].map((axis) => Math.min(...boxes.map((box) => box[axis])));
  const high = [3, 4, 5].map((axis) => Math.min(16, Math.max(...boxes.map((box) => box[axis]))));
  return [low[0], low[1], low[2], high[0], high[1], high[2]];
}

// Walls: a post when "up", and a low or tall arm to each joined side. Collision is 1.5 blocks tall, as vanilla's.
const WALL_ARM: Box = [5, 0, 0, 11, 14, 8];
function wall(): ShapeDef {
  const post: Box = [4, 0, 4, 12, 16, 12];
  const pieces = [{ name: "post", boxes: [post], when: is("up", "true") }];
  for (const side of SIDES) {
    pieces.push({ name: `${side}_low`, boxes: [toSide(WALL_ARM, side)], when: is(side, "low") });
    pieces.push({ name: `${side}_tall`, boxes: [toSide([5, 0, 0, 11, 16, 8], side)], when: is(side, "tall") });
  }
  const boxes = combinations(SHAPE_STATES.wall).map((combo) => {
    const parts: Box[] = [];
    if (combo.up === "true") parts.push([4, 0, 4, 12, 24, 12]);
    for (const side of SIDES) if (combo[side] !== "none") parts.push(toSide([5, 0, 0, 11, 24, 8], side));
    return { when: exactly(combo), collision: parts, selection: parts.length > 0 ? around(parts) : undefined };
  });
  return { pieces, boxes, connections: [{ rule: { accepts_connections_from: "all" } }] };
}

// Fences: a post, and two rails to each joined side.
function fence(): ShapeDef {
  const pieces = [{ name: "post", boxes: [[6, 0, 6, 10, 16, 10] as Box], when: "1.0" }];
  for (const side of SIDES) {
    pieces.push({ name: side, boxes: [toSide([7, 12, 0, 9, 15, 6], side), toSide([7, 6, 0, 9, 9, 6], side)], when: is(side, "true") });
  }
  const boxes = combinations(SHAPE_STATES.fence).map((combo) => {
    const parts: Box[] = [[6, 0, 6, 10, 24, 10]];
    for (const side of SIDES) if (combo[side] === "true") parts.push(toSide([6, 0, 0, 10, 24, 8], side));
    return { when: exactly(combo), collision: parts, selection: around(parts) };
  });
  return { pieces, boxes, connections: [{ rule: { accepts_connections_from: "only_fences" } }] };
}

// Panes: a thin post, and a thin sheet to each joined side.
function pane(): ShapeDef {
  const pieces = [{ name: "post", boxes: [[7, 0, 7, 9, 16, 9] as Box], when: "1.0" }];
  for (const side of SIDES) pieces.push({ name: side, boxes: [toSide([7, 0, 0, 9, 16, 7], side)], when: is(side, "true") });
  const boxes = combinations(SHAPE_STATES.pane).map((combo) => {
    const parts: Box[] = [[7, 0, 7, 9, 16, 9]];
    for (const side of SIDES) if (combo[side] === "true") parts.push(toSide([7, 0, 0, 9, 16, 7], side));
    return { when: exactly(combo), collision: parts, selection: around(parts) };
  });
  return { pieces, boxes, connections: [{ rule: { accepts_connections_from: "all" } }] };
}

// Fence gates: two posts at the ends, the rails across between them when shut, or swung toward
// where the gate faces when open (vanilla's model, facing south: along x, opening to +z).
const GATE_POSTS: Box[] = [
  [0, 5, 7, 2, 16, 9],
  [14, 5, 7, 16, 16, 9],
];
const GATE_SHUT: Box[] = [
  [6, 6, 7, 8, 15, 9],
  [8, 6, 7, 10, 15, 9],
  [2, 6, 7, 6, 9, 9],
  [2, 12, 7, 6, 15, 9],
  [10, 6, 7, 14, 9, 9],
  [10, 12, 7, 14, 15, 9],
];
const GATE_OPEN_SOUTH: Box[] = [
  [0, 6, 13, 2, 15, 15],
  [0, 6, 9, 2, 9, 13],
  [0, 12, 9, 2, 15, 13],
  [14, 6, 13, 16, 15, 15],
  [14, 6, 9, 16, 9, 13],
  [14, 12, 9, 16, 15, 13],
];
function gate(): ShapeDef {
  const alongX = any(is("facing", "north"), is("facing", "south"));
  const alongZ = any(is("facing", "east"), is("facing", "west"));
  const shut = is("open", "false");
  const open = is("open", "true");
  const openTo: Record<Side, Box[]> = {
    south: GATE_OPEN_SOUTH,
    north: GATE_OPEN_SOUTH.map(flipZ),
    east: GATE_OPEN_SOUTH.map(swapXZ),
    west: GATE_OPEN_SOUTH.map(swapXZ).map(flipX),
  };
  const pieces = [
    { name: "posts_x", boxes: GATE_POSTS, when: alongX },
    { name: "posts_z", boxes: GATE_POSTS.map(swapXZ), when: alongZ },
    { name: "shut_x", boxes: GATE_SHUT, when: all(alongX, shut) },
    { name: "shut_z", boxes: GATE_SHUT.map(swapXZ), when: all(alongZ, shut) },
    ...SIDES.map((side) => ({ name: `open_${side}`, boxes: openTo[side], when: all(is("facing", side), open) })),
  ];
  const across: Box = [0, 0, 6, 16, 24, 10];
  const boxes = [
    { when: all(alongX, shut), collision: [across], selection: around([across]) },
    { when: all(alongZ, shut), collision: [swapXZ(across)], selection: around([swapXZ(across)]) },
    { when: alongX, collision: [], selection: around([across]) },
    { when: alongZ, collision: [], selection: around([swapXZ(across)]) },
  ];
  // Fences join a gate at its ends only.
  const connections = [
    { when: alongX, rule: { accepts_connections_from: "only_fences", enabled_directions: ["east", "west"] } },
    { when: alongZ, rule: { accepts_connections_from: "only_fences", enabled_directions: ["north", "south"] } },
  ];
  // A gate between two walls sits 3 pixels lower, as vanilla's.
  const extra = [{ when: is("in_wall", "true"), components: { "minecraft:transformation": { translation: [0, -0.1875, 0] } } }];
  return { pieces, boxes, connections, extra };
}

/** A door's or an open trapdoor's panel against each side of the block (Java's door shapes). */
const PANEL: Record<Side, Box> = {
  north: [0, 0, 0, 16, 16, 3],
  south: [0, 0, 13, 16, 16, 16],
  west: [0, 0, 0, 3, 16, 16],
  east: [13, 0, 0, 16, 16, 16],
};
/** Where a Java door's panel is by its facing, hinge and whether it's open (DoorBlock.getShape). */
export const DOOR_PANEL: Record<Side, { shut: Side; right: Side; left: Side }> = {
  // Facing south (toward the player who placed it), the shut panel is against the north side.
  south: { shut: "north", right: "west", left: "east" },
  west: { shut: "east", right: "north", left: "south" },
  north: { shut: "south", right: "east", left: "west" },
  east: { shut: "west", right: "south", left: "north" },
};

// Doors: one panel, by facing, hinge and open (both halves the same).
function door(): ShapeDef {
  const at = (side: Side): When =>
    any(
      ...SIDES.flatMap((facing) => {
        const panel = DOOR_PANEL[facing];
        const conditions: When[] = [];
        if (panel.shut === side) conditions.push(all(is("facing", facing), is("open", "false")));
        if (panel.right === side) conditions.push(all(is("facing", facing), is("open", "true"), is("hinge", "right")));
        if (panel.left === side) conditions.push(all(is("facing", facing), is("open", "true"), is("hinge", "left")));
        return conditions;
      }),
    );
  const pieces = SIDES.map((side) => ({ name: side, boxes: [PANEL[side]], when: at(side) }));
  const boxes = SIDES.map((side) => ({ when: at(side), collision: [PANEL[side]], selection: PANEL[side] }));
  return { pieces, boxes, connections: [{ rule: { accepts_connections_from: "none" } }] };
}

// Trapdoors: shut on the bottom or the top of the block, or open against the side it faces away
// from (Java: open facing north is against the south side).
const OPEN_TRAPDOOR: Record<Side, Side> = { north: "south", south: "north", east: "west", west: "east" };
function trapdoor(): ShapeDef {
  const bottom: Box = [0, 0, 0, 16, 3, 16];
  const top: Box = [0, 13, 0, 16, 16, 16];
  const shut = is("open", "false");
  const pieces = [
    { name: "bottom", boxes: [bottom], when: all(shut, is("half", "bottom")) },
    { name: "top", boxes: [top], when: all(shut, is("half", "top")) },
    ...SIDES.map((facing) => ({ name: `open_${facing}`, boxes: [PANEL[OPEN_TRAPDOOR[facing]]], when: all(is("open", "true"), is("facing", facing)) })),
  ];
  const boxes = pieces.map((piece) => ({ when: piece.when, collision: piece.boxes, selection: piece.boxes[0] }));
  return { pieces, boxes, connections: [{ rule: { accepts_connections_from: "none" } }] };
}

// Vertical slabs: the half of the block on the side it names.
const HALF: Record<Side, Box> = {
  north: [0, 0, 0, 16, 16, 8],
  south: [0, 0, 8, 16, 16, 16],
  west: [0, 0, 0, 8, 16, 16],
  east: [8, 0, 0, 16, 16, 16],
};
function verticalSlab(): ShapeDef {
  const pieces = SIDES.map((side) => ({ name: side, boxes: [HALF[side]], when: is("type", side) }));
  const boxes = pieces.map((piece) => ({ when: piece.when, collision: piece.boxes, selection: piece.boxes[0] }));
  // Its full side faces out: walls and panes join it there, as they join any full face.
  const connections = SIDES.map((side) => ({ when: is("type", side), rule: { accepts_connections_from: "all", enabled_directions: [side] } }));
  return { pieces, boxes, connections };
}

const SHAPES: Record<PaintShape, () => ShapeDef> = { wall, fence, fence_gate: gate, pane, trapdoor, door, vertical_slab: verticalSlab };

/** A Java-coordinate box as Bedrock's origin and size (block geometry and boxes mirror x). */
const bedrockBox = ([x1, y1, z1, x2, y2, z2]: Box) => ({ origin: [8 - x2, y1, z1 - 8], size: [x2 - x1, y2 - y1, z2 - z1] });

/** A box's cube, each face showing the part of the texture it covers, as Java's automatic UVs. */
function cube(box: Box): unknown {
  const [x1, y1, z1, x2, y2, z2] = box;
  const face = (u: number, v: number, w: number, h: number) => ({ uv: [u, v], uv_size: [w, h] });
  return {
    ...bedrockBox(box),
    uv: {
      north: face(16 - x2, 16 - y2, x2 - x1, y2 - y1),
      south: face(x1, 16 - y2, x2 - x1, y2 - y1),
      west: face(z1, 16 - y2, z2 - z1, y2 - y1),
      east: face(16 - z2, 16 - y2, z2 - z1, y2 - y1),
      up: face(x1, z1, x2 - x1, z2 - z1),
      down: face(x1, 16 - z2, x2 - x1, z2 - z1),
    },
  };
}

const geometryId = (shape: PaintShape) => `geometry.minecade.paint_${shape}`;
const textureId = (dye: string) => `minecade_paint_${dye}`;

function geometry(shape: PaintShape, def: ShapeDef): unknown {
  return {
    description: { identifier: geometryId(shape), texture_width: 16, texture_height: 16 },
    bones: def.pieces.map((piece) => ({ name: piece.name, pivot: [0, 0, 0], cubes: piece.boxes.map(cube) })),
  };
}

function block(dye: string, shape: PaintShape, def: ShapeDef): unknown {
  const material = { "*": { texture: textureId(dye), render_method: "opaque" } };
  const permutations: { condition: When; components: Record<string, unknown> }[] = [];
  for (const entry of def.boxes) {
    const components: Record<string, unknown> = {
      "minecraft:collision_box": entry.collision.length > 0 ? entry.collision.map(bedrockBox) : false,
      "minecraft:selection_box": entry.selection ? bedrockBox(entry.selection) : false,
    };
    permutations.push({ condition: entry.when, components });
  }
  // Bedrock applies every permutation whose condition holds, later ones over earlier: put the boxes'
  // in reverse, so the first that holds is the one that stays.
  permutations.reverse();
  for (const connection of def.connections) {
    if (connection.when) permutations.push({ condition: connection.when, components: { "minecraft:connection_rule": connection.rule } });
  }
  for (const extra of def.extra ?? []) permutations.push({ condition: extra.when, components: extra.components });
  const always = def.connections.find((connection) => connection.when === undefined);
  return {
    format_version: "1.26.0",
    "minecraft:block": {
      description: { identifier: paintBlock(dye, shape), menu_category: { category: "none" }, states: SHAPE_STATES[shape] },
      components: {
        "minecraft:geometry": {
          identifier: geometryId(shape),
          bone_visibility: Object.fromEntries(def.pieces.map((piece) => [piece.name, piece.when === "1.0" ? true : piece.when])),
        },
        "minecraft:material_instances": material,
        "minecraft:light_dampening": 0,
        "minecraft:destructible_by_mining": { seconds_to_destroy: 1.8 },
        "minecraft:destructible_by_explosion": { explosion_resistance: 1.8 },
        ...(always ? { "minecraft:connection_rule": always.rule } : {}),
        // A right click opens or shuts it, as the block it was painted from.
        ...(OPENING_SHAPES.includes(shape) ? { [PAINT_USE]: {} } : {}),
      },
      permutations,
    },
  };
}

/** "Red Paint Fence Gate". */
const title = (dye: string, shape: PaintShape) =>
  `${dye} paint ${shape}`
    .split(/[_ ]/)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");

/** The guns pack's floating rifle (its pickup's look) as the editor's Power-up spot marker. */
const MARKER_GEOMETRY = "geometry.minecade.gun_rifle_display";
const GUNS_GEO = "packs/guns/resource_pack/models/entity/guns.geo.json";
const MARKER_TEXTURE = "packs/guns/resource_pack/textures/minecade/guns/rifle/white.png";
/** The pickup floats this many pixels up (animation.minecade.gun_pickup.float). */
const FLOAT_PIXELS = 10;

function marker(): unknown {
  const geo = JSON.parse(readFileSync(root(GUNS_GEO), "utf8"));
  const found = geo["minecraft:geometry"].find((entry: { description: { identifier: string } }) => entry.description.identifier === MARKER_GEOMETRY);
  if (!found) throw new Error(`${GUNS_GEO} has no ${MARKER_GEOMETRY}`);
  const raise = (point: number[]) => [point[0], point[1] + FLOAT_PIXELS, point[2]];
  const bones = found.bones.map((bone: { pivot: number[]; cubes?: { origin: number[] }[] }) => ({
    ...bone,
    pivot: raise(bone.pivot),
    ...(bone.cubes ? { cubes: bone.cubes.map((entry) => ({ ...entry, origin: raise(entry.origin) })) } : {}),
  }));
  return { format_version: "1.12.0", "minecraft:geometry": [{ ...found, description: { ...found.description, identifier: "geometry.minecade.powerup_marker" }, bones }] };
}

export function paintBlockFiles(): Record<string, string | Buffer> {
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  const dyes = paintDyes(config.teams.defs);
  const files: Record<string, string | Buffer> = {};
  const names: string[] = [];
  const sounds: Record<string, unknown> = { format_version: [1, 1, 0] };
  for (const shape of PAINT_SHAPES) {
    const def = SHAPES[shape]();
    files[`resource_pack/models/blocks/paint_${shape}.geo.json`] = json({ format_version: "1.21.0", "minecraft:geometry": [geometry(shape, def)] });
    for (const dye of dyes) {
      files[`behavior_pack/blocks/paint_${dye}_${shape}.json`] = json(block(dye, shape, def));
      sounds[paintBlock(dye, shape)] = { sound: "stone" };
      names.push(`tile.${paintBlock(dye, shape)}.name=${title(dye, shape)}`);
    }
  }
  files["resource_pack/blocks.json"] = json(sounds);
  files["resource_pack/textures/terrain_texture.json"] = json({
    resource_pack_name: "minecade_paintball",
    texture_name: "atlas.terrain",
    padding: 8,
    num_mip_levels: 4,
    texture_data: Object.fromEntries(dyes.map((dye) => [textureId(dye), { textures: `textures/blocks/concrete_${dye}` }])),
  });
  files["resource_pack/texts/en_US.lang"] = `${names.join("\n")}\n`;
  files["resource_pack/texts/languages.json"] = json(["en_US"]);
  files["markers/powerup.geo.json"] = json(marker());
  files["markers/powerup.png"] = readFileSync(root(MARKER_TEXTURE));
  return files;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const [path, content] of Object.entries(paintBlockFiles())) {
    mkdirSync(dirname(paintball(path)), { recursive: true });
    writeFileSync(paintball(path), content);
  }
  console.log("wrote Paintball's painted blocks and its Power-up spot marker");
}
