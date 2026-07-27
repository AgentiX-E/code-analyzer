import { defineConfig } from 'vitepress';

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: 'Code Analyzer',
  description:
    'World-class code intelligence platform — knowledge graph analysis, PR review, and cross-repo intelligence for AI agents',
  lang: 'en-US',
  base: '/code-analyzer/',
  lastUpdated: true,
  cleanUrls: true,
  ignoreDeadLinks: true,

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/code-analyzer/favicon.svg' }],
  ],

  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    logo: { light: '/code-analyzer/logo-light.svg', dark: '/code-analyzer/logo-dark.svg' },

    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'API', link: '/reference/api-spec' },
      { text: 'GitHub', link: 'https://github.com/AgentiX-E/code-analyzer' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Quick Start', link: '/guide/getting-started' },
            { text: 'Installation', link: '/guide/getting-started#installation' },
            { text: 'Configuration', link: '/guide/configuration' },
            { text: 'Troubleshooting', link: '/guide/troubleshooting' },
          ],
        },
        {
          text: 'Core Concepts',
          items: [
            { text: 'Architecture', link: '/guide/architecture' },
            { text: 'Language Support', link: '/guide/language-support' },
          ],
        },
        {
          text: 'Features',
          items: [
            { text: 'Code Review', link: '/guide/code-review' },
            { text: 'PR Review', link: '/guide/pr-review' },
            { text: 'GitHub Integration', link: '/guide/github-integration' },
            { text: 'Web Dashboard', link: '/guide/web-dashboard' },
            { text: 'MCP Server', link: '/guide/mcp-server' },
          ],
        },
        {
          text: 'Integrations',
          items: [
            { text: 'Overview', link: '/guide/integrations' },
            { text: 'Claude Code', link: '/guide/integration/claude-code' },
            { text: 'Cursor', link: '/guide/integration/cursor' },
            { text: 'Windsurf', link: '/guide/integration/windsurf' },
            { text: 'Continue.dev', link: '/guide/integration/continue-dev' },
            { text: 'Aider', link: '/guide/integration/aider' },
            { text: 'Cline', link: '/guide/integration/cline' },
            { text: 'GitHub Copilot', link: '/guide/integration/github-copilot' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'API Reference',
          items: [
            { text: 'REST API', link: '/reference/api-spec' },
          ],
        },
        {
          text: 'Packages',
          items: [
            { text: 'Shared', link: '/reference/packages/shared' },
            { text: 'Core', link: '/reference/packages/core' },
            { text: 'Infra', link: '/reference/packages/infra' },
            { text: 'Analyzer', link: '/reference/packages/analyzer' },
            { text: 'Intelligence', link: '/reference/packages/intelligence' },
            { text: 'MCP', link: '/reference/packages/mcp' },
            { text: 'Server', link: '/reference/packages/server' },
            { text: 'CLI', link: '/reference/packages/cli' },
            { text: 'VS Code', link: '/reference/packages/vscode' },
            { text: 'Web', link: '/reference/packages/web' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/AgentiX-E/code-analyzer' },
    ],

    search: {
      provider: 'local',
    },

    editLink: {
      pattern: 'https://github.com/AgentiX-E/code-analyzer/edit/main/docs/:path',
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: `Copyright © 2024–${new Date().getFullYear()} Lambertyan`,
    },
  },
});
