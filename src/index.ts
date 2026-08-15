#!/usr/bin/env node

import * as path from 'node:path';
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { StoryProject } from './server/StoryProject.js';
import { registerResources } from './resources/index.js';
import { registerPrompts } from './prompts/index.js';

// Tools: Project Management (runtime project switching)
import { registerProjectManagerTools } from './tools/projectManager.js';

// Tools: Init & Export
import { registerInitTool } from './tools/init.js';
import { registerExportTool } from './tools/export.js';

// Tools: Rescue Suite
import { registerScanMessyProjectTool } from './tools/rescue/scanMessyProject.js';
import { registerAutoRefactorTool } from './tools/rescue/autoRefactorStructure.js';
import { registerSnapshotTools } from './tools/rescue/snapshot.js';

// Tools: Management Suite
import { registerPlotHoleTools } from './tools/management/plotHoles.js';
import { registerStatsTool } from './tools/management/stats.js';
import { registerForeshadowingTools } from './tools/management/foreshadowing.js';

// Tools: Graph & Memory Suite (Phase 3)
import { registerExtractEntitiesTool } from './tools/graph/extractEntities.js';
import { registerMapRelationshipsTool } from './tools/graph/mapRelationships.js';
import { registerQueryContextTool } from './tools/graph/queryContext.js';

// Tools: Analysis Suite (Phase 4)
import { registerDetectTimelineTool } from './tools/analysis/detectTimeline.js';
import { registerAnalyzePacingTool } from './tools/analysis/analyzePacing.js';
import { registerAnalyzeVoiceTool } from './tools/analysis/analyzeVoice.js';

// Tools: Generator Suite (Phase 5)
import { registerGenerateWritingPromptTool } from './tools/generatePrompt.js';

// ─── Runtime-switchable Project State ───
// CLI arg vẫn hoạt động như trước (backward-compatible).
// Nếu không truyền arg → chờ story_set_project thiết lập.
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
  version: '0.1.0',
});

// ─── Register Resources ───
registerResources(server, getProject);

// ─── Register Prompts ───
registerPrompts(server, getProject);

// ─── Register Tools (21 Tools total) ───

// Project Management (must be first — enables all other tools)
registerProjectManagerTools(server, setProject, () => currentProject, getCurrentPath);

registerInitTool(server, getProject);
registerExportTool(server, getProject);

registerScanMessyProjectTool(server, getProject);
registerAutoRefactorTool(server, getProject);
registerSnapshotTools(server, getProject);

registerPlotHoleTools(server, getProject);
registerStatsTool(server, getProject);
registerForeshadowingTools(server, getProject);

registerExtractEntitiesTool(server, getProject);
registerMapRelationshipsTool(server, getProject);
registerQueryContextTool(server, getProject);

registerDetectTimelineTool(server, getProject);
registerAnalyzePacingTool(server, getProject);
registerAnalyzeVoiceTool(server, getProject);

registerGenerateWritingPromptTool(server, getProject);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[story-architect-mcp] Server started with 21 tools, 6 static resources, 3 templates, and 5 prompts.`);
  if (initialPath) {
    console.error(`[story-architect-mcp] Initial Project Path: ${path.resolve(initialPath)}`);
  } else {
    console.error(`[story-architect-mcp] No initial project path — use story_set_project to set one.`);
  }
}

main().catch((error) => {
  console.error('[story-architect-mcp] Fatal error:', error);
  process.exit(1);
});
