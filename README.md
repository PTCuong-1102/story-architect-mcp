
## 💡 The "Novels as Codebases" Paradigm

| Software Engineering Concept | Novel Architecture Equivalent | `story-architect-mcp` Implementation |
|---|---|---|
| **Modules & Packages** | Arcs & Chapters | Standardized `manuscript/arc_01/ch_001.md` structure |
| **Interfaces & Schemas** | Character Bible & Lore | Frontmatter-backed Markdown files in `bible/` |
| **Compiler & Linter** | Continuity & Pacing Auditing | `story_detect_timeline_conflicts`, `story_analyze_voice` |
| **Bug Tracker** | Plot Hole & Chekhov's Gun Registry | `story_log_plot_hole`, `story_log_setup`, `story_log_payoff` |
| **Git & Rollback** | Point-in-Time Snapshots | `story_snapshot` and `story_rollback` safety engine |
| **Dependency Injection** | Context Budgeting | `story_query_context` (Graph Memory + Semantic Search) |

---

## 🆕 What's New in v0.6.0

* **Layout Profiles — novels written before you install story-architect-mcp now get recognized**: the scanner reports how *your* existing novels are actually organized — chapter files nested in custom arc folders ("Quyển 3", "phan 2", "vol 2"...), flat chapter files, one big file containing the whole novel, or unseen multi-novel trees (multiple private novels in one folder tree). Multilingual chapter numbering is parsed: Arabic ("12"), Roman ("XII"), Vietnamese word numbers ("mười hai", "hai mươi mốt"), and CJK ("第十二章").
* **`auto_profile` strategy (new default for `story_auto_refactor_structure`)**: one big file → split into standard `ch_XXX.md` chapters by their headings (titles preserved for EPUB/DOCX tables of content; original archived in `drafts_raw/`); custom arc folders → mapped to `arc_XX` without renaming your files; flat chapters → renumbered. Everything stays dry-run preview + auto-snapshot protected.
* **Multi-novel detection**: `story_scan_messy_project` flags folders that look like *separate* novels sharing one tree, so you can point `story_set_project` at each.

## 🆕 What's New in v0.5.0

