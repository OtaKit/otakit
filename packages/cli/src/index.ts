#!/usr/bin/env node

import { Command } from 'commander';

import { configCommand } from './commands/config.js';
import { registerCommand } from './commands/register.js';
import { uploadCommand } from './commands/upload.js';
import { releaseCommand } from './commands/release.js';
import { listCommand } from './commands/list.js';
import { deleteCommand } from './commands/delete.js';
import { releasesCommand } from './commands/releases.js';
import { generateSigningKeyCommand } from './commands/generate-signing-key.js';
import { loginCommand } from './commands/login.js';
import { whoamiCommand } from './commands/whoami.js';
import { logoutCommand } from './commands/logout.js';
import { CLI_VERSION } from './lib/version.js';

const program = new Command();

program
  .name('otakit')
  .description('CLI for managing OTA updates')
  .version(CLI_VERSION, '--cli-version', 'Show CLI version');

program.addCommand(configCommand);
program.addCommand(registerCommand);
program.addCommand(uploadCommand);
program.addCommand(releaseCommand);
program.addCommand(listCommand);
program.addCommand(deleteCommand);
program.addCommand(releasesCommand);
program.addCommand(generateSigningKeyCommand);
program.addCommand(loginCommand);
program.addCommand(whoamiCommand);
program.addCommand(logoutCommand);

program.parse();
