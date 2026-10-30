# Shared blocks pack

Custom blocks that maps can use. The build adds this pack to every server (the lobby, every game
and the map editor), the same way it adds the core resource pack, so any server can load a map
that uses these blocks.

- `behavior_pack/`: the block definitions (`manifest.json`, `blocks/`, and so on). No scripts.
- `resource_pack/`: their textures, models and names.

Each half is used only once it has a `manifest.json` and some content, so this slot can stay empty.

Maps that use the blocks are still built in Java and converted to Bedrock with Chunker and your own
block mappings. The map editor never maps blocks: it only prunes Bedrock worlds to Bedrock, and
Chunker keeps blocks it doesn't recognize.

The repository is public, so only add textures you may share.
