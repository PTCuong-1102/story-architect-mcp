#!/usr/bin/env node

import * as path from 'node:path';
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { StoryProject } from './server/StoryProject.js';
import { registerResources } from './resources/index.js';
import { registerPrompts } from './prompts/index.js';

// CLI Commands
import { runSetupWizard, runInitNovel, runDoctor, runInstallSkill, printHelp } from './cli/index.js';

// Tools: Project Management (runtime project switching)
import { registerProjectManagerTools } from './tools/projectManager.js';

// Tools: Init, Export & Dashboard
import { registerInitTool } from './tools/init.js';
import { registerExportTool } from './tools/export.js';
import { registerDashboardTool } from './tools/dashboard.js';

// Tools: Manuscript Authoring & Scene Management
import { registerManuscriptAuthoringTools } from './tools/manuscript/writeChapter.js';

// Tools: Rescue Suite
import { registerScanMessyProjectTool } from './tools/rescue/scanMessyProject.js';
import { registerAutoRefactorTool } from './tools/rescue/autoRefactorStructure.js';
import { registerSnapshotTools } from './tools/rescue/snapshot.js';

// Tools: Management Suite
import { registerPlotHoleTools } from './tools/management/plotHoles.js';
import { registerStatsTool } from './tools/management/stats.js';
import { registerForeshadowingTools } from './tools/management/foreshadowing.js';
import { registerCharacterStateTools } from './tools/management/characterState.js';

// Tools: Graph & Memory Suite (Phase 3)
import { registerExtractEntitiesTool } from './tools/graph/extractEntities.js';
import { registerMapRelationshipsTool } from './tools/graph/mapRelationships.js';
import { registerQueryContextTool } from './tools/graph/queryContext.js';

// Tools: Analysis Suite (Phase 4)
import { registerDetectTimelineTool } from './tools/analysis/detectTimeline.js';
import { registerAnalyzePacingTool } from './tools/analysis/analyzePacing.js';
import { registerAnalyzeVoiceTool } from './tools/analysis/analyzeVoice.js';
import { registerAnalyzeSentimentTool } from './tools/analysis/analyzeSentiment.js';
import { registerTrackEmotionTool } from './tools/analysis/trackEmotion.js';

// Tools: Generator Suite (Phase 5)
import { registerGenerateWritingPromptTool } from './tools/generatePrompt.js';

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

async function startMcpServer() {
  // Runtime-switchable Project State
  const initialPath = process.argv[2] || null;
  let currentProject: StoryProject | null = initialPath
    ? new StoryProject(path.resolve(initialPath))
    : null;

  const getProject = (): StoryProject => {
    if (!currentProject) {
      throw new Error('Chưa thiết lập dự án. Hãy gọi tool story_set_project trước.');
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

  // ─── Register Tools (28 Tools total) ───
  registerProjectManagerTools(server, setProject, () => currentProject, getCurrentPath);
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
