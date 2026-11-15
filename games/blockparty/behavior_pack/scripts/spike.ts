// Block Party's spike (docs/plans/block-party.md, "Suggested order" 1), played as a test game on
// Probe's map. It lays a 12-space test board beside the platform and gives each player a piece on
// it and a Tests menu in the last hotbar slot (a compass). The menu tries what the game will need:
//   - walking a piece (pieces.ts: the player moved by script, on an invisible mount, or a stand-in;
//     teleported, pushed or gliding; each walk says in chat how it went), watched by everyone
//     through the chase, watch or attached camera, with a name label over each piece;
//   - camera shots (shots.ts), skipped by everyone jumping (a vote);
//   - the jump button: every jump is reported in chat with what was locked at the time (movement,
//     jumping, a scripted camera, riding), and "Roll" floats a die over your head to hit by jumping,
//     then walks you that many spaces;
//   - the restyled hotbar (resource_pack/ui/hud_screen.json): its items say what they are;
//   - the NPCs on the vanilla mobs' models (npcs.ts): hit one for its animations and variants;
//   - arenas from other maps (spike/blockparty/arena-pack.ts installs them as structures in
//     private_packs/arenas/): placed far east of the board, fresh each time;
//   - a player riding a player, on a lead, or carried on a seat that follows them (two players;
//     the first two need private_packs/players/, vanilla's player.json made rideable and leashable).
import { ButtonState, EntityComponentTypes, InputButton, InputPermissionCategory, ItemLockMode, ItemStack, BlockVolume, system, world, type Entity, type Player, type Vector3 } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { Minigame, describeError, draw, log, say, showForm, type GameContext, type Result, type SpawnReason } from "@minecade/minigame-core";
import registry from "#registry";
import type config from "../../game.config.ts";
import { boardBox, build, testSpaces, type Space, type Vec3 } from "./board.ts";
import { Npcs } from "./npcs.ts";
import { DEFAULT_SETTINGS, DRIVERS, METHODS, Pieces, WALK_CAMERAS, lock, unlock, type PieceSettings } from "./pieces.ts";
import { SHOTS, Shots, type ShotId } from "./shots.ts";

type Config = typeof config;

const MENU_ITEM = "minecraft:compass";
/** Stand-ins for the hotbar the game will have (the plan's "Turns and controls"): slot, item, name, what it does. */
const HOTBAR: readonly [number, string, string, string][] = [
  [0, "minecraft:white_concrete", "Die", "Jump to hit it: 1 to 6"],
  [1, "minecraft:light_blue_concrete", "Slow Die", "Jump to hit it: 1 to 3"],
  [2, "minecraft:gold_block", "Golden Die", "Jump to hit it: 5 to 10"],
  [3, "minecraft:totem_of_undying", "Stone Totem", "Roll an extra die next turn"],
  [4, "minecraft:blaze_rod", "Lightning Strike", "The leader gives 10 coins to last place"],
  [5, "minecraft:leather", "Dueling Glove", "A 1v1 duel for 10 coins"],
  [8, MENU_ITEM, "Tests", "Every Block Party test"],
];

type JumpMode = "free" | "lateral" | "movement" | "nojump" | "camera" | "riding";
const JUMP_MODES: readonly { id: JumpMode; label: string }[] = [
  { id: "free", label: "Nothing locked" },
  { id: "lateral", label: "Can't walk (lateral movement off)" },
  { id: "movement", label: "Can't move (movement off)" },
  { id: "nojump", label: "Movement and jump off" },
  { id: "camera", label: "Can't walk, scripted camera on" },
  { id: "riding", label: "Riding an invisible mount" },
];

/** Where arenas are placed: far east of the board, their middle at x and z, their floor from y. */
const ARENA_AT: Vec3 = [2000, 0, 0];
const ARENA_AREA = "minecade:blockparty_arena";
const BOARD_AREA = "minecade:blockparty_board";

interface PlayerTests {
  settings: PieceSettings;
  jumpMode: JumpMode;
  reportJumps: boolean;
  jumpMount?: Entity;
  /** A seat that follows another player (the carry test), and who. */
  seat?: { entity: Entity; carrier: string };
  rolling?: { die: Vector3; resolve: (value: number) => void };
}

