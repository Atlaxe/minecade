// The spike's NPCs: one entity of the game's own per role, on the vanilla mob's own model, textures
// and animations (resource_pack/entity/*.entity.json name them; nothing is copied or textured), with
// no AI, so each stands still until the script moves it or plays an animation on it (the plan's
// "Characters"). They stand in two rows in the middle of the test board; hitting one opens its menu:
// the animations the game will play on it, and its vanilla variants (Chris's pig, the Villager's
// biome, profession and level), each an entity property its client entity reads.
//
// From the user's first look: a looping pose (the Enderman's, the raised arms) is held until Stop,
// since a loop "finishes" at once; the Iron Golem and the Zombie hit with the pack's own swings
// (vanilla's attacks run on variables only the mob's AI sets). The Referee celebrates with vanilla's
// celebrating animation, switched on by a property that also shows its separate arms (a Vindicator
// keeps them crossed unless it's angry or celebrating), and raises its crossed arms high with the
// pack's own (the mirror of their usual tilt, held).
import type { Dimension, Entity, Player } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { describeError, showForm, type Scope } from "@minecade/minigame-core";
import type { Vec3 } from "./board.ts";

interface Variant {
  property: string;
  label: string;
  values: readonly string[];
}

interface NpcAnimation {
  label: string;
  /** An animation the entity plays (vanilla's or the pack's), or a bool property that switches one on. */
  animation?: string;
  property?: string;
  /** A looping pose: held until Stop. */
  hold?: boolean;
}

export interface NpcRole {
  id: string;
  name: string;
  /** What the role is in the game, under its name in its menu. */
  role: string;
  animations: readonly NpcAnimation[];
  variants?: readonly Variant[];
}

const VILLAGER_BIOMES = ["Plains", "Desert", "Jungle", "Savanna", "Snow", "Swamp", "Taiga"];
const PROFESSIONS = ["Unskilled", "Farmer", "Fisherman", "Shepherd", "Fletcher", "Librarian", "Cartographer", "Cleric", "Armorer", "Weaponsmith", "Toolsmith", "Butcher", "Leatherworker", "Stonemason", "Nitwit"];

export const NPC_ROLES: readonly NpcRole[] = [
  { id: "chris", name: "Chris", role: "The piggy bank: guide, Star seller, commentator", animations: [], variants: [{ property: "blockparty:variant", label: "Pig", values: ["Temperate", "Warm", "Cold"] }] },
  {
    id: "villager",
    name: "Villager",
    role: "The shopkeeper",
    animations: [{ label: "Raise arms", animation: "animation.villager.raise_arms", hold: true }],
    variants: [
      { property: "blockparty:biome", label: "Biome", values: VILLAGER_BIOMES },
      { property: "blockparty:profession", label: "Profession", values: PROFESSIONS },
      { property: "blockparty:level", label: "Level", values: ["Stone", "Iron", "Gold", "Emerald", "Diamond"] },
    ],
  },
  { id: "witch", name: "Witch", role: "Hosts Chance Time", animations: [] },
  { id: "wandering_trader", name: "Wandering Trader", role: "Trades rare items for a round", animations: [{ label: "Raise arms", animation: "animation.villager.raise_arms", hold: true }] },
  {
    id: "referee",
    name: "Referee",
    role: "Announces duels, takes bets",
    animations: [
      { label: "Celebrate", property: "blockparty:cheer", hold: true },
      { label: "Raise arms high", animation: "animation.blockparty.referee_raise", hold: true },
    ],
  },
  {
    id: "warden",
    name: "Warden",
    role: "The villain",
    animations: [
      { label: "Roar", animation: "animation.warden.roar" },
      { label: "Sonic boom", animation: "animation.warden.sonic_boom" },
      { label: "Sniff", animation: "animation.warden.sniff" },
      { label: "Emerge", animation: "animation.warden.emerge" },
      { label: "Dig", animation: "animation.warden.dig" },
    ],
  },
  {
    id: "enderman",
    name: "Enderman",
    role: "Performs swaps and teleports",
    animations: [
      { label: "Scary face", animation: "animation.enderman.scary_face", hold: true },
      { label: "Carrying", animation: "animation.enderman.carrying", hold: true },
    ],
  },
  { id: "iron_golem", name: "Iron Golem", role: "An item: shakedowns, zombie removal", animations: [{ label: "Hit", animation: "animation.blockparty.golem_hit" }] },
  { id: "zombie", name: "Zombie", role: "An item and a curse: takes coins", animations: [{ label: "Hit", animation: "animation.blockparty.zombie_hit" }] },
  {
    id: "allay",
    name: "Allay",
    role: "Delivers bonus Stars",
    animations: [
      { label: "Dance", animation: "animation.allay.dance" },
      { label: "Fly", animation: "animation.allay.fly" },
    ],
  },
];

