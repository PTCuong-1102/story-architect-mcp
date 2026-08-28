import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import matter from 'gray-matter';
import {
  readJsonFile,
  writeJsonFile,
  readTextFile,
  exists,
  findMarkdownFiles,
  isSafePathSegment,
} from '../utils/fileUtils.js';
import { countWords } from '../utils/wordCount.js';
import {
  StoryConfigSchema,
  StoryStatusSchema,
  TimelineSchema,
  PlotHolesFileSchema,
  ForeshadowingFileSchema,
  RelationshipsFileSchema,
  StyleGuideSchema,
  SentimentCacheSchema,
  type StoryConfig,
  type StoryStatus,
  type Timeline,
  type PlotHolesFile,
  type ForeshadowingFile,
  type RelationshipsFile,
  type StyleGuide,
  type SentimentCache,
  type CharacterProfile,
  type WorldEntry,
} from './types.js';

/**
 * StoryProject - Lớp quản lý trạng thái dự án tiểu thuyết.
 *
 * Mỗi instance đại diện cho một dự án cụ thể trên đĩa,
 * đọc/ghi metadata từ thư mục `.story/`.
 */
export class StoryProject {
  readonly projectPath: string;
  readonly storyDir: string;
  readonly bibleDir: string;
  readonly manuscriptDir: string;
  readonly outlineDir: string;
  readonly draftsRawDir: string;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    this.storyDir = path.join(projectPath, '.story');
    this.bibleDir = path.join(projectPath, 'bible');
    this.manuscriptDir = path.join(projectPath, 'manuscript');
    this.outlineDir = path.join(projectPath, 'outline');
    this.draftsRawDir = path.join(projectPath, 'drafts_raw');
  }

  // ====== Paths ======

  private configPath() { return path.join(this.storyDir, 'config.json'); }
  private statusPath() { return path.join(this.storyDir, 'status.json'); }
  private timelinePath() { return path.join(this.storyDir, 'timeline.json'); }
  private holesPath() { return path.join(this.storyDir, 'unresolved_holes.json'); }
  private foreshadowingPath() { return path.join(this.storyDir, 'foreshadowing.json'); }
  private relationshipsPath() { return path.join(this.storyDir, 'relationships.json'); }
  private styleGuidePath() { return path.join(this.storyDir, 'style_guide.json'); }
  private snapshotsDir() { return path.join(this.storyDir, 'snapshots'); }
  private emotionsCachePath() { return path.join(this.storyDir, 'emotions_cache.json'); }

  // ====== Validation ======

  async isInitialized(): Promise<boolean> {
    return exists(this.configPath());
  }

  // ====== Config ======

  async getConfig(): Promise<StoryConfig> {
    const raw = await readJsonFile<unknown>(this.configPath());
    if (!raw) {
      return StoryConfigSchema.parse({ name: path.basename(this.projectPath) });
    }
    return StoryConfigSchema.parse(raw);
  }

  async saveConfig(config: Partial<StoryConfig>): Promise<StoryConfig> {
    const current = await this.getConfig();
    const merged = { ...current, ...config, updatedAt: new Date().toISOString() };
    const validated = StoryConfigSchema.parse(merged);
    await writeJsonFile(this.configPath(), validated);
    return validated;
  }

  // ====== Status ======

  async getStatus(): Promise<StoryStatus> {
    const raw = await readJsonFile<unknown>(this.statusPath());
    const status = raw ? StoryStatusSchema.parse(raw) : StoryStatusSchema.parse({});

    // Recalculate live stats
    const wordCount = await this.calculateTotalWordCount();
    const chapterCount = await this.countChapters();
    const arcCount = await this.countArcs();
    const characterCount = await this.countCharacters();
    const config = await this.getConfig();
    const completionPercent = config.targetWordCount > 0
      ? Math.min(100, Math.round((wordCount / config.targetWordCount) * 100))
      : 0;

    return {
      ...status,
      totalWordCount: wordCount,
      chapterCount,
      arcCount,
      characterCount,
      completionPercent,
    };
  }

  async saveStatus(status: Partial<StoryStatus>): Promise<void> {
    const current = await this.getStatus();
    await writeJsonFile(this.statusPath(), { ...current, ...status });
  }

  /**
   * Ghi nhận tiến độ viết (writing progress):
   * so sánh word count hiện tại với mốc đã lưu trước đó, nếu có delta dương
   * thì bổ sung entry vào writingLog và cập nhật lastWrittenAt.
   * Trả về status đã lưu (dùng để tính writing velocity).
   */
  async recordWritingProgress(): Promise<StoryStatus> {
    const raw = await readJsonFile<unknown>(this.statusPath());
    const stored = raw ? StoryStatusSchema.parse(raw) : StoryStatusSchema.parse({});
    const currentWordCount = await this.calculateTotalWordCount();

    const delta = Math.max(0, currentWordCount - (stored.totalWordCount || 0));

    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const writingLog = [...stored.writingLog];

    if (delta > 0) {
      const lastEntry = writingLog[writingLog.length - 1];
      if (lastEntry && lastEntry.date === today) {
        lastEntry.wordsWritten += delta;
      } else {
        writingLog.push({ date: today, wordsWritten: delta, chaptersWorked: [] });
      }
    }

    const updated: StoryStatus = {
      ...stored,
      totalWordCount: currentWordCount,
      lastWrittenAt: now.toISOString(),
      writingLog,
    };
    await writeJsonFile(this.statusPath(), updated);
    return updated;
  }

  // ====== Timeline ======

  async getTimeline(): Promise<Timeline> {
    const raw = await readJsonFile<unknown>(this.timelinePath());
    return raw ? TimelineSchema.parse(raw) : TimelineSchema.parse({});
  }

  async saveTimeline(timeline: Timeline): Promise<void> {
    await writeJsonFile(this.timelinePath(), { ...timeline, updatedAt: new Date().toISOString() });
  }

  // ====== Plot Holes ======

  async getPlotHoles(): Promise<PlotHolesFile> {
    const raw = await readJsonFile<unknown>(this.holesPath());
    return raw ? PlotHolesFileSchema.parse(raw) : PlotHolesFileSchema.parse({});
  }

  async savePlotHoles(data: PlotHolesFile): Promise<void> {
    await writeJsonFile(this.holesPath(), { ...data, updatedAt: new Date().toISOString() });
  }

  // ====== Foreshadowing ======

  async getForeshadowing(): Promise<ForeshadowingFile> {
    const raw = await readJsonFile<unknown>(this.foreshadowingPath());
    return raw ? ForeshadowingFileSchema.parse(raw) : ForeshadowingFileSchema.parse({});
  }

  async saveForeshadowing(data: ForeshadowingFile): Promise<void> {
    await writeJsonFile(this.foreshadowingPath(), { ...data, updatedAt: new Date().toISOString() });
  }

  // ====== Relationships ======

  async getRelationships(): Promise<RelationshipsFile> {
    const raw = await readJsonFile<unknown>(this.relationshipsPath());
    return raw ? RelationshipsFileSchema.parse(raw) : RelationshipsFileSchema.parse({});
  }

  async saveRelationships(data: RelationshipsFile): Promise<void> {
    await writeJsonFile(this.relationshipsPath(), { ...data, updatedAt: new Date().toISOString() });
  }

  // ====== Style Guide ======

  async getStyleGuide(): Promise<StyleGuide> {
    const raw = await readJsonFile<unknown>(this.styleGuidePath());
    return raw ? StyleGuideSchema.parse(raw) : StyleGuideSchema.parse({});
  }

  async saveStyleGuide(data: StyleGuide): Promise<void> {
    await writeJsonFile(this.styleGuidePath(), { ...data, updatedAt: new Date().toISOString() });
  }

  // ====== Characters ======

  async listCharacters(): Promise<string[]> {
    const charDir = path.join(this.bibleDir, 'characters');
    if (!await exists(charDir)) return [];
    const files = await findMarkdownFiles(charDir);
    return files.map(f => path.basename(f, path.extname(f)));
  }

  async getCharacter(name: string): Promise<{ frontmatter: Record<string, unknown>; content: string } | null> {
    const charDir = path.join(this.bibleDir, 'characters');
    // Try exact filename match first
    const possiblePaths = [
      path.join(charDir, `${name}.md`),
      path.join(charDir, `${name.toLowerCase()}.md`),
      path.join(charDir, `${name.toLowerCase().replace(/\s+/g, '_')}.md`),
    ];
    for (const p of possiblePaths) {
      const content = await readTextFile(p);
      if (content !== null) {
        // Parse YAML frontmatter bằng gray-matter (hỗ trợ cú pháp YAML đầy đủ)
        const parsed = matter(content);
        return {
          frontmatter: parsed.data as Record<string, unknown>,
          content: parsed.content.trim(),
        };
      }
    }
    return null;
  }

  // ====== World ======

  async listWorldEntries(): Promise<string[]> {
    const worldDir = path.join(this.bibleDir, 'world');
    if (!await exists(worldDir)) return [];
    const files = await findMarkdownFiles(worldDir);
    return files.map(f => path.basename(f, path.extname(f)));
  }

  async getWorldEntry(name: string): Promise<string | null> {
    const worldDir = path.join(this.bibleDir, 'world');
    const possiblePaths = [
      path.join(worldDir, `${name}.md`),
      path.join(worldDir, `${name.toLowerCase()}.md`),
      path.join(worldDir, `${name.toLowerCase().replace(/\s+/g, '_')}.md`),
    ];
    for (const p of possiblePaths) {
      const content = await readTextFile(p);
      if (content !== null) {
        // Tách frontmatter để trả về phần nội dung lore sạch sẽ
        return matter(content).content.trim();
      }
    }
    return null;
  }

  // ====== Manuscript ======

  async getChapterContent(arc: string, chapter: string): Promise<string | null> {
    if (!isSafePathSegment(arc) || !isSafePathSegment(chapter)) return null;
    const chapterPath = path.join(this.manuscriptDir, arc, `${chapter}.md`);
    return readTextFile(chapterPath);
  }

  async listArcs(): Promise<string[]> {
    if (!await exists(this.manuscriptDir)) return [];
    try {
      const entries = await fs.readdir(this.manuscriptDir, { withFileTypes: true });
      return entries
        .filter(e => e.isDirectory() && isSafePathSegment(e.name))
        .map(e => e.name)
        .sort();
    } catch {
      return [];
    }
  }

  async listChaptersInArc(arc: string): Promise<string[]> {
    if (!isSafePathSegment(arc)) return [];
    const arcDir = path.join(this.manuscriptDir, arc);
    if (!await exists(arcDir)) return [];
    try {
      const entries = await fs.readdir(arcDir);
      return entries
        .filter(f => f.endsWith('.md'))
        .map(f => f.replace('.md', ''))
        .filter(f => isSafePathSegment(f))
        .sort();
    } catch {
      return [];
    }
  }

  // ====== Calculations ======

  async calculateTotalWordCount(): Promise<number> {
    if (!await exists(this.manuscriptDir)) return 0;
    const files = await findMarkdownFiles(this.manuscriptDir);
    let total = 0;
    for (const file of files) {
      const content = await readTextFile(file);
      if (content) total += countWords(content);
    }
    return total;
  }

  private async countChapters(): Promise<number> {
    if (!await exists(this.manuscriptDir)) return 0;
    const files = await findMarkdownFiles(this.manuscriptDir);
    return files.length;
  }

  private async countArcs(): Promise<number> {
    return (await this.listArcs()).length;
  }

  private async countCharacters(): Promise<number> {
    return (await this.listCharacters()).length;
  }

  // ====== Project Initialization ======

  async initializeProject(config: Partial<StoryConfig>): Promise<void> {
    // Create directory structure
    const dirs = [
      this.storyDir,
      path.join(this.storyDir, 'snapshots'),
      path.join(this.projectPath, '.cbm'),
      path.join(this.bibleDir, 'characters'),
      path.join(this.bibleDir, 'world'),
      path.join(this.bibleDir, 'subplots'),
      path.join(this.manuscriptDir, 'arc_01'),
      this.draftsRawDir,
      path.join(this.outlineDir, 'arc_01'),
    ];

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }

    // Initialize config
    const fullConfig = StoryConfigSchema.parse({
      name: config.name || path.basename(this.projectPath),
      ...config,
    });
    await writeJsonFile(this.configPath(), fullConfig);

    // Initialize empty metadata files
    await writeJsonFile(this.statusPath(), StoryStatusSchema.parse({}));
    await writeJsonFile(this.timelinePath(), TimelineSchema.parse({}));
    await writeJsonFile(this.holesPath(), PlotHolesFileSchema.parse({}));
    await writeJsonFile(this.foreshadowingPath(), ForeshadowingFileSchema.parse({}));
    await writeJsonFile(this.relationshipsPath(), RelationshipsFileSchema.parse({}));
    await writeJsonFile(this.styleGuidePath(), StyleGuideSchema.parse({}));

    // Create placeholder files
    await fs.writeFile(
      path.join(this.outlineDir, 'synopsis.md'),
      `# ${fullConfig.name}\n\n## Tóm tắt\n\n_Viết tóm tắt tổng thể câu chuyện ở đây._\n`,
      'utf-8'
    );
    await fs.writeFile(
      path.join(this.outlineDir, 'themes.md'),
      `# Chủ đề & Motif\n\n_Liệt kê các chủ đề xuyên suốt tác phẩm._\n`,
      'utf-8'
    );
  }

  // ====== Sentiment Cache ======

  async getSentimentCache(): Promise<SentimentCache | null> {
    const raw = await readJsonFile<unknown>(this.emotionsCachePath());
    if (!raw) return null;
    return SentimentCacheSchema.parse(raw);
  }

  async saveSentimentCache(data: SentimentCache): Promise<void> {
    await writeJsonFile(this.emotionsCachePath(), { ...data, analyzedAt: new Date().toISOString() });
  }

  // ====== Snapshots Dir ======

  getSnapshotsDir(): string {
    return this.snapshotsDir();
  }
}
