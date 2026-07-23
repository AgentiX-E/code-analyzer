#!/usr/bin/env node
// @code-analyzer/cli — Command Line Interface
// Full-featured CLI for Code Analyzer: init, analyze, search, review, status, agent.

import { Command } from 'commander';
import { EOL } from 'node:os';
import { createAgentCommand } from './commands/agent.js';
import { initProject, type InitOptions } from './commands/init.js';
import {
  analyzeRepository,
  formatAnalyzeResult,
  type AnalyzeOptions,
} from './commands/analyze.js';
import {
  searchGraph,
  formatSearchResult,
  type SearchOptions,
} from './commands/search.js';
import {
  getStatus,
  formatStatusReport,
  type StatusOptions,
} from './commands/status.js';
import {
  reviewCode,
  formatReviewResult,
  type ReviewOptions,
} from './commands/review.js';

const program = new Command();

program
  .name('code-analyzer')
  .description(
    'World-class code intelligence platform — analyze, search, and review code with AI-powered tools',
  )
  .version('0.1.0');

// ---------------------------------------------------------------------------
// init — Initialize project configuration
// ---------------------------------------------------------------------------
program
  .command('init')
  .description('Initialize Code Analyzer configuration in a project')
  .option('-d, --directory <path>', 'Target directory', process.cwd())
  .option('-f, --force', 'Overwrite existing configuration')
  .action((opts: { directory?: string; force?: boolean }) => {
    const options: InitOptions = {
      directory: opts.directory,
      force: opts.force,
    };
    const result = initProject(options);
    console.log(result.message);
    if (result.filesExisting.length > 0) {
      console.log(`  Existing: ${result.filesExisting.join(', ')}`);
    }
  });

// ---------------------------------------------------------------------------
// analyze — Index a repository into the knowledge graph
// ---------------------------------------------------------------------------
program
  .command('analyze')
  .description('Analyze and index a repository into the knowledge graph')
  .argument('<path>', 'Path to the repository', '.')
  .option('-f, --format <format>', 'Output format: text, json, or summary', 'text')
  .option('-p, --project-id <id>', 'Project identifier')
  .option('-t, --timeout <ms>', 'Timeout in milliseconds', '300000')
  .action(async (repoPath: string, opts: Record<string, string>) => {
    const options: AnalyzeOptions = {
      path: repoPath,
      format: (opts.format as AnalyzeOptions['format']) ?? 'text',
      projectId: opts.projectId,
      timeout: parseInt(opts.timeout, 10) || 300_000,
    };

    process.stdout.write(`Analyzing ${repoPath}...${EOL}`);
    const result = await analyzeRepository(options);
    const output = formatAnalyzeResult(result, options.format ?? 'text');
    console.log(output);
    process.exit(result.success ? 0 : 1);
  });

// ---------------------------------------------------------------------------
// search — Search the knowledge graph
// ---------------------------------------------------------------------------
program
  .command('search')
  .description('Search the code knowledge graph')
  .argument('<query>', 'Search query')
  .option('-f, --format <format>', 'Output format: text, json, or summary', 'text')
  .option('-l, --limit <number>', 'Maximum results', '50')
  .option('-t, --type <type>', 'Filter by node type')
  .option('-v, --verbose', 'Include file content snippets')
  .action(async (query: string, opts: Record<string, string>) => {
    const options: SearchOptions = {
      query,
      format: (opts.format as SearchOptions['format']) ?? 'text',
      limit: parseInt(opts.limit, 10) || 50,
      type: opts.type,
      verbose: opts.verbose,
    };

    const result = await searchGraph(options);
    const output = formatSearchResult(result, options.format ?? 'text');
    console.log(output);
    process.exit(result.success ? 0 : 1);
  });

// ---------------------------------------------------------------------------
// review — Review code changes
// ---------------------------------------------------------------------------
program
  .command('review')
  .description('Review code for quality, security, and maintainability issues')
  .argument('[target]', 'File, directory, or skip for git diff', '.')
  .option('-m, --mode <mode>', 'Review mode: diff, file, or dir', 'file')
  .option('-s, --severity <level>', 'Minimum severity: info, warning, error, critical', 'warning')
  .option('-f, --format <format>', 'Output format: text, json, or markdown', 'text')
  .option('-M, --max-issues <number>', 'Maximum issues to report', '500')
  .action(async (target: string, opts: Record<string, string>) => {
    const options: ReviewOptions = {
      target,
      mode: (opts.mode as ReviewOptions['mode']) ?? 'file',
      severity: (opts.severity as ReviewOptions['severity']) ?? 'warning',
      format: (opts.format as ReviewOptions['format']) ?? 'text',
      maxIssues: parseInt(opts.maxIssues, 10) || 500,
    };

    const result = await reviewCode(options);
    const output = formatReviewResult(result, options.format ?? 'text');
    console.log(output);
    process.exit(result.success ? 0 : 1);
  });

// ---------------------------------------------------------------------------
// status — Show project and index status
// ---------------------------------------------------------------------------
program
  .command('status')
  .description('Show Code Analyzer project and index status')
  .option('-d, --directory <path>', 'Project directory', process.cwd())
  .option('-f, --format <format>', 'Output format: text or json', 'text')
  .option('-v, --verbose', 'Show detailed status')
  .action((opts: Record<string, string>) => {
    const options: StatusOptions = {
      directory: opts.directory,
      format: (opts.format as StatusOptions['format']) ?? 'text',
      verbose: opts.verbose,
    };

    const report = getStatus(options);
    const output = formatStatusReport(report, options.format ?? 'text');
    console.log(output);
  });

// ---------------------------------------------------------------------------
// Agent integration commands
// ---------------------------------------------------------------------------
program.addCommand(createAgentCommand());

// ---------------------------------------------------------------------------
// Parse and execute
// ---------------------------------------------------------------------------
program.parse();