* **Timeline Absolute Dates**: `"2025-01-01"` ≡ `"2025-01-01 00:00"` in omnipresence checks (format differences no longer hide conflicts); new conflict #4 flags day↔chapter order inversions (with a flashback heads-up); Mermaid diagrams sort by relativeOrder → parsed date → chapter; `addEvent` feedback tells you whether an ISO date joins conflict detection or is just an in-world display string.
* **BM25 Search Ranking**: `story_query_context` term-level matches are now ranked by BM25 (zero-dep) — rare phrases ("phượng hoàng giáng thế") outweigh common filler words, while exact-name/alias/fuzzy matches keep precedence.
* **`story_prune_snapshots`** (tool #30): safely clean up old snapshots — `keepLast` (default 10) + optional `olderThanDays`, dry-run preview before `confirm: true`, `keepLast < 3` requires explicit confirm, orphaned entries are cleaned from the index, and the report shows MB/KB freed.

## 🆕 What's New in v0.4.0

* **Auto-Stale Index**: The knowledge graph cache (`.cbm/index.json`) now carries a stat fingerprint of its sources; editing bible files outside the tools (by hand, in another editor) is detected automatically — no more manual `rebuildIndex` calls.
* **State History Diff**: `story_track_character_state` `action: "history"` now shows what changed between consecutive milestones — inventory lost/acquired (`−🎒/+🎒`), secrets learned (`+🗝️`), status/condition/location changes — directly in the report.
* **Sentiment `lexicon-v3`**: unaccented negators/intensifiers ("khong vui", "rat vui", "vo cung") now match exactly — unaccented prose no longer gets muted polarity. (Method label is transparent.)
* **Cross-Process Lock Regression Test**: the on-disk lock layer is now protected by a 4-process × 10-RMW contention test (148 unit tests total).
* **EPUB Cover + DOCX TOC**: exports gain an SVG title cover (metadata-driven, zero-dep) and a real Word TOC field with outline levels for the Navigation pane.

## 🆕 What's New in v0.3.0

* **Atomic Writes + Advisory File Locking**: Every `.story/*.json` state file is written atomically (temp-file + rename — readers never see a half-written file), and all read-modify-write operations are serialized through a two-layer lock (in-process mutex + on-disk lock dir with stale-TTL and fail-fast timeout). Safe for multiple MCP clients writing to the same novel.
* **Project Registry & `story_list_projects`**: Server now reuses `StoryProject` instances across switches, and a new tool lists every project opened in the session.
* **Diacritics-insensitive + Fuzzy Graph Matching**: Character/relationship lookups normalize Vietnamese diacritics (`Trăng` ≡ `trang`) and fall back to Levenshtein fuzzy match (±1–2 characters) — queries mistyped by the LLM still resolve.
* **Transparent Lexical Analysis**: `story_analyze_sentiment` now reports its method (`lexicon-v3`) and warns when coverage is too low to trust metaphorical/ironic readings.
* **Richer EPUB/DOCX Export**: EPUB3 gains `dcterms:modified`, richer CSS (justified text, hyphenation, per-section page breaks); DOCX gains page breaks between chapters, justified Normal style, full `docProps` (creator, language, app info), and Times New Roman typography.

---

## ✨ Key Features

### 🧹 1. Messy Project Rescue & Auto-Refactoring
* **Smart File Classifier (`story_scan_messy_project`)**: Scans unorganized manuscript folders, auto-detects character encodings (UTF-8, Windows-1252, ISO-8859-1), computes content similarity matrices, and tags files (`Manuscript`, `Lore`, `Notes`, `Outline`) with confidence scores. **v0.6.0** adds a Layout Profile section — recognizes how the novel was arranged before installation (custom arc folders, flat chapters, single big file, separate novels in one tree) with multilingual chapter numbers.
* **Automated Refactoring (`story_auto_refactor_structure`)**: Reorganizes scattered files into a clean project structure with safe dry-run previews (`confirm: false`). **v0.6.0** adds the `auto_profile` strategy: a single-file novel is split into `manuscript/arc_01/ch_XXX.md` by its chapter headings (Vietnamese word numbers, Roman, Arabic, CJK supported), original archived into `drafts_raw/`; custom arc folders map to `arc_XX` content-preserving.
* **Snapshot & Rollback Protection (`story_snapshot` / `story_rollback`)**: Creates automatic point-in-time state backups prior to file operations.

### 🔍 2. Continuity Auditing & Plot Hole Tracking
* **Plot Hole Manager (`story_log_plot_hole` / `story_resolve_plot_hole`)**: Tracks unresolved plot holes, severity levels, and proposed fixes directly in `.story/unresolved_holes.json`.
* **Chekhov’s Gun Tracker (`story_log_setup` / `story_log_payoff`)**: Ensures planted clues or foreshadowed events are resolved before the story concludes.
* **Timeline Conflict Detector & Parallel Subplots (`story_detect_timeline_conflicts`)**: Audits character omnipresence/teleportation conflicts, event order, and absolute dates across parallel storyline threads, generating interactive **Mermaid Flowchart Diagrams**.
* **Character State & Inventory Tracker (`story_track_character_state`)**: Tracks characters' geographic location, physical condition, inventory items, and acquired secrets chapter-by-chapter to eliminate continuity errors.

### ✍️ 3. Safe Manuscript Authoring & Progress Tracking
* **Direct Chapter Authoring (`story_write_chapter`)**: Saves or updates chapter drafts with automatic pre-write snapshots and real-time word count tracking.
* **Scene Appending (`story_append_scene`)**: Seamlessly appends new scenes and beat breaks without risking the loss of existing chapter text.
* **Manuscript Reader (`story_read_chapter`)**: Retrieves chapter text alongside extracted headings, beats, and statistics.

### 🧠 4. Knowledge Graph & Story Bible Integration
* **Automatic Entity Extraction (`story_extract_entities_to_bible`)**: Parses chapter drafts to automatically create structured Markdown profiles in `bible/characters/` and `bible/world/`.
* **Dynamic Relationship Graph (`story_map_relationships`)**: Tracks changing relationships between characters across chapters into `.story/relationships.json` — can be auto-detected from manuscript co-occurrences or updated manually.
* **Token-Budget Context Querying (`story_query_context`)**: Generates optimized context packages for LLMs by combining graph memory traversal with token budget constraints.

### 📈 5. Pacing, Voice, Sentiment & Analytics Dashboard
* **Pacing Inspector (`story_analyze_pacing`)**: Measures Action / Dialogue / Description distribution and scene tension curves across chapters.
* **Voice Drift Monitor (`story_analyze_voice`)**: Evaluates sentence complexity, vocabulary richness, POV/tense compliance, and dominant emotions against your `.story/style_guide.json`.
* **Sentiment & Tone Analyzer (`story_analyze_sentiment` / `story_track_emotion`)**: Performs lexicon-based emotional arc tracking, polarity calculation, tone classification (8 categories), and tone drift detection across chapters.
* **Visual HTML Dashboard (`story_generate_dashboard`)**: Generates a standalone interactive HTML dashboard (`export/dashboard.html`) summarizing progress, plot holes, and story assets.
* **Writing Statistics (`story_stats`)**: Real-time word counts, writing velocity, and estimated project completion dates.

### 📄 6. AI Prompt Generator & Manuscript Export
* **Context-Rich Prompt Builder (`story_generate_writing_prompt`)**: Automatically compiles lore, recent chapter endings, outline beats, character states, and active Chekhov's guns into an optimized writing prompt.
* **Multi-Format Export (`story_export`)**: Compiles manuscript files into Markdown, HTML, EPUB, or DOCX formats with custom metadata and Table of Contents. (For PDF, export to HTML and print-to-PDF from a browser.)

---

## 📁 Standard Project Architecture

`story-architect-mcp` organizes novel projects into a standardized layout:

```text
my-epic-novel/
├── .story/                      # Project metadata & state tracking
│   ├── config.json              # Title, Author, Genre, POV, Tense
│   ├── status.json              # Word counts & progress tracking
│   ├── timeline.json            # Event chronology, dates & parallel threads
│   ├── unresolved_holes.json    # Active plot hole registry
│   ├── character_states.json    # Location, condition & inventory timeline
│   ├── relationships.json       # Character relationship matrix
│   ├── foreshadowing.json       # Chekhov's gun tracker (Setups & Payoffs)
│   ├── style_guide.json         # Voice, tone, sentence rules & reference excerpts
│   └── snapshots/               # Version snapshots for rollback protection
├── .cbm/                         # Knowledge Graph cache & index
│   └── index.json                # Precomputed entity/relationship index
├── bible/                       # Story Bible & Worldbuilding Lore
│   ├── characters/              # Character profiles with YAML frontmatter
│   ├── world/                   # Locations, factions, magic/tech systems
│   └── subplots/                # Subplot tracking & arc objectives
├── manuscript/                  # Official Manuscript Drafts
│   └── arc_01/
│       ├── ch_001.md
│       └── ch_002.md
├── outline/                     # Master Outline & Chapter Beats
│   ├── synopsis.md              # High-level story synopsis
│   ├── themes.md                # Themes & key motifs
│   └── arc_01/
│       ├── overview.md          # Arc overview
│       └── ch_001_outline.md    # Scene beats per chapter
└── drafts_raw/                  # Loose, unorganized writing snippets
```

---

## ⚙️ MCP Client Configuration (Manual Setup)

Nếu bạn muốn cấu hình thủ công thay vì chạy `npx story-architect-mcp setup`:

> **💡 Zero-Config Project Switching**: Bạn **không** bắt buộc phải cố định đường dẫn novel project trong tham số khởi động. Khi server chạy, AI có thể tự chọn hoặc chuyển đổi dự án tại runtime bằng tool `story_set_project`.

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "story-architect": {
      "command": "npx",
      "args": ["-y", "story-architect-mcp"]
    }
  }
}
```

### Antigravity / Cursor / Windsurf / VS Code (`mcp.json` / `cline_mcp_settings.json`)

```json
{
  "mcpServers": {
    "story-architect": {
      "command": "npx",
      "args": ["-y", "story-architect-mcp"]
    }
  }
}
```

---

## 🛠️ MCP API Reference

### 1. MCP Tools (30 Tools)

#### 🔹 Project & Structure Management
| Tool Name | Key Parameters | Description |
|---|---|---|
| `story_set_project` | `projectPath` | Sets or switches the target novel project directory dynamically at runtime. |
| `story_list_projects` | *none* | Lists all novel projects opened in this server session (parameter v0.3.0 — project registry + instance reuse). |
| `story_get_project_info` | *none* | Returns status, path, configuration, and word count of the active project. |
| `story_init` | `template`, `title`, `author`, `genre`, `pov`, `tense` | Initializes project directory with predefined genre templates. |
| `story_stats` | *none* | Computes total manuscript word count, writing velocity, and estimated completion date. |
| `story_generate_dashboard` | `outputPath` | Generates a comprehensive interactive visual HTML dashboard (`export/dashboard.html`). |

#### 🔹 Manuscript Authoring Suite
| Tool Name | Key Parameters | Description |
|---|---|---|
| `story_write_chapter` | `arc`, `chapter`, `content`, `title`, `autoSnapshot` | Writes or overwrites a chapter draft with automatic snapshot and writing progress recording. |
| `story_append_scene` | `arc`, `chapter`, `content`, `sceneHeading` | Appends a new scene or beat to an existing chapter draft. |
| `story_read_chapter` | `arc`, `chapter` | Reads chapter draft content, word count, and scene beat structure. |

#### 🔹 Rescue & Refactoring Suite
| Tool Name | Key Parameters | Description |
|---|---|---|
| `story_scan_messy_project` | `path` | Scans unorganized directories, detects encoding, and classifies loose files. |
| `story_auto_refactor_structure` | `strategy`, `confirm` | Refactors messy files into the standard novel structure (supports dry-run). |
| `story_snapshot` | `description` | Creates a point-in-time state snapshot in `.story/snapshots/`. |
| `story_rollback` | `snapshot_id`, `confirm` | Restores project state to a designated snapshot. |
| `story_prune_snapshots` | `keepLast`, `olderThanDays`, `confirm` | Prunes old snapshots (preview by default; requires `confirm: true` to delete — v0.5.0). |

#### 🔹 Continuity & Management Suite
| Tool Name | Key Parameters | Description |
|---|---|---|
| `story_log_plot_hole` | `title`, `description`, `severity`, `location`, `suggested_fix` | Registers an unresolved narrative plot hole or inconsistency. |
| `story_resolve_plot_hole` | `hole_id`, `resolution_note` | Resolves or dismisses a logged plot hole. |
| `story_log_setup` | `title`, `description`, `chapter`, `character` | Logs a foreshadowing setup (Chekhov's Gun). |
| `story_log_payoff` | `setup_id`, `payoff_chapter`, `description` | Marks a foreshadowing setup as paid off. |
| `story_list_unfired` | *none* | Lists all planted foreshadowing items that haven't been resolved yet. |
| `story_track_character_state` | `character`, `chapter`, `action`, `state` | Tracks character geographic location, status, physical condition, secrets, and inventory timeline. |

#### 🔹 Graph Memory & Context Suite
| Tool Name | Key Parameters | Description |
|---|---|---|
| `story_extract_entities_to_bible` | `chapter_path`, `confirm` | Automatically extracts characters and locations from chapter drafts into `bible/`. |
| `story_map_relationships` | `chapter_range` | Builds and updates inter-character relationship matrix across chapters. |
| `story_query_context` | `query`, `budget_tokens` | Extracts context packages using knowledge graph memory + vector search. |

#### 🔹 Analysis & Prompt Generator Suite
| Tool Name | Key Parameters | Description |
|---|---|---|
| `story_detect_timeline_conflicts` | `addEvent` | Audits event chronology & character omnipresence across parallel subplots, rendering Mermaid Flowchart diagrams. |
| `story_analyze_pacing` | `chapter_range` | Computes Action / Dialogue / Description ratio and scene tension curves. |
| `story_analyze_voice` | `chapter_range` | Checks sentence length, vocabulary richness, and POV/tense compliance against style guide. |
| `story_analyze_sentiment` | `arc`, `chapter`, `windowSize`, `compareToStyleGuide` | Analyzes chapter/arc sentiment, dominant emotions, tone classification, emotional arcs, and detects tone drift. |
| `story_track_emotion` | `text` | Standalone emotion and tone tracker for quick drafting feedback on arbitrary text passages. |
| `story_generate_writing_prompt` | `target_chapter_id`, `strategy` | Compiles lore, outlines, recent endings, and style rules into an optimized prompt. |
| `story_export` | `format`, `output_path`, `include_outline` | Compiles manuscript into Markdown, HTML, EPUB, or DOCX formats. |

---

### 2. MCP Resources (8 Static & 4 Templates)

#### Static Resources
| Resource URI | Description | MIME Type |
|---|---|---|
| `story://status` | Live project word counts, progress, and status | `application/json` |
| `story://config` | Project settings (Title, Author, Genre, POV, Tense) | `application/json` |
| `story://timeline` | Story timeline events, dates & parallel subplots | `application/json` |
| `story://character-states` | Character locations, physical conditions, and inventory history | `application/json` |
| `story://holes` | List of unresolved plot holes and continuity warnings | `application/json` |
| `story://foreshadowing` | Unfired Chekhov's guns and foreshadowing setups | `application/json` |
| `story://relationships` | Character relationship matrix and interaction states | `application/json` |
| `story://emotions` | Project-wide cached sentiment and emotional arc summary | `application/json` |

