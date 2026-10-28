// Usage: npm run cmd -- <container-name> <console command...>
// Writes one command to a running BDS container's stdin and prints the next few seconds of output.
import { attachConsole, connectDocker, findContainerByName } from "./docker-util.ts";

const [name, ...rest] = process.argv.slice(2);
if (!name || rest.length === 0) {
  console.error("Usage: npm run cmd -- <container-name> <command...>");
  process.exit(1);
}

const docker = connectDocker();
const container = await findContainerByName(docker, name);
if (!container) {
  console.error(`No container named ${name}`);
  process.exit(1);
}

const serverConsole = await attachConsole(container, true);
serverConsole.send(rest.join(" "));
setTimeout(() => {
  serverConsole.close();
  process.exit(0);
}, 3000);
