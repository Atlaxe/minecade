// Block Party's confetti (resource_pack/particles/confetti.json): the particle the game bursts over
// a seat's head for a win or a Star gained (spike.ts, confettiOver).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const FILE = new URL("../resource_pack/particles/confetti.json", import.meta.url);
const SPIKE = new URL("../behavior_pack/scripts/spike.ts", import.meta.url);

describe("Block Party's confetti", () => {
  const particle = JSON.parse(readFileSync(FILE, "utf8")).particle_effect;

  it("is the particle the game spawns, on vanilla's white concrete tinted in party colors", () => {
    expect(particle.description.identifier).toBe("blockparty:confetti");
    expect(readFileSync(SPIKE, "utf8")).toContain(`"${particle.description.identifier}"`);
    expect(particle.description.basic_render_parameters.texture).toBe("textures/blocks/concrete_white");
    const color = particle.components["minecraft:particle_appearance_tinting"].color;
    expect(color).toHaveLength(4);
  });

  it("bursts once and flutters down, landing on what's under it", () => {
    expect(particle.components["minecraft:emitter_lifetime_once"]).toBeDefined();
    expect(particle.components["minecraft:particle_motion_dynamic"].linear_acceleration[1]).toBeLessThan(0);
    expect(particle.components["minecraft:particle_motion_collision"]).toBeDefined();
  });
});