export class BlockPartySpike extends Minigame<Config> {
  private spaces: Space[] = [];
  private pieces!: Pieces;
  private npcs!: Npcs;
  private shots!: Shots;
  private readonly tests = new Map<string, PlayerTests>();
  private arena: { id: string; min: Vector3; size: Vector3 } | undefined;
  /** Whether the test board's blocks are down: nobody is put on it before. */
  private boardReady = false;

  constructor(ctx: GameContext, gameConfig: Config) {
    super(ctx, gameConfig);
  }

  private testsOf(player: Player): PlayerTests {
    const key = player.name.toLowerCase();
    let tests = this.tests.get(key);
    if (!tests) {
      tests = { settings: { ...DEFAULT_SETTINGS, speed: this.config.board.speed }, jumpMode: "free", reportJumps: true };
      this.tests.set(key, tests);
    }
    return tests;
  }

  private get middle(): Vec3 {
    return this.config.board.at;
  }

  private tell(player: Player, text: string): void {
    if (player.isValid) player.sendMessage(say.info(text));
  }

  private everyone(text: string): void {
    this.broadcast(say.info(text));
  }

  protected override setup(): void {
    this.spaces = testSpaces(this.middle, this.config.board.spacing);
    const box = boardBox(this.spaces);
    const arenaBox = { min: [ARENA_AT[0] - 100, -64, ARENA_AT[2] - 100] as Vec3, max: [ARENA_AT[0] + 100, 319, ARENA_AT[2] + 100] as Vec3 };
    this.map.extendBounds([box, arenaBox]);
    const watchers = () => world.getAllPlayers();
    this.pieces = new Pieces(this.scope, {
      spaces: () => this.spaces,
      settings: (player) => this.testsOf(player).settings,
      watchers,
      overview: () => [this.middle[0], this.middle[1] + 18, this.middle[2] - 22],
      report: (player, text) => this.tell(player, text),
    });
    this.npcs = new Npcs(this.scope);
    this.shots = new Shots(this.scope, {
      watchers,
      middle: () => this.middle,
      pieceOf: (player) => this.pieces.body(player),
      chris: () => this.npcs.get("chris"),
      say: (text) => this.everyone(text),
    });
    this.scope.subscribe(world.afterEvents.itemUse, ({ source, itemStack }) => {
      if (itemStack.typeId === MENU_ITEM) void this.menu(source);
    });
    this.scope.subscribe(world.afterEvents.entityHitEntity, ({ damagingEntity, hitEntity }) => {
      if (damagingEntity.typeId !== "minecraft:player") return;
      const role = this.npcs.roleOf(hitEntity);
      if (role) void this.npcs.menu(damagingEntity as Player, hitEntity, role, (text) => this.everyone(text));
    });
    this.scope.subscribe(
      world.afterEvents.playerButtonInput,
      ({ player }) => this.jumped(player),
      { buttons: [InputButton.Jump], state: ButtonState.Pressed },
    );
    this.scope.subscribe(world.afterEvents.playerLeave, ({ playerName }) => {
      const tests = this.tests.get(playerName.toLowerCase());
      for (const entity of [tests?.jumpMount, tests?.seat?.entity]) if (entity?.isValid) entity.remove();
      this.tests.delete(playerName.toLowerCase());
      this.pieces.forget(playerName);
    });
    this.scope.interval(() => this.keepSeats(), 1);
    this.scope.add(() => this.cleanUp());
  }

  protected override onStart(): void {
    void this.layBoard();
  }

  protected override async play(): Promise<Result | void> {
    await this.stage("Tests");
    return draw("the tests are over");
  }

  protected override onSpawn(player: Player, _why: SpawnReason): void {
    this.giveHotbar(player);
    if (this.boardReady) system.runTimeout(() => player.isValid && this.pieces.place(player), 10);
  }

