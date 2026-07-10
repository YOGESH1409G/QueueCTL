#!/usr/bin/env node

import { Command } from 'commander';

import { registerCommands } from './commands/index.js';
import { APP_DESCRIPTION, APP_NAME, APP_VERSION } from './constants/app.constants.js';
import './utils/env.js';

export function buildProgram() {
  const program = new Command();

  program
    .name(APP_NAME)
    .description(APP_DESCRIPTION)
    .version(APP_VERSION)
    .showHelpAfterError()
    .showSuggestionAfterError();

  registerCommands(program);

  return program;
}

const program = buildProgram();

await program.parseAsync(process.argv);

