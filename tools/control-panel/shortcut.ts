// Creates "Minecade Panel" shortcuts on the Desktop and in the Start menu (Windows only).
// Run with `npm run panel:shortcut`. Paths reach PowerShell as environment variables, so
// spaces or quotes in them can't break the script.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
  console.error("Shortcuts are Windows-only. Run `npm run panel` instead.");
  process.exit(1);
}

const panelDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const system32 = join(process.env.SystemRoot ?? "C:\\Windows", "System32");
// VBScript is an optional Windows feature that Microsoft plans to turn off by default.
// Without it, node runs minimized instead of hidden.
const hasVbscript = existsSync(join(system32, "vbscript.dll"));

const env = {
  ...process.env,
  MC_TARGET: hasVbscript ? join(system32, "wscript.exe") : process.execPath,
  MC_ARGS: hasVbscript
    ? `"${join(panelDir, "launch.vbs")}" "${process.execPath}"`
    : `--disable-warning=ExperimentalWarning "${join(panelDir, "panel.ts")}"`,
  MC_DIR: repoRoot,
  MC_ICON: `${join(system32, "shell32.dll")},15`,
  MC_STYLE: hasVbscript ? "1" : "7",
};

const script = `
$shell = New-Object -ComObject WScript.Shell
foreach ($folder in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
  $path = Join-Path $folder 'Minecade Panel.lnk'
  $link = $shell.CreateShortcut($path)
  $link.TargetPath = $env:MC_TARGET
  $link.Arguments = $env:MC_ARGS
  $link.WorkingDirectory = $env:MC_DIR
  $link.IconLocation = $env:MC_ICON
  $link.WindowStyle = [int]$env:MC_STYLE
  $link.Description = 'Start, stop and watch the Minecade servers'
  $link.Save()
  Write-Output $path
}`;

const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
  env,
  encoding: "utf8",
});
if (result.status !== 0) {
  console.error(result.stderr || result.error?.message || "PowerShell failed");
  process.exit(1);
}
console.log(`Created:\n${result.stdout.trim()}`);
if (!hasVbscript) console.log("VBScript is not installed, so the panel's helper starts minimized instead of hidden.");