  private async layBoard(): Promise<void> {
    const box = boardBox(this.spaces);
    const dimension = world.getDimension("overworld");
    try {
      await world.tickingAreaManager.createTickingArea(BOARD_AREA, { dimension, from: { x: box.min[0], y: box.min[1], z: box.min[2] }, to: { x: box.max[0], y: box.max[1], z: box.max[2] } });
      build(dimension, this.spaces);
      // A plaza in the middle for the NPCs.
      const [mx, my, mz] = this.middle;
      dimension.fillBlocks(new BlockVolume({ x: Math.floor(mx) - 6, y: my - 1, z: Math.floor(mz) - 6 }, { x: Math.floor(mx) + 6, y: my - 1, z: Math.floor(mz) + 6 }), "minecraft:smooth_stone");
    } catch (error) {
      log.warn(`blockparty: laying the test board failed: ${describeError(error)}`);
      this.everyone(`Laying the test board failed: ${describeError(error)}`);
      return;
    }
    this.boardReady = true;
    for (const player of world.getAllPlayers()) this.pieces.place(player);
    this.everyone("Block Party spike: your piece is on the test board. The compass (last slot) has every test. Every jump is reported in chat; hit an NPC for its menu.");
  }

  private giveHotbar(player: Player): void {
    const container = player.getComponent(EntityComponentTypes.Inventory)?.container;
    if (!container) return;
    for (const [slot, id, name, what] of HOTBAR) {
      const item = new ItemStack(id, 1);
      item.nameTag = name;
      item.setLore([what]);
      item.lockMode = ItemLockMode.slot;
      item.keepOnDeath = true;
      container.setItem(slot, item);
    }
  }

  // ---- The menu ---------------------------------------------------------------------------

  private async menu(player: Player): Promise<void> {
    const items: [string, () => void | Promise<void>][] = [
      ["Roll by jumping, then walk", () => this.rollAndWalk(player)],
      ["Walk 1 space", () => this.pieces.walk(player, 1)],
      ["Walk 6 spaces", () => this.pieces.walk(player, 6)],
      ["Piece settings", () => this.settingsForm(player)],
      ["Camera shots", () => this.shotsMenu(player)],
      ["Jump test", () => this.jumpMenu(player)],
      [this.npcs.spawned ? "Take the NPCs away" : "Put the NPCs out", () => this.toggleNpcs()],
      ["Arenas from other maps", () => this.arenaMenu(player)],
      ["Ride, carry and lead (two players)", () => this.rideMenu(player)],
      ["Back to Start", () => this.pieces.reset(player)],
      ["End the test game", () => this.finish(draw("ended from the Tests menu"))],
    ];
    const form = new ActionFormData().title("Block Party tests");
    for (const [label] of items) form.button(label);
    const response = await showForm(this.scope, player, form);
    if (response?.selection === undefined) return;
    try {
      await items[response.selection][1]();
    } catch (error) {
      this.tell(player, `That test failed: ${describeError(error)}`);
    }
  }

  private async settingsForm(player: Player): Promise<void> {
    const tests = this.testsOf(player);
    const s = tests.settings;
    const form = new ModalFormData()
      .title("Piece settings")
      .dropdown("The piece", METHODS.map((m) => m.label), { defaultValueIndex: METHODS.findIndex((m) => m.id === s.method) })
      .dropdown("Moved by", DRIVERS.map((d) => d.label), { defaultValueIndex: DRIVERS.findIndex((d) => d.id === s.driver) })
      .dropdown("Camera while walking", WALK_CAMERAS.map((c) => c.label), { defaultValueIndex: WALK_CAMERAS.findIndex((c) => c.id === s.camera) })
      .slider("Speed (blocks a second)", 2, 16, { valueStep: 1, defaultValue: s.speed })
      .toggle("The pack's walk animation", { defaultValue: s.animation })
      .toggle("A name label over the piece", { defaultValue: s.label })
      .toggle("Hide my own name tag", { defaultValue: s.hideTag })
      .slider("Mount under the space (tenths of a block)", 0, 15, { valueStep: 1, defaultValue: Math.round(s.seatDrop * 10) });
    const response = await showForm(this.scope, player, form);
    const values = response?.formValues;
    if (!values) return;
    const [method, driver, camera, speed, animation, label, hideTag, seatDrop] = values as [number, number, number, number, boolean, boolean, boolean, number];
    tests.settings = { method: METHODS[method].id, driver: DRIVERS[driver].id, camera: WALK_CAMERAS[camera].id, speed, animation, label, hideTag, seatDrop: seatDrop / 10 };
    this.pieces.refresh(player);
    this.tell(player, `Piece: ${METHODS[method].label}; ${DRIVERS[driver].label}; camera ${WALK_CAMERAS[camera].id}; ${speed} blocks a second.`);
  }

