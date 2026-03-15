#!/usr/bin/env node
import { Command } from "commander";
import App from "./tui/app.js";
import { render } from "ink";
import { stopServer, stopTunnel, uninstallHooks } from "./lib/room.js";

const program = new Command();

program
  .description("Watch your team code, in real-time")
  .action(() => {
    process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
    const cleanup = () => {
      stopTunnel();
      stopServer();
      uninstallHooks(process.cwd());
    };
    process.on("SIGINT", () => { cleanup(); process.exit(0); });
    process.on("exit", cleanup);
    render(<App />, { exitOnCtrlC: true });
  });


// Execute CLI with the args given
program.parse(process.argv)