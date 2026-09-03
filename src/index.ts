#!/usr/bin/env node

import * as path from 'node:path';
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { StoryProject } from './server/StoryProject.js';
import { registerResources } from './resources/index.js';
import { registerPrompts } from './prompts/index.js';
import { NO_PROJECT_MESSAGE } from './utils/mcpResults.js';

// CLI Commands
import { runSetupWizard, runInitNovel, runDoctor, runInstallSkill, printHelp } from './cli/index.js';

// NOTE: Tool modules are deliberately NOT statically imported here.
// They are lazy-loaded inside registerAllTools() via dynamic import so that
// lightweight CLI commands (setup/init/doctor/--help/--version) don't pay
// the cost of loading all tool modules (e.g. the ~1800-entry sentiment
// lexicon, export/zip, knowledge-graph) at startup.

// ─── CLI Command Dispatcher ───
const subCommand = process.argv[2]?.toLowerCase();

async function handleCliOrServer() {
  if (subCommand === 'setup' || subCommand === '--setup') {
    await runSetupWizard(process.argv.slice(3));
    return;
  }
  if (subCommand === 'init-novel' || subCommand === 'init') {
    await runInitNovel(process.argv.slice(3));
    return;
  }
  if (subCommand === 'doctor' || subCommand === '--doctor') {
    await runDoctor(process.argv.slice(3));
    return;
  }
  if (subCommand === 'install-skill') {
    await runInstallSkill(process.argv.slice(3));
    return;
  }
  if (subCommand === '--help' || subCommand === '-h' || subCommand === 'help') {
    printHelp();
    return;
  }
  if (subCommand === '--version' || subCommand === '-v' || subCommand === 'version') {
    console.log('story-architect-mcp v0.2.0');
    return;
  }

  // ─── Default: MCP Server Mode ───
  await startMcpServer();
}

/**
 * Lazy-load và đăng ký toàn bộ tool modules.
 *
 * Dynamic import (thay vì static import ở đầu file) giúp:
 * 1. Các lệnh CLI nhẹ (setup/init/doctor/--help) thoát sớm trong
 *    handleCliOrServer() mà không nạp tool modules nặng.
 * 2. Dễ mở rộng thành selective loading (ví dụ --only=analysis) sau này
 *    mà không phải sửa từng call-site.
 */
async function registerAllTools(
  server: McpServer,
  getProject: () => StoryProject,
  setProject: (projectPath: string) => StoryProject,
  getProjectNullable: () => StoryProject | null,
  getCurrentPath: () => string | null,
): Promise<void> {
  const { registerProjectManagerTools } = await import('./tools/projectManager.js');
  const { registerInitTool } = await import('./tools/init.js');
  const { registerExportTool } = await import('./tools/export.js');
  const { registerDashboardTool } = await import('./tools/dashboard.js');
  const { registerManuscriptAuthoringTools } = await import('./tools/manuscript/writeChapter.js');
  const { registerScanMessyProjectTool } = await import('./tools/rescue/scanMessyProject.js');
  const { registerAutoRefactorTool } = await import('./tools/rescue/autoRefactorStructure.js');
  const { registerSnapshotTools } = await import('./tools/rescue/snapshot.js');
  const { registerPlotHoleTools } = await import('./tools/management/plotHoles.js');
  const { registerStatsTool } = await import('./tools/management/stats.js');
  const { registerForeshadowingTools } = await import('./tools/management/foreshadowing.js');
  const { registerCharacterStateTools } = await import('./tools/management/characterState.js');
  const { registerExtractEntitiesTool } = await import('./tools/graph/extractEntities.js');
  const { registerMapRelationshipsTool } = await import('./tools/graph/mapRelationships.js');
  const { registerQueryContextTool } = await import('./tools/graph/queryContext.js');
  const { registerDetectTimelineTool } = await import('./tools/analysis/detectTimeline.js');
  const { registerAnalyzePacingTool } = await import('./tools/analysis/analyzePacing.js');
  const { registerAnalyzeVoiceTool } = await import('./tools/analysis/analyzeVoice.js');
  const { registerAnalyzeSentimentTool } = await import('./tools/analysis/analyzeSentiment.js');
  const { registerTrackEmotionTool } = await import('./tools/analysis/trackEmotion.js');
  const { registerGenerateWritingPromptTool } = await import('./tools/generatePrompt.js');

  registerProjectManagerTools(server, setProject, getProjectNullable, getCurrentPath);
  registerInitTool(server, getProject);
  registerExportTool(server, getProject);
  registerDashboardTool(server, getProject);

  registerManuscriptAuthoringTools(server, getProject);

  registerScanMessyProjectTool(server, getProject);
  registerAutoRefactorTool(server, getProject);
  registerSnapshotTools(server, getProject);

  registerPlotHoleTools(server, getProject);
  registerStatsTool(server, getProject);
  registerForeshadowingTools(server, getProject);
  registerCharacterStateTools(server, getProject);

  registerExtractEntitiesTool(server, getProject);
  registerMapRelationshipsTool(server, getProject);
  registerQueryContextTool(server, getProject);

  registerDetectTimelineTool(server, getProject);
  registerAnalyzePacingTool(server, getProject);
  registerAnalyzeVoiceTool(server, getProject);
  registerAnalyzeSentimentTool(server, getProject);
  registerTrackEmotionTool(server);

  registerGenerateWritingPromptTool(server, getProject);
}

async function startMcpServer() {
  // Runtime-switchable Project State
  const initialPath = process.argv[2] || null;
  let currentProject: StoryProject | null = initialPath
    ? new StoryProject(path.resolve(initialPath))
    : null;

  const getProject = (): StoryProject => {
    if (!currentProject) {
      // Cùng nội dung với NO_PROJECT_MESSAGE để Resources/Prompts
      // (vốn dùng cơ chế throw → protocol error) đồng nhất với Tools
      // (vốn dùng requireProject → isError result).
      throw new Error(NO_PROJECT_MESSAGE);
    }
    return currentProject;
  };

  const setProject = (projectPath: string): StoryProject => {
    currentProject = new StoryProject(path.resolve(projectPath));
    return currentProject;
  };

  const getCurrentPath = (): string | null => {
    return currentProject?.projectPath ?? null;
  };

  const server = new McpServer({
    name: 'story-architect-mcp',
    version: '0.2.0',
  });

  // ─── Register Resources ───
  registerResources(server, getProject);

  // ─── Register Prompts ───
  registerPrompts(server, getProject);

  // ─── Register Tools (28 Tools total, lazy-loaded) ───
  await registerAllTools(server, getProject, setProject, () => currentProject, getCurrentPath);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[story-architect-mcp] Server started with 28 tools, 8 static resources, 4 templates, and 5 prompts.`);
  if (initialPath) {
    console.error(`[story-architect-mcp] Initial Project Path: ${path.resolve(initialPath)}`);
  } else {
    console.error(`[story-architect-mcp] No initial project path — use story_set_project to set one.`);
  }
}

handleCliOrServer().catch((error) => {
  console.error('[story-architect-mcp] Fatal error:', error);
  process.exit(1);
});
