#!/usr/bin/env node
import { Command } from "commander";
import Counter from "./tui/app.js";
import { render, Text } from "ink";

// Declaring the program
const program = new Command();

// Adding actions to the CLI
program
.description("Renders a TUI")
.action(() => {
    render(<Counter />)
});


// Execute CLI with the args given
program.parse(process.argv)