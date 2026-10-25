import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
const desktopRoot = fileURLToPath(new URL("../apps/desktop/", import.meta.url));
const windowsBuild =
  process.platform === "win32" && ["dev", "build"].includes(args[0]);
const command = windowsBuild ? "powershell.exe" : process.execPath;
const cli = fileURLToPath(
  new URL(
    "../apps/desktop/node_modules/@tauri-apps/cli/tauri.js",
    import.meta.url,
  ),
);
const commandArgs = windowsBuild
  ? [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      fileURLToPath(new URL("./tauri-windows.ps1", import.meta.url)),
      ...args,
    ]
  : [cli, ...args];
const child = spawn(command, commandArgs, {
  stdio: "inherit",
  cwd: desktopRoot,
});
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
