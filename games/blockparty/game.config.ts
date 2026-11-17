import { ARENA_SLOT, ARENA_SLOT_FOOTPRINT, BLOCK_PARTY_BOARD, defineGame } from "@minecade/minigame-core/config";
import { BOT_COUNTS, LENGTHS } from "./behavior_pack/scripts/board-rules.ts";
import { ARENAS } from "./behavior_pack/scripts/minigames/arenas.ts";
import { STAGE_ADJUSTABLE, STAGE_MARKUP } from "./behavior_pack/scripts/stage-markup.ts";

// Block Party (docs/plans/block-party.md): a board game with minigames between turns, a test game
// the lobby lists only while DEV_TEST_GAMES is 1 until it's whole. It plays the board loop
// (board-loop.ts: turn order, rolls, walking with branches, Stars, coins, rounds, a minigame after
// each round, Versus duels, the winner) on a board map's own spaces, or on Probe's map a small test
// board (12 spaces in a loop) it lays beside the platform. A game one player starts gets bots
// (bots.ts). The spike's Tests menu (the hotbar's) is still there, trying what the game needs from
// Bedrock: scripted cameras, walking a piece from space to space, the jump button while a player is
// locked, a restyled hotbar, the NPCs on the vanilla mobs' models, an arena from another map placed
// beside the board (or in the map's arena slot), and a player riding a player or on a lead. Every
// test says in chat what it did. docs/spike-results.md, "Block Party".
export default defineGame({
  id: "blockparty",
  name: "Block Party",
  description: "Test game for now: the Block Party spike. Cameras, pieces, NPCs and arenas to try.",
  minPlayers: 1,
  maxPlayers: 4,
  test: true,
  waitForPlayersSeconds: 10,
  countdownSeconds: 0,
  // No clock: the tests run until everyone leaves or someone picks End in the Tests menu.
  timeLimitSeconds: 0,
  endDelaySeconds: 3,
  lateJoin: "join",
  nameTags: true,
  combat: { damage: "none", fall: false, outOfBounds: "ignore" },
  respawn: { mode: "none" },
  win: "custom",
  // Boards: spaces (the board kit, BLOCK_PARTY_BOARD: types, shares, blocks, placement rules) and
  // the arena background's slot, a 40 x 60 box arenas load into (docs/plans/block-party.md, "Arena
  // backgrounds"). The spike still plays Probe's maps (a small platform in the void) and its own
  // test board, so a map can turn spaces and the slot off (Checklist Features), as the build's
  // borrow check asks; Probe's maps can do without a spectator or queue spawn, so this game can
  // too (players then watch from over the first spawn). A map with spaces plays on them.
  // The game's length in rounds (the plan's 10, 15 or 20 turns), 15 unless the lobby picks another;
  // and how many bots join a game one player starts (bots.ts), to watch a whole game flow.
  options: [
    { id: "length", label: "Length", values: LENGTHS.map((turns) => ({ value: String(turns), label: `${turns} turns` })) },
    { id: "bots", label: "Bots (playing alone)", values: BOT_COUNTS.map((bots) => ({ value: String(bots), label: bots === 0 ? "No bots" : bots === 1 ? "1 bot" : `${bots} bots` })) },
  ],
  map: {
    borrow: ["probe"],
    board: BLOCK_PARTY_BOARD,
    regions: { [ARENA_SLOT]: { label: "Arena slot", footprint: ARENA_SLOT_FOOTPRINT } },
    // The stage (stage-markup.ts): the podium's lineup, Chris's spot and camera, and the intro's shots.
    points: STAGE_MARKUP,
    adjustable: { spectatorOrQueue: { off: true }, spaces: { off: true }, [`regions.${ARENA_SLOT}`]: { off: true }, ...STAGE_ADJUSTABLE },
  },
  // The minigames' arenas (minigames/arenas.ts): each its own entry in the map editor, its published
  // maps placed into the board's arena slot when it's played. A minigame without one plays on its
  // test arena, laid in code.
  arenas: ARENAS,
  /**
   * The test board: 12 spaces around a square, `spacing` blocks apart, its middle `at` (x, y of the
   * spaces' top, z), out beside Probe's platform. Pieces walk at `speed` blocks a second.
   */
  board: { at: [0, 64, 48] as [number, number, number], spacing: 6, speed: 8 },
});
