# Working in this repo with Claude

More than one Claude session often works here at once, for example one on a milestone and one on
a side task. Sessions in the same folder share its branch, its index and the git stash, so one
session's half-done files can end up in another's commit. To prevent that, every session works on
its own branch in its own git worktree, and merges into `main` when its work is done.

The main checkout is `C:\dev\minecade\network`. The examples below run from there, and the
worktree sits next to it.

## Branch and merge

1. **Look first.** Run `git status --short` and `git worktree list`. Uncommitted changes you didn't
   make belong to another session: leave them alone.
2. **Start a worktree** on a new branch from `main`:
   ```
   git worktree add ../network-<topic> -b <topic> main
   ```
   Do all edits, builds and tests there. Never run `git checkout` or `git switch` in the main
   checkout: that moves the branch under the other session.
3. **Link the tools.** A new worktree has no `node_modules`. Link the main checkout's entries one
   by one instead of installing, and point the two workspace packages at the worktree's own copies.
   Don't link the whole `node_modules` folder with one junction: inside it,
   `@minecade/minigame-core` and `@minecade/orchestrator` are links to the main checkout's
   `packages/minigame-core` and `orchestrator`, so the worktree would typecheck, test and build
   against main's copy of them, not its own changes. Run this from the main checkout (PowerShell):
   ```
   $wt = (Resolve-Path ..\network-<topic>).Path
   New-Item -ItemType Directory "$wt\node_modules\@minecade" | Out-Null
   Get-ChildItem node_modules -Force | Where-Object Name -ne '@minecade' | ForEach-Object {
     if ($_.PSIsContainer) { New-Item -ItemType Junction -Path "$wt\node_modules\$($_.Name)" -Target $_.FullName | Out-Null }
     else { Copy-Item $_.FullName "$wt\node_modules\" }
   }
   New-Item -ItemType Junction -Path "$wt\node_modules\@minecade\minigame-core" -Target "$wt\packages\minigame-core" | Out-Null
   New-Item -ItemType Junction -Path "$wt\node_modules\@minecade\orchestrator" -Target "$wt\orchestrator" | Out-Null
   ```
   Never run `npm install` in a worktree: it writes through the links into the main checkout's
   `node_modules`. `.env` isn't in git either; copy it over only if the task needs it.
4. **Commit on your branch,** naming your own files: `git add <files>`, never `git add -A` or
   `git add .`. Commit messages have no attribution lines.
5. **Check** with `npm run check` in the worktree.
6. **Merge** after each milestone part or side task:
   ```
   git fetch origin
   git -C ../network-<topic> rebase main     (only if main moved since you started)
   npm --prefix ../network-<topic> run check  (again, after a rebase)
   git merge --ff-only <topic>
   git push origin main
   ```
   Fast-forward only, so `main` stays a straight line. The merge updates the main checkout's copy
   of your files. If it refuses because another session has uncommitted changes in the same files,
   stop and ask the user. Don't force it.
7. **Clean up:** remove the `node_modules` links from step 3 one at a time, then the emptied
   folders, then the worktree (PowerShell, from the main checkout):
   ```
   $wt = (Resolve-Path ..\network-<topic>).Path
   Get-ChildItem "$wt\node_modules\@minecade", "$wt\node_modules" -Force |
     Where-Object LinkType -eq Junction | ForEach-Object { cmd /c rmdir $_.FullName }
   Remove-Item "$wt\node_modules\.package-lock.json"
   cmd /c rmdir "$wt\node_modules\@minecade"
   cmd /c rmdir "$wt\node_modules"
   git worktree remove ../network-<topic>
   git branch -d <topic>
   ```
   Never use `rm -rf` or `Remove-Item -Recurse` on `node_modules` or anything in it: they delete
   the real packages through the links. Plain `cmd /c rmdir` (no `/s`) removes a link without
   touching its target, and refuses a folder that still has something in it.
   If Windows keeps the empty folder, delete it once no shell is inside it.

## Also

- **Stash:** every worktree shares one stash. Don't use `git stash` or `git stash pop`; make a
  work-in-progress commit on your branch instead.
- **Deploy** (`docker compose up -d --build`, or Start and Restart in the Panel) only from the main
  checkout, after merging, and only when nobody is online. Every checkout uses the same compose
  project (`name: minecade`), so starting the stack from a worktree replaces the live network with
  that worktree's build.
- **Long milestones:** keep one worktree for the whole milestone and merge after each part, so
  `main` always has the finished parts.