#### Resource Templates
| Template URI | Description | MIME Type |
|---|---|---|
| `story://bible/characters/{name}` | Profile, frontmatter, and lore for a specific character | `text/markdown` |
| `story://bible/world/{location}` | Description, history, and lore for a location or faction | `text/markdown` |
| `story://character-states/{name}` | Latest location, condition, and inventory snapshot for a character | `application/json` |
| `story://manuscript/{arc}/{chapter}` | Manuscript text for a specific chapter in an arc | `text/markdown` |

---

### 3. MCP Workflow Prompts (5 Prompts)

| Prompt Name | Required Arguments | Workflow Description |
|---|---|---|
| `write-next-chapter` | `arc`, `chapter` | Gathers lore, preceding chapter endings, outline beats, character states, and style rules into an optimized prompt for writing the next chapter. |
| `character-deep-dive` | `name` | Aggregates a character's Bible entry alongside all scene appearances across the manuscript for deep analysis. |
| `continuity-audit` | `arc` | Scans an entire arc to detect timeline errors, term inconsistencies, and unresolved setups. |
| `rescue-project` | `projectPath` *(optional)* | Step-by-step guided workflow for scanning, previewing, and refactoring chaotic manuscript folders. |
| `brainstorm-scene` | `arc`, `chapter` | Generates 3–5 distinct scene execution options based on current outline and plot state. |

---

## 🛡️ Data Integrity & Safety Protocol

Writing a novel takes months or years; `story-architect-mcp` is designed with strict data preservation measures:

1. **Dry-Run Mode First (`confirm: false`)**: All destructive or structural refactoring tools run in Preview mode by default. You can inspect exact proposed file moves and edits before confirming execution (`confirm: true`).
2. **Automated Pre-Refactor & Pre-Write Snapshots**: Executing structural changes or overwriting existing chapters automatically triggers snapshots to create a rollback checkpoint prior to file operations.
3. **Transparent File Formats**: All metadata is stored as standard JSON in `.story/`, and all story content is stored in plain Markdown with YAML frontmatter—ensuring zero vendor lock-in.

---

## 📄 License

Distributed under the MIT License. See [`LICENSE`](LICENSE) for more information.
