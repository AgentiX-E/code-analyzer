// @code-analyzer/cli — Agent Integration Command
//
// Usage: code-analyzer agent [subcommand]
//
// Subcommands:
//   detect    – detect installed AI agents
//   configure – configure all detected agents
//   list      – list all supported agents
//   status    – show configuration status
//

import { Command } from 'commander';
import type { SupportedAgent } from '../agent-setup.js';
import { AgentSetupManager } from '../agent-setup.js';

export function createAgentCommand(): Command {
  const manager = new AgentSetupManager();

  const agent = new Command('agent').description(
    'Detect and configure AI coding agent integrations',
  );

  // -----------------------------------------------------------------------
  // detect — List installed agents
  // -----------------------------------------------------------------------

  agent
    .command('detect')
    .description('Detect installed AI coding agents on this system')
    .action(() => {
      const installed = manager.detectInstalled();

      if (installed.length === 0) {
        console.log('No supported AI coding agents detected.');
        console.log('');
        console.log('Run `code-analyzer agent list` to see supported agents.');
        return;
      }

      console.log(`Detected ${installed.length} agent(s):`);
      for (const id of installed) {
        const config = manager.getConfig(id);
        const configured = manager.isConfigured(id)
          ? ' (configured)'
          : ' (not configured)';
        console.log(`  - ${config.displayName}${configured}`);
      }
    });

  // -----------------------------------------------------------------------
  // configure — Set up agents
  // -----------------------------------------------------------------------

  agent
    .command('configure')
    .description('Configure detected or specified agents to use code-analyzer')
    .option('-a, --all', 'Configure all supported agents')
    .option(
      '-t, --target <agents>',
      'Comma-separated list of agent IDs to configure',
    )
    .option('--dry-run', 'Show what would be configured without making changes')
    .action((options: { all?: boolean; target?: string; dryRun?: boolean }) => {
      let agents: SupportedAgent[];

      if (options.all) {
        agents = manager.getAllConfigs().map((c) => c.name);
      } else if (options.target) {
        agents = options.target.split(',').map((s) => s.trim()) as SupportedAgent[];
      } else {
        agents = manager.detectInstalled();
      }

      if (agents.length === 0) {
        console.log(
          'No agents to configure. Run `code-analyzer agent detect` first.',
        );
        return;
      }

      if (options.dryRun) {
        console.log('[DRY RUN] Would configure the following agents:');
        for (const id of agents) {
          const config = manager.getConfig(id);
          console.log(`  - ${config.displayName} → ${config.configPath}`);
        }
        return;
      }

      console.log(`Configuring ${agents.length} agent(s)...`);
      const results = manager.configureAgents(agents);

      let success = 0;
      let fail = 0;
      for (const r of results) {
        if (r.configured) {
          console.log(`  OK  ${r.message}`);
          success++;
        } else {
          console.error(`  FAIL ${r.message}`);
          fail++;
        }
      }

      console.log('');
      console.log(`Done: ${success} configured, ${fail} failed.`);
    });

  // -----------------------------------------------------------------------
  // list — Show all supported agents
  // -----------------------------------------------------------------------

  agent
    .command('list')
    .description('List all supported AI coding agent integrations')
    .action(() => {
      const configs = manager.getAllConfigs();

      console.log('Supported AI Coding Agent Integrations');
      console.log('======================================');
      console.log('');

      for (const config of configs) {
        const installed = manager.detectInstalled().includes(config.name);
        const configured = manager.isConfigured(config.name);
        const status = installed
          ? configured
            ? 'installed + configured'
            : 'installed'
          : 'not installed';

        console.log(`  ${config.displayName}`);
        console.log(`    ID:          ${config.name}`);
        console.log(`    Config:      ~/${config.configPath}`);
        console.log(`    Format:      ${config.configFormat}`);
        console.log(`    Status:      ${status}`);
        console.log('');
      }
    });

  // -----------------------------------------------------------------------
  // status — Show current configuration status
  // -----------------------------------------------------------------------

  agent
    .command('status')
    .description('Show configuration status for all agents')
    .action(() => {
      console.log(manager.getStatusReport());
    });

  return agent;
}
