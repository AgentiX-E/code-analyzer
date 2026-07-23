#!/usr/bin/env node
// @code-analyzer/cli — Command Line Interface

import { Command } from 'commander';
import { createAgentCommand } from './commands/agent.js';

const program = new Command();

program
  .name('code-analyzer')
  .description('World-class code intelligence platform')
  .version('0.1.0');

program
  .command('analyze')
  .description('Index a repository into the knowledge graph')
  .argument('<path>', 'Path to the repository')
  .action((_path: string) => {
    console.log(`Analyzing ${_path}...`);
  });

program
  .command('search')
  .description('Search the knowledge graph')
  .argument('<query>', 'Search query')
  .action((_query: string) => {
    console.log(`Searching for "${_query}"...`);
  });

// Agent integration commands
program.addCommand(createAgentCommand());

program.parse();