  private async shotsMenu(player: Player): Promise<void> {
    const form = new ActionFormData().title("Camera shots").body("Everyone sees the shot. Everyone jumping skips it.");
    for (const shot of SHOTS) form.button(shot.label);
    const response = await showForm(this.scope, player, form);
    if (response?.selection === undefined) return;
    const id: ShotId = SHOTS[response.selection].id;
    if (id === "clear") this.shots.stop();
    else void this.shots.play(id, player);
  }

  private toggleNpcs(): void {
    if (this.npcs.spawned) {
      this.npcs.clear();
      this.everyone("NPCs taken away.");
      return;
    }
    const failed = this.npcs.spawn(world.getDimension("overworld"), this.middle);
    this.everyone(failed.length === 0 ? "NPCs out in the middle of the board. Hit one for its animations and variants." : `Some NPCs failed: ${failed.join("; ")}`);
  }

  // ---- Jumps ------------------------------------------------------------------------------

  private jumped(player: Player): void {
    const tests = this.testsOf(player);
    if (tests.rolling) {
      const { resolve } = tests.rolling;
      tests.rolling = undefined;
      resolve(1 + Math.floor(Math.random() * 6));
      return;
    }
    if (this.shots.vote(player)) return;
    if (!tests.reportJumps) return;
    const startY = player.location.y;
    const camera = tests.jumpMode === "camera" ? "scripted" : "own";
    const state = `test: ${JUMP_MODES.find((m) => m.id === tests.jumpMode)?.label}; walking: ${this.pieces.isWalking(player) ? "yes" : "no"}; riding: ${this.pieces.riding(player) ? "yes" : "no"}; camera: ${camera}`;
    system.runTimeout(() => {
      if (!player.isValid) return;
      const rose = player.location.y - startY;
      this.tell(player, `Jump seen (${state}). ${rose > 0.3 ? `You rose ${rose.toFixed(2)} blocks.` : "You stayed down."}`);
    }, 6);
  }

  private async jumpMenu(player: Player): Promise<void> {
    const tests = this.testsOf(player);
    const form = new ActionFormData().title("Jump test").body(`Now: ${JUMP_MODES.find((m) => m.id === tests.jumpMode)?.label}. Pick one, then jump.`);
    for (const mode of JUMP_MODES) form.button(mode.label);
    form.button(tests.reportJumps ? "Stop reporting jumps" : "Report every jump");
    const response = await showForm(this.scope, player, form);
    if (response?.selection === undefined) return;
    if (response.selection === JUMP_MODES.length) {
      tests.reportJumps = !tests.reportJumps;
      return;
    }
    this.setJumpMode(player, JUMP_MODES[response.selection].id);
  }

