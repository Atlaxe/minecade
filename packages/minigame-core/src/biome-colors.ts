// Written by tools/assets/biome-colors.ts from the Minecraft client's vanilla packs: rerun it after a
// game update, don't edit by hand. Each biome's water, grass and foliage colors as the client draws
// them (the map editor's Colors tool's presets), and plains' client biome without those three (a
// map's colors pack keeps the rest: tools/maps/colors-pack.ts).

/** A biome's colors: its Bedrock id, its name (Java's), and its water, grass and foliage as "#RRGGBB". */
export interface BiomeColors {
  id: string;
  name: string;
  water: string;
  grass: string;
  foliage: string;
}

/** Every biome, by name. */
export const BIOME_COLORS: readonly BiomeColors[] = [
  { id: "mesa", name: "Badlands", water: "#4E7F81", grass: "#90814D", foliage: "#AEA42A" },
  { id: "mesa_plateau", name: "Badlands Plateau", water: "#55809E", grass: "#BEB654", foliage: "#AEA42A" },
  { id: "bamboo_jungle", name: "Bamboo Jungle", water: "#14A2C5", grass: "#58CB3C", foliage: "#30BB0B" },
  { id: "bamboo_jungle_hills", name: "Bamboo Jungle Hills", water: "#1B9ED8", grass: "#58CB3C", foliage: "#30BB0B" },
  { id: "basalt_deltas", name: "Basalt Deltas", water: "#3F76E4", grass: "#BEB654", foliage: "#AEA42A" },
  { id: "beach", name: "Beach", water: "#157CAB", grass: "#92BC58", foliage: "#77AB2F" },
  { id: "birch_forest", name: "Birch Forest", water: "#0677CE", grass: "#88BA67", foliage: "#6BA941" },
  { id: "birch_forest_hills", name: "Birch Forest Hills", water: "#0A74C4", grass: "#88BA67", foliage: "#6BA941" },
  { id: "cherry_grove", name: "Cherry Grove", water: "#5DB7EF", grass: "#B6DB61", foliage: "#B6DB61" },
  { id: "cold_ocean", name: "Cold Ocean", water: "#2080C9", grass: "#8DB870", foliage: "#71A74D" },
  { id: "crimson_forest", name: "Crimson Forest", water: "#905957", grass: "#BEB654", foliage: "#AEA42A" },
  { id: "dappled_forest", name: "Dappled Forest", water: "#375154", grass: "#DF6827", foliage: "#E68E30" },
  { id: "roofed_forest", name: "Dark Forest", water: "#3B6CD1", grass: "#507932", foliage: "#59AE30" },
  { id: "roofed_forest_mutated", name: "Dark Forest Hills", water: "#44AFF5", grass: "#79BF5A", foliage: "#59AE30" },
  { id: "deep_cold_ocean", name: "Deep Cold Ocean", water: "#2080C9", grass: "#8DB870", foliage: "#71A74D" },
  { id: "deep_dark", name: "Deep Dark", water: "#44AFF5", grass: "#92BC58", foliage: "#77AB2F" },
  { id: "deep_frozen_ocean", name: "Deep Frozen Ocean", water: "#2570B5", grass: "#8DB870", foliage: "#71A74D" },
  { id: "deep_lukewarm_ocean", name: "Deep Lukewarm Ocean", water: "#0D96DB", grass: "#8DB870", foliage: "#71A74D" },
  { id: "deep_ocean", name: "Deep Ocean", water: "#1787D4", grass: "#8DB870", foliage: "#71A74D" },
  { id: "deep_warm_ocean", name: "Deep Warm Ocean", water: "#02B0E5", grass: "#8DB870", foliage: "#71A74D" },
  { id: "desert", name: "Desert", water: "#32A598", grass: "#BEB654", foliage: "#AEA42A" },
  { id: "desert_hills", name: "Desert Hills", water: "#1A7AA1", grass: "#BEB654", foliage: "#AEA42A" },
  { id: "desert_mutated", name: "Desert Lakes", water: "#44AFF5", grass: "#BEB654", foliage: "#AEA42A" },
  { id: "dripstone_caves", name: "Dripstone Caves", water: "#44AFF5", grass: "#8CB489", foliage: "#70A26C" },
  { id: "mesa_bryce", name: "Eroded Badlands", water: "#497F99", grass: "#90814D", foliage: "#AEA42A" },
  { id: "flower_forest", name: "Flower Forest", water: "#20A3CC", grass: "#79BF5A", foliage: "#59AE30" },
  { id: "forest", name: "Forest", water: "#1E97F2", grass: "#79BF5A", foliage: "#59AE30" },
  { id: "frozen_ocean", name: "Frozen Ocean", water: "#2570B5", grass: "#80B496", foliage: "#60A17B" },
  { id: "frozen_peaks", name: "Frozen Peaks", water: "#44AFF5", grass: "#80B496", foliage: "#60A17B" },
  { id: "frozen_river", name: "Frozen River", water: "#185390", grass: "#80B496", foliage: "#60A17B" },
  { id: "redwood_taiga_hills_mutated", name: "Giant Spruce Taiga Hills", water: "#44AFF5", grass: "#86B67F", foliage: "#68A55F" },
  { id: "mega_taiga_hills", name: "Giant Tree Taiga Hills", water: "#286378", grass: "#86B67F", foliage: "#68A55F" },
  { id: "extreme_hills_plus_trees_mutated", name: "Gravelly Mountains+", water: "#0E63AB", grass: "#8AB488", foliage: "#6DA36B" },
  { id: "grove", name: "Grove", water: "#44AFF5", grass: "#80B496", foliage: "#60A17B" },
  { id: "ice_plains_spikes", name: "Ice Spikes", water: "#14559B", grass: "#80B496", foliage: "#60A17B" },
  { id: "jagged_peaks", name: "Jagged Peaks", water: "#44AFF5", grass: "#80B496", foliage: "#60A17B" },
  { id: "jungle", name: "Jungle", water: "#14A2C5", grass: "#58CB3C", foliage: "#30BB0B" },
  { id: "jungle_hills", name: "Jungle Hills", water: "#1B9ED8", grass: "#58CB3C", foliage: "#30BB0B" },
  { id: "legacy_frozen_ocean", name: "Legacy Frozen Ocean", water: "#44AFF5", grass: "#80B496", foliage: "#60A17B" },
  { id: "lukewarm_ocean", name: "Lukewarm Ocean", water: "#0D96DB", grass: "#8DB870", foliage: "#71A74D" },
  { id: "lush_caves", name: "Lush Caves", water: "#44AFF5", grass: "#B8B55B", foliage: "#A6A432" },
  { id: "mangrove_swamp", name: "Mangrove Swamp", water: "#3A7A6A", grass: "#4C763C", foliage: "#8DB127" },
  { id: "meadow", name: "Meadow", water: "#44AFF5", grass: "#86B67F", foliage: "#68A55F" },
  { id: "mesa_plateau_mutated", name: "Modified Badlands Plateau", water: "#44AFF5", grass: "#90814D", foliage: "#AEA42A" },
  { id: "jungle_mutated", name: "Modified Jungle", water: "#1B9ED8", grass: "#58CB3C", foliage: "#30BB0B" },
  { id: "jungle_edge_mutated", name: "Modified Jungle Edge", water: "#44AFF5", grass: "#64C83F", foliage: "#3EB80F" },
  { id: "mesa_plateau_stone_mutated", name: "Modified Wooded Badlands Plateau", water: "#44AFF5", grass: "#90814D", foliage: "#AEA42A" },
  { id: "extreme_hills_edge", name: "Mountain Edge", water: "#045CD5", grass: "#8AB488", foliage: "#6DA36B" },
  { id: "mushroom_island_shore", name: "Mushroom Field Shore", water: "#818193", grass: "#55CA3F", foliage: "#2BBB0F" },
  { id: "mushroom_island", name: "Mushroom Fields", water: "#8A8997", grass: "#55CA3F", foliage: "#2BBB0F" },
  { id: "hell", name: "Nether Wastes", water: "#905957", grass: "#BEB654", foliage: "#AEA42A" },
  { id: "ocean", name: "Ocean", water: "#1787D4", grass: "#8DB870", foliage: "#71A74D" },
  { id: "birch_forest_mutated", name: "Old Growth Birch Forest", water: "#44AFF5", grass: "#88BA67", foliage: "#6BA941" },
  { id: "mega_taiga", name: "Old Growth Pine Taiga", water: "#2D6D77", grass: "#86B67F", foliage: "#68A55F" },
  { id: "redwood_taiga_mutated", name: "Old Growth Spruce Taiga", water: "#44AFF5", grass: "#86B583", foliage: "#68A464" },
  { id: "pale_garden", name: "Pale Garden", water: "#76889D", grass: "#778272", foliage: "#878D76" },
  { id: "plains", name: "Plains", water: "#44AFF5", grass: "#92BC58", foliage: "#77AB2F" },
  { id: "river", name: "River", water: "#0084FF", grass: "#8DB870", foliage: "#71A74D" },
  { id: "savanna", name: "Savanna", water: "#2C8B9C", grass: "#BEB654", foliage: "#AEA42A" },
  { id: "savanna_plateau", name: "Savanna Plateau", water: "#2590A8", grass: "#BEB654", foliage: "#AEA42A" },
  { id: "savanna_plateau_mutated", name: "Shattered Savanna Plateau", water: "#44AFF5", grass: "#82C343", foliage: "#64B216" },
  { id: "cold_beach", name: "Snowy Beach", water: "#1463A5", grass: "#82B493", foliage: "#64A278" },
  { id: "ice_mountains", name: "Snowy Mountains", water: "#1156A7", grass: "#80B496", foliage: "#60A17B" },
  { id: "ice_plains", name: "Snowy Plains", water: "#14559B", grass: "#80B496", foliage: "#60A17B" },
  { id: "snowy_slopes", name: "Snowy Slopes", water: "#44AFF5", grass: "#80B496", foliage: "#60A17B" },
  { id: "cold_taiga", name: "Snowy Taiga", water: "#205E83", grass: "#80B496", foliage: "#60A17B" },
  { id: "cold_taiga_hills", name: "Snowy Taiga Hills", water: "#245B78", grass: "#80B496", foliage: "#60A17B" },
  { id: "cold_taiga_mutated", name: "Snowy Taiga Mountains", water: "#205E83", grass: "#80B496", foliage: "#60A17B" },
  { id: "soulsand_valley", name: "Soul Sand Valley", water: "#905957", grass: "#BEB654", foliage: "#AEA42A" },
  { id: "jungle_edge", name: "Sparse Jungle", water: "#0D8AE3", grass: "#64C83F", foliage: "#3EB80F" },
  { id: "stony_peaks", name: "Stony Peaks", water: "#44AFF5", grass: "#9ABD4A", foliage: "#82AC1E" },
  { id: "stone_beach", name: "Stony Shore", water: "#0D67BB", grass: "#8AB488", foliage: "#6DA36B" },
  { id: "sulfur_caves", name: "Sulfur Caves", water: "#34BF89", grass: "#ABA64F", foliage: "#77AB2F" },
  { id: "sunflower_plains", name: "Sunflower Plains", water: "#44AFF5", grass: "#92BC58", foliage: "#77AB2F" },
  { id: "swampland", name: "Swamp", water: "#617B64", grass: "#4C763C", foliage: "#6A7039" },
  { id: "swampland_mutated", name: "Swamp Hills", water: "#617B64", grass: "#4C763C", foliage: "#6A7039" },
  { id: "taiga", name: "Taiga", water: "#287082", grass: "#86B583", foliage: "#68A464" },
  { id: "taiga_hills", name: "Taiga Hills", water: "#236583", grass: "#86B583", foliage: "#68A464" },
  { id: "taiga_mutated", name: "Taiga Mountains", water: "#1E6B82", grass: "#86B583", foliage: "#68A464" },
  { id: "birch_forest_hills_mutated", name: "Tall Birch Hills", water: "#44AFF5", grass: "#79BF5A", foliage: "#59AE30" },
  { id: "the_end", name: "The End", water: "#62529E", grass: "#8DB870", foliage: "#71A74D" },
  { id: "warm_ocean", name: "Warm Ocean", water: "#02B0E5", grass: "#8DB870", foliage: "#71A74D" },
  { id: "warped_forest", name: "Warped Forest", water: "#905957", grass: "#BEB654", foliage: "#AEA42A" },
  { id: "extreme_hills_plus_trees", name: "Windswept Forest", water: "#0E63AB", grass: "#8AB488", foliage: "#6DA36B" },
  { id: "extreme_hills_mutated", name: "Windswept Gravelly Hills", water: "#0E63AB", grass: "#8AB488", foliage: "#6DA36B" },
  { id: "extreme_hills", name: "Windswept Hills", water: "#007BF7", grass: "#8AB488", foliage: "#6DA36B" },
  { id: "savanna_mutated", name: "Windswept Savanna", water: "#2590A8", grass: "#BEB654", foliage: "#AEA42A" },
  { id: "mesa_plateau_stone", name: "Wooded Badlands", water: "#55809E", grass: "#90814D", foliage: "#AEA42A" },
  { id: "forest_hills", name: "Wooded Hills", water: "#056BD1", grass: "#79BF5A", foliage: "#59AE30" },
];

/** Plains' client biome: its file's format version, and its components but water, grass and foliage. */
export const PLAINS_CLIENT_BIOME = {
  formatVersion: "1.21.120",
  components: {
    "minecraft:fog_appearance": {
      "fog_identifier": "minecraft:fog_plains"
    },
    "minecraft:atmosphere_identifier": {
      "atmosphere_identifier": "minecraft:default_atmospherics"
    },
    "minecraft:color_grading_identifier": {
      "color_grading_identifier": "minecraft:default_color_grading"
    },
    "minecraft:lighting_identifier": {
      "lighting_identifier": "minecraft:default_lighting"
    },
    "minecraft:water_identifier": {
      "water_identifier": "minecraft:default_water"
    },
    "minecraft:ambient_sounds": {
      "underwater_addition": {
        "asset": "ambient.underwater.additions",
        "chance": 0.01
      },
      "underwater_loop": "ambient.underwater.loop"
    }
  },
};
