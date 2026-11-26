// The Tests menu's buttons by the word /blockparty:tests takes for each (the user asked, so a test
// opens without the menu: /tests playeranimations shows the Player animations form). main.ts
// registers the words as the command's choices; spike.ts's menu has a button for each, in this order,
// and runs the same thing for the word as for its button.

/** Each button's word, in the menu's order. */
export const TEST_WORDS = [
  "getstar",
  "gotospace",
  "skiptoround",
  "playminigame",
  "endtie",
  "piecesettings",
  "camerashots",
  "jumptest",
  "diceanditems",
  "hold",
  "outcomes",
  "trader",
  "models",
  "lightspaces",
  "playeranimations",
  "transfers",
  "npcs",
  "arenas",
  "testarenas",
  "ride",
  "end",
] as const;

export type TestWord = (typeof TEST_WORDS)[number];

/** The command's enum (main.ts). */
export const TEST_ENUM = "blockparty:test";