  private setJumpMode(player: Player, mode: JumpMode): void {
    const tests = this.testsOf(player);
    unlock(player);
    player.camera.clear();
    if (tests.jumpMount?.isValid) tests.jumpMount.remove();
    tests.jumpMount = undefined;
    player.inputPermissions.setPermissionCategory(InputPermissionCategory.Dismount, true);
    tests.jumpMode = mode;
    const perms = player.inputPermissions;
    if (mode === "lateral" || mode === "camera") perms.setPermissionCategory(InputPermissionCategory.LateralMovement, false);
    if (mode === "movement" || mode === "nojump") perms.setPermissionCategory(InputPermissionCategory.Movement, false);
    if (mode === "nojump") perms.setPermissionCategory(InputPermissionCategory.Jump, false);
    if (mode === "camera") {
      const at = player.location;
      const yaw = (player.getRotation().y * Math.PI) / 180;
      player.camera.setCamera("minecraft:free", { location: { x: at.x - Math.sin(yaw) * 4, y: at.y + 1.8, z: at.z + Math.cos(yaw) * 4 }, facingLocation: { x: at.x, y: at.y + 1, z: at.z } });
    }
    if (mode === "riding") {
      if (this.testsOf(player).settings.method === "mount") {
        this.tell(player, "You're already on your piece's mount: jump away.");
      } else {
        const mount = player.dimension.spawnEntity("blockparty:mount", player.location);
        mount.getComponent("minecraft:rideable")?.addRider(player);
        perms.setPermissionCategory(InputPermissionCategory.Dismount, false);
        tests.jumpMount = mount;
      }
    }
    this.tell(player, `Jump test: ${JUMP_MODES.find((m) => m.id === mode)?.label}. Jump, and the chat says what came through. Pick Nothing locked to go back.`);
  }

  /** The plan's roll: a die floats over your head, you jump to hit it, and your piece walks the number. */
  private async rollAndWalk(player: Player): Promise<void> {
    const tests = this.testsOf(player);
    if (tests.rolling || this.pieces.isWalking(player)) return;
    const body = this.pieces.body(player);
    const at = player.location;
    const die = { x: Math.floor(at.x), y: Math.floor(at.y) + 3, z: Math.floor(at.z) };
    const dimension = player.dimension;
    const block = dimension.getBlock(die);
    const placed = block?.isAir === true;
    if (placed) block?.setType("minecraft:white_concrete");
    if (tests.settings.method === "player") lock(player);
    const yaw = (body.getRotation().y * Math.PI) / 180;
    for (const watcher of world.getAllPlayers()) {
      watcher.camera.setCamera("minecraft:free", { location: { x: at.x - Math.sin(yaw) * 3.5, y: at.y + 0.5, z: at.z + Math.cos(yaw) * 3.5 }, facingLocation: { x: die.x + 0.5, y: die.y, z: die.z + 0.5 } });
    }
    this.everyone(`${player.name} is rolling: jump to hit the die.`);
    const rolled = await new Promise<number>((resolve) => (tests.rolling = { die, resolve }));
    for (const watcher of world.getAllPlayers()) watcher.onScreenDisplay.setTitle(`${rolled}`, { subtitle: player.name, fadeInDuration: 2, stayDuration: 25, fadeOutDuration: 8 });
    await this.scope.wait(12);
    if (placed) dimension.getBlock(die)?.setType("minecraft:air");
    await this.scope.wait(8);
    for (const watcher of world.getAllPlayers()) watcher.camera.clear();
    if (tests.settings.method === "player") unlock(player);
    await this.pieces.walk(player, rolled);
  }

  // ---- Arenas -----------------------------------------------------------------------------

  /** The arenas installed as structures (minecade:arena_<game>_<map>), from the games' own published maps. */
  private installedArenas(): { id: string; label: string }[] {
    const found: { id: string; label: string }[] = [];
    for (const game of registry.games) {
      for (const map of game.maps) {
        if (map.owner) continue;
        const id = `minecade:arena_${game.id}_${map.id}`;
        if (world.structureManager.get(id)) found.push({ id, label: `${game.name}: ${map.name}` });
      }
    }
    return found;
  }

  private async arenaMenu(player: Player): Promise<void> {
    const arenas = this.installedArenas();
    const form = new ActionFormData().title("Arenas from other maps");
    form.body(arenas.length > 0 ? "Placed far east of the board, a fresh copy each time." : "None installed: run spike/blockparty/arena-pack.ts, then Start the network again.");
    const actions: (() => void | Promise<void>)[] = [];
    for (const arena of arenas) {
      form.button(arena.label);
      actions.push(() => this.placeArena(arena.id));
    }
    if (this.arena) {
      form.button("Place it again (fresh)");
      actions.push(() => this.placeArena(this.arena!.id));
      form.button("Back to the board");
      actions.push(() => this.backToBoard());
    }
    const response = await showForm(this.scope, player, form);
    if (response?.selection === undefined) return;
    await actions[response.selection]?.();
  }

  private async placeArena(id: string): Promise<void> {
    const structure = world.structureManager.get(id);
    if (!structure) return;
    const size = structure.size;
    const dimension = world.getDimension("overworld");
    const min = { x: ARENA_AT[0] - Math.floor(size.x / 2), y: ARENA_AT[1], z: ARENA_AT[2] - Math.floor(size.z / 2) };
    const max = { x: min.x + size.x - 1, y: min.y + size.y - 1, z: min.z + size.z - 1 };
    const manager = world.tickingAreaManager;
    if (manager.hasTickingArea(ARENA_AREA)) manager.removeTickingArea(ARENA_AREA);
    let started = system.currentTick;
    await manager.createTickingArea(ARENA_AREA, { dimension, from: min, to: max });
    const loadTicks = system.currentTick - started;
    for (const player of world.getAllPlayers()) player.camera.fade({ fadeTime: { fadeInTime: 0.3, holdTime: 1, fadeOutTime: 0.5 }, fadeColor: { red: 0, green: 0, blue: 0 } });
    await this.scope.wait(6);
    started = Date.now();
    world.structureManager.place(id, dimension, min, { includeEntities: false });
    const ms = Date.now() - started;
    this.arena = { id, min, size };
    const spot = this.standingSpot(min, size);
    for (const player of world.getAllPlayers()) {
      this.pieces.release(player);
      player.teleport(spot);
    }
    this.everyone(`Placed ${id} (${size.x} x ${size.y} x ${size.z}) at ${min.x}, ${min.y}, ${min.z}: its chunks loaded in ${loadTicks} ticks, the placing took ${ms} ms. Break something and Place it again: it comes back whole.`);
  }

