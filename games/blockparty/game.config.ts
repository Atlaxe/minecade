import { defineGame } from "@minecade/minigame-core/config";

// Block Party (docs/plans/block-party.md): a board game with minigames between turns. For now it is
// the plan's spike, a test game the lobby lists only while DEV_TEST_GAMES is 1: on Probe's map it
// lays a small test board (12 spaces in a loop) beside the platform and hands out a Tests menu (the
// last hotbar slot), which tries what the game will need from Bedrock: scripted cameras, three ways
// to walk a piece from space to space, a name over each piece, the jump button while a player is
// locked or carried, a restyled hotbar, the NPCs on the vanilla mobs' models, an arena from another
// map placed beside the board, and a player riding a player or on a lead. Every test says in chat
// what it did, and the hotbar's items say what they are. docs/spike-results.md, "Block Party".
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
  // No maps of its own yet: the spike plays Probe's (a small platform in the void).
  // Probe's maps can do without a spectator or queue spawn (its map.adjustable), so this game can
  // too, as the build's borrow check asks: players then watch from over the first spawn.
  map: { borrow: ["probe"], adjustable: { spectatorOrQueue: { off: true } } },
  /**
   * The test board: 12 spaces around a square, `spacing` blocks apart, its middle `at` (x, y of the
   * spaces' top, z), out beside Probe's platform. Pieces walk at `speed` blocks a second.
   */
  board: { at: [0, 64, 48] as [number, number, number], spacing: 6, speed: 8 },
});