/** The animation controller NPC animations play on (playAnimation). */
export const NPC_ANIMATION = "blockparty.npc";
const REST = "animation.blockparty.rest";

export class Npcs {
  private readonly out = new Map<string, Entity>();

  constructor(private readonly scope: Scope) {
    scope.add(() => this.clear());
  }

  get spawned(): boolean {
    return [...this.out.values()].some((entity) => entity.isValid);
  }

  get(id: string): Entity | undefined {
    const entity = this.out.get(id);
    return entity?.isValid ? entity : undefined;
  }

  /** Puts every NPC out in two rows facing south (+z) around `middle`, on the plaza there. Returns what failed. */
  spawn(dimension: Dimension, middle: Vec3): string[] {
    this.clear();
    const failed: string[] = [];
    NPC_ROLES.forEach((role, i) => {
      const row = Math.floor(i / 5);
      const column = i % 5;
      const at = { x: middle[0] - 5 + column * 2.5, y: middle[1], z: middle[2] - 2.5 + row * 4 };
      try {
        const entity = dimension.spawnEntity(`blockparty:${role.id}`, at);
        entity.nameTag = role.name;
        entity.setRotation({ x: 0, y: 0 });
        this.out.set(role.id, entity);
      } catch (error) {
        failed.push(`${role.name}: ${describeError(error)}`);
      }
    });
    return failed;
  }

  clear(): void {
    for (const entity of this.out.values()) {
      try {
        if (entity.isValid) entity.remove();
      } catch {
        // gone
      }
    }
    this.out.clear();
  }

  /** The role of an NPC entity, if it's one of ours. */
  roleOf(entity: Entity): NpcRole | undefined {
    if (!entity.typeId.startsWith("blockparty:")) return undefined;
    return NPC_ROLES.find((role) => `blockparty:${role.id}` === entity.typeId);
  }

  /** An NPC's menu: its animations, then a button per variant that steps it to the next value. */
  async menu(player: Player, entity: Entity, role: NpcRole, say: (text: string) => void): Promise<void> {
    const form = new ActionFormData().title(role.name).body(role.role);
    const actions: (() => void)[] = [];
    for (const { label, animation, property, hold } of role.animations) {
      form.button(`Play: ${label}${hold ? " (held)" : ""}`);
      actions.push(() => {
        if (property) entity.setProperty(property, true);
        if (animation) entity.playAnimation(animation, { controller: NPC_ANIMATION, stopExpression: hold ? "0" : "q.any_animation_finished", blendOutTime: 0.2 });
        say(`${role.name}: ${label}${hold ? ", held until Stop" : ""}`);
      });
    }
    if (role.animations.length > 0) {
      form.button("Stop the animation");
      actions.push(() => {
        for (const { property } of role.animations) if (property) entity.setProperty(property, false);
        entity.playAnimation(REST, { controller: NPC_ANIMATION, stopExpression: "q.any_animation_finished", blendOutTime: 0.2 });
      });
    }
    for (const variant of role.variants ?? []) {
      const now = Number(entity.getProperty(variant.property) ?? 0);
      const next = (now + 1) % variant.values.length;
      form.button(`${variant.label}: ${variant.values[now]} (next: ${variant.values[next]})`);
      actions.push(() => {
        entity.setProperty(variant.property, next);
        say(`${role.name}'s ${variant.label.toLowerCase()}: ${variant.values[next]}`);
      });
    }
    form.button("Face me");
    actions.push(() => {
      const yaw = (Math.atan2(-(player.location.x - entity.location.x), player.location.z - entity.location.z) * 180) / Math.PI;
      entity.setRotation({ x: 0, y: yaw });
    });
    const response = await showForm(this.scope, player, form);
    if (response?.selection === undefined) return;
    try {
      actions[response.selection]?.();
    } catch (error) {
      say(`${role.name}: ${describeError(error)}`);
    }
  }
}

