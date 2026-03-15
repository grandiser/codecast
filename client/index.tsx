#!/usr/bin/env node
import { Command } from "commander";
import App from "./tui/app.js";
import { render } from "ink";
import { cleanupInfrastructure } from "./lib/room.js";

const program = new Command();

program
  .description("Watch your team code, in real-time")
  .action(() => {
    process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
    process.on("exit", cleanupInfrastructure);
    render(<App />, { exitOnCtrlC: true });
  });

program.parse(process.argv)