# story-architect-mcp

[![MCP Compliant](https://img.shields.io/badge/MCP-Compliant-blue.svg)](https://modelcontextprotocol.io)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> **A Next-Gen Model Context Protocol (MCP) Server for AI-Assisted Novel Writing, Worldbuilding, Continuity Auditing, and Novel Project Architecture.**

---

## 📖 Overview & Philosophy

Writing long-form fiction (epics, thrillers, fantasy sagas, or multi-volume series) presents severe context window, structural, and continuity challenges for AI assistance. As manuscripts grow to tens or hundreds of thousands of words, AI models easily lose track of lore details, character arcs, timeline chronologies, and stylistic tone.

**`story-architect-mcp`** solves this by applying the **"Novels as Codebases"** paradigm:

- **Manuscripts as Modules**: Arcs and chapters organized into structured, modular directories.
- **Lore & Entities as Interfaces**: Characters, locations, and magic/tech systems defined in standardized Markdown files with structured YAML frontmatter.
- **Plot Holes as Bugs / Lint Errors**: Active tracking of unresolved plot holes, broken timeline logic, and unfired foreshadowing setups.
- **Synergy with `codebase-memory-mcp`**: Works seamlessly alongside knowledge-graph indexing servers to provide deep semantic graph queries across your entire story world.

Built on the latest **Model Context Protocol (MCP)** specification with a **Stateless Architecture** (storing transparent state in `.story/`), `story-architect-mcp` provides **18 MCP Tools**, **6 Dynamic Resources**, and **5 Guided Workflow Prompts**.

---

## ✨ Key Capabilities

### 1. 🧹 Project Rescue & Auto-Refactoring
- **`story_scan_messy_project`**: Automatically scans messy, unorganized novel directories, detects file encodings (UTF-8, Windows-1252, etc.), computes content similarity matrices, and classifies files into `Manuscript`, `Notes`, `Lore`, or `Outline` with confidence scores.
- **`story_auto_refactor_structure`**: Restructures loose files into a standardized novel project directory layout. Supports dry-run previews before committing changes.
- **Snapshot & Rollback Protection**: Automatically creates point-in-time project state snapshots (`story_snapshot`) before refactoring, with one-click restoration (`story_rollback`).

### 2. 🔍 Continuity Auditing & Plot Hole Tracking
- **Plot Hole Manager**: Log unresolved plot inconsistencies (`story_log_plot_hole`) and track resolution statuses (`story_resolve_plot_hole`).
- **Chekhov's Gun Tracker**: Log setup details (`story_log_setup`) and payoff moments (`story_log_payoff`) to ensure every planted detail is resolved.
- **Timeline Conflict Detection**: Analyzes absolute/relative dates, character ages, and event chronologies (`story_detect_timeline_conflicts`), outputting interactive **Mermaid Gantt charts**.

### 3. 🧠 Graph Memory & Character Bible Integration
- **Entity Extraction**: Automatically extracts characters and locations from chapter drafts into the `bible/` folder with YAML frontmatter (`story_extract_entities_to_bible`).
- **Relationship Matrix**: Maps evolving inter-character relationships (allies, rivals, romance, enemies) over story progress into `.story/relationships.json` (`story_map_relationships`).
- **Context Budget Querying**: Smart context extractor (`story_query_context`) that combines knowledge graph traversal with vector search to build token-budget-optimized context packages for AI prompts.

### 4. 📈 Pacing, Voice & Analytics
- **Pacing Analysis**: Measures Action / Dialogue / Description balance and scene tension curves (`story_analyze_pacing`).
- **Voice Drift Monitoring**: Analyzes sentence length, vocabulary richness, and POV/tense compliance against your `.story/style_guide.json` reference (`story_analyze_voice`).
- **Writing Statistics**: Real-time total word count, writing velocity tracking, and estimated completion dates (`story_stats`).

### 5. ✍️ AI Writing Prompt Generator & Publishing
- **Context-Aware Prompt Generator**: Assembles prior chapter summaries, active character profiles, outline notes, and style rules into ready-to-use LLM system prompts (`story_generate_writing_prompt`).
- **Multi-Format Export**: Compiles manuscript files into single Markdown, EPUB, PDF, or DOCX formats with customizable front matter and table of contents (`story_export`).

---

## 📁 Standardized Project Layout

`story-architect-mcp` initializes or refactors novel projects into the following clean architecture:

```text
my-epic-novel/
├── .cbm/                        # Knowledge graph cache (codebase-memory-mcp)
├── .story/                      # Project metadata & transparent state
│   ├── config.json              # Project configuration (Title, Author, Genre, POV, Tense)
│   ├── status.json              # Progress tracking, word counts, target completion
│   ├── timeline.json            # Absolute & relative event timelines
│   ├── unresolved_holes.json    # Active plot hole registry
│   ├── relationships.json       # Dynamic character relationship graph
│   ├── foreshadowing.json       # Chekhov's gun tracker (Setups & Payoffs)
│   ├── style_guide.json         # Voice, tone, sentence constraints, reference excerpts
│   └── snapshots/               # Version snapshots for rollback protection
├── bible/                       # Story Bible & Worldbuilding Lore
│   ├── characters/              # Character profiles with YAML frontmatter
│   ├── world/                   # Locations, factions, history, lore
│   └── subplots/                # Subplot tracking & arc objectives
├── manuscript/                  # Official Manuscript Drafts
│   ├── arc_01/
│   │   ├── ch_001.md
│   │   └── ch_002.md
├── drafts_raw/                  # Loose, unorganized writing snippets
└── outline/                     # Master Outline & Chapter Beats
    ├── synopsis.md              # High-level story synopsis
    ├── themes.md                # Core themes & motifs
    └── arc_01/
        ├── overview.md          # Arc summary
        └── ch_001_outline.md    # Detailed scene beats per chapter
```

---

## 🚀 Quick Start

### Installation

Install globally or locally via `npm`:

```bash
npm install -g story-architect-mcp
```

Or build directly from source:

```bash
git clone https://github.com/PTCuong-1102/story-architect-mcp.git
cd story-architect-mcp
npm install
npm run build
```

---

## ⚙️ MCP Client Configuration

Add `story-architect-mcp` to your MCP client configuration (e.g., Claude Desktop, Cursor, Antigravity, Windsurf).

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "story-architect": {
      "command": "npx",
      "args": ["-y", "story-architect-mcp", "/path/to/your/novel-project"]
    }
  }
}
```

### Local Build Execution

```json
{
  "mcpServers": {
    "story-architect": {
      "command": "node",
      "args": ["/absolute/path/to/story-architect-mcp/dist/index.js", "/path/to/your/novel-project"]
    }
  }
}
```

---

## 🛠️ MCP Primitives Reference

### 1. MCP Tools (18 Tools)

| Tool Name | Parameters | Description |
|---|---|---|
| `story_init` | `template`, `title`, `author`, `genre`, `pov`, `tense` | Initializes project directory with template (`fantasy-epic`, `mystery-thriller`, `romance-modern`). |
| `story_scan_messy_project` | `path` | Scans directory, detects encoding/similarity, and classifies unorganized files. |
| `story_auto_refactor_structure` | `strategy`, `confirm` | Refactors messy project files into standard directory layout (supports dry-run). |
| `story_snapshot` | `description` | Creates a point-in-time state backup in `.story/snapshots/`. |
| `story_rollback` | `snapshot_id`, `confirm` | Restores project state to a designated snapshot. |
| `story_log_plot_hole` | `description`, `severity`, `location`, `suggested_fix` | Registers an unresolved plot hole or contradiction. |
| `story_resolve_plot_hole` | `hole_id`, `resolution_note` | Marks a plot hole as resolved or dismissed. |
| `story_log_setup` | `title`, `description`, `chapter`, `character` | Logs a foreshadowing setup (Chekhov's Gun). |
| `story_log_payoff` | `setup_id`, `payoff_chapter`, `description` | Marks a foreshadowing setup as paid off. |
| `story_extract_entities_to_bible` | `chapter_path`, `confirm` | Extracts new characters/locations into `bible/` Markdown files. |
| `story_map_relationships` | `chapter_range` | Builds/updates character relationship matrix across chapters. |
| `story_query_context` | `query`, `budget_tokens` | Extracts context package using graph memory + vector search. |
| `story_detect_timeline_conflicts` | `arc_id` | Audits chronology for conflicts & outputs Mermaid Gantt timeline. |
| `story_analyze_pacing` | `chapter_range` | Computes Action/Dialogue/Description ratio and tension curve. |
| `story_analyze_voice` | `chapter_range` | Checks sentence length, vocabulary, and voice drift against style guide. |
| `story_generate_writing_prompt` | `target_chapter_id`, `strategy` | Assembles context-rich LLM writing system prompt. |
| `story_stats` | *none* | Computes total word counts, writing velocity, and completion progress. |
| `story_export` | `format`, `output_path`, `include_outline` | Exports manuscript to single Markdown, EPUB, PDF, or DOCX. |

### 2. MCP Resources (6 Dynamic Resources)

| Resource URI | Description |
|---|---|
| `story://status` | Live project progress, word counts, and completion status. |
| `story://config` | Project configuration settings (Genre, POV, Tense, Target Word Count). |
| `story://timeline` | Story timeline events and chronological entries. |
| `story://holes` | Unresolved plot holes and continuity warnings. |
| `story://foreshadowing` | Unfired foreshadowing setups and resolution tracking. |
| `story://relationships` | Current character relationship matrix and entity states. |

### 3. MCP Workflow Prompts (5 Prompts)

- **`write-next-chapter`**: Gathers lore, preceding chapter text, outline beats, and style rules into an optimized writing prompt.
- **`character-deep-dive`**: Aggregates a character's Bible entry alongside all scene appearances across the manuscript.
- **`continuity-audit`**: Runs a full arc scan to detect timeline errors, term inconsistencies, and unresolved setups.
- **`rescue-project`**: Step-by-step guided workflow for scanning, previewing, and refactoring chaotic manuscript folders.
- **`brainstorm-scene`**: Generates 3-5 distinct scene execution directions based on current outline and plot state.

---

## 🛡️ Data Safety & Dry-Run Protocol

`story-architect-mcp` prioritizes manuscript data integrity:

1. **Dry-Run First (`confirm: false`)**: All destructive or structural refactoring tools run in Preview mode by default. You can inspect exact proposed file moves and edits before confirming execution (`confirm: true`).
2. **Automated Pre-Refactor Snapshots**: Executing structural changes automatically triggers `story_snapshot` to create a rollback checkpoint prior to file operations.

---

## 🤝 Contributing

Contributions, bug reports, and feature requests are welcome!

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