  /** The highest spot near the arena's middle with a block underfoot and room to stand. */
  private standingSpot(min: Vector3, size: Vector3): Vector3 {
    const dimension = world.getDimension("overworld");
    const cx = min.x + Math.floor(size.x / 2);
    const cz = min.z + Math.floor(size.z / 2);
    for (let r = 0; r < Math.max(size.x, size.z) / 2; r += 2) {
      for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
        for (let y = min.y + size.y - 2; y > min.y; y--) {
          const at = { x: cx + dx, y, z: cz + dz };
          const below = dimension.getBlock({ ...at, y: y - 1 });
          if (below && !below.isAir && !below.isLiquid && dimension.getBlock(at)?.isAir && dimension.getBlock({ ...at, y: y + 1 })?.isAir) return { x: at.x + 0.5, y, z: at.z + 0.5 };
        }
      }
    }
    return { x: cx + 0.5, y: min.y + size.y + 1, z: cz + 0.5 };
  }

  private backToBoard(): void {
    for (const player of world.getAllPlayers()) this.pieces.place(player);
    const manager = world.tickingAreaManager;
    if (manager.hasTickingArea(ARENA_AREA)) manager.removeTickingArea(ARENA_AREA);
    this.everyone("Back on the board.");
  }

  // ---- Riding and leads -------------------------------------------------------------------

  private async rideMenu(player: Player): Promise<void> {
    const others = world.getAllPlayers().filter((other) => other.name !== player.name);
    const form = new ActionFormData().title("Ride, carry and lead");
    const actions: (() => void)[] = [];
    if (others.length === 0) form.body("These need a second player.");
    for (const other of others) {
      form.button(`Ride ${other.name} (players pack)`);
      actions.push(() => this.ride(player, other));
      form.button(`Ride a seat that follows ${other.name}`);
      actions.push(() => this.seatOn(player, other));
      form.button(`Put me on ${other.name}'s lead (players pack)`);
      actions.push(() => this.lead(player, other));
    }
    form.button("Let go of everything");
    actions.push(() => this.letGo(player));
    const response = await showForm(this.scope, player, form);
    if (response?.selection === undefined) return;
    actions[response.selection]?.();
  }

  private ride(rider: Player, carrier: Player): void {
    this.pieces.release(rider);
    // Vanilla's players are rideable already, by tame parrots only (their shoulders); the players
    // pack lets players on too.
    const rideable = carrier.getComponent("minecraft:rideable");
    if (!rideable?.getFamilyTypes().includes("player")) {
      this.tell(rider, `${carrier.name} can't carry players (riders allowed: ${rideable?.getFamilyTypes().join(", ") ?? "none"}): the players pack (private_packs/players) isn't installed.`);
      return;
    }
    const ok = rideable.addRider(rider);
    this.everyone(ok ? `${rider.name} is riding ${carrier.name}. Sneak to get off.` : `${rider.name} couldn't get on ${carrier.name} (addRider said no).`);
  }

  /** The carry without player.json: a mount kept over the carrier's head each tick, the rider on it. */
  private seatOn(rider: Player, carrier: Player): void {
    this.pieces.release(rider);
    const tests = this.testsOf(rider);
    if (tests.seat?.entity.isValid) tests.seat.entity.remove();
    const at = carrier.location;
    const entity = rider.dimension.spawnEntity("blockparty:mount", { x: at.x, y: at.y + 1.9, z: at.z });
    entity.getComponent("minecraft:rideable")?.addRider(rider);
    tests.seat = { entity, carrier: carrier.name };
    this.everyone(`${rider.name} is on a seat that follows ${carrier.name} (moved each tick). Sneak to get off.`);
  }

  private keepSeats(): void {
    for (const player of world.getAllPlayers()) {
      const seat = this.tests.get(player.name.toLowerCase())?.seat;
      if (!seat) continue;
      const carrier = world.getAllPlayers().find((other) => other.name === seat.carrier);
      if (!seat.entity.isValid || !carrier || !this.pieces.riding(player)) {
        if (seat.entity.isValid) seat.entity.remove();
        this.testsOf(player).seat = undefined;
        continue;
      }
      const at = carrier.location;
      seat.entity.teleport({ x: at.x, y: at.y + 1.9, z: at.z }, { rotation: { x: 0, y: carrier.getRotation().y } });
    }
  }

  private lead(follower: Player, holder: Player): void {
    this.pieces.release(follower);
    const leashable = follower.getComponent("minecraft:leashable");
    if (!leashable) {
      this.tell(follower, "You have no leashable component: the players pack (private_packs/players) isn't installed.");
      return;
    }
    try {
      leashable.leashTo(holder);
      this.everyone(`${follower.name} is on ${holder.name}'s lead. Walk apart and see what pulls.`);
    } catch (error) {
      this.tell(follower, `leashTo failed: ${describeError(error)}`);
    }
  }

  private letGo(player: Player): void {
    const tests = this.testsOf(player);
    if (tests.seat?.entity.isValid) tests.seat.entity.remove();
    tests.seat = undefined;
    try {
      player.getComponent("minecraft:riding")?.entityRidingOn?.getComponent("minecraft:rideable")?.ejectRider(player);
      for (const other of world.getAllPlayers()) other.getComponent("minecraft:rideable")?.ejectRider(player);
      const leashable = player.getComponent("minecraft:leashable");
      if (leashable?.isLeashed) leashable.unleash();
    } catch (error) {
      this.tell(player, `Letting go: ${describeError(error)}`);
    }
    this.pieces.place(player);
  }

  private cleanUp(): void {
    const manager = world.tickingAreaManager;
    for (const id of [ARENA_AREA, BOARD_AREA]) {
      try {
        if (manager.hasTickingArea(id)) manager.removeTickingArea(id);
      } catch {
        // gone with the server
      }
    }
    for (const tests of this.tests.values()) {
      for (const entity of [tests.jumpMount, tests.seat?.entity]) {
        try {
          if (entity?.isValid) entity.remove();
        } catch {
          // gone
        }
      }
    }
    for (const player of world.getAllPlayers()) {
      unlock(player);
      try {
        player.inputPermissions.setPermissionCategory(InputPermissionCategory.Dismount, true);
        player.camera.clear();
      } catch {
        // gone
      }
    }
  }
}
