// Wrapper so extra CLI args (e.g. `--port` injected by some runners) don't
// break turbo's argument parsing. Always runs the `dev` task everywhere.
import { spawn } from "node:child_process";

const child = spawn("pnpm", ["exec", "turbo", "run", "dev"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

child.on("exit", (code) => process.exit(code ?? 0));
