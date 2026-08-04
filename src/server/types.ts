import { z } from 'zod';

// ============================================================
// Story Project Configuration
// ============================================================

export const StoryConfigSchema = z.object({
  name: z.string().describe('Tên dự án tiểu thuyết'),
  author: z.string().default(''),
  genre: z.array(z.string()).default([]).describe('Thể loại: Fantasy, Romance, Sci-Fi...'),
  pov: z.enum(['first', 'third-limited', 'third-omniscient', 'second']).default('third-limited'),
  tense: z.enum(['past', 'present']).default('past'),
  language: z.string().default('vi'),
  targetWordCount: z.number().default(80000).describe('Mục tiêu số từ'),
  createdAt: z.string().default(() => new Date().toISOString()),
  updatedAt: z.string().default(() => new Date().toISOString()),
});
export type StoryConfig = z.infer<typeof StoryConfigSchema>;

// ============================================================
// Story Project Status
// ============================================================

export const StoryStatusSchema = z.object({
  totalWordCount: z.number().default(0),
  chapterCount: z.number().default(0),
  arcCount: z.number().default(0),
  characterCount: z.number().default(0),
  completionPercent: z.number().default(0),
  lastWrittenAt: z.string().optional(),
  writingLog: z.array(z.object({
    date: z.string(),
    wordsWritten: z.number(),
    chaptersWorked: z.array(z.string()).default([]),
  })).default([]),
});
export type StoryStatus = z.infer<typeof StoryStatusSchema>;

// ============================================================
// Timeline
// ============================================================

export const TimelineEventSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().default(''),
  absoluteDate: z.string().optional().describe('ISO date hoặc in-world date'),
  relativeOrder: z.number().default(0).describe('Thứ tự tương đối'),
  chapter: z.string().optional().describe('Chương liên quan'),
  characters: z.array(z.string()).default([]),
  location: z.string().optional(),
});
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;

export const TimelineSchema = z.object({
  events: z.array(TimelineEventSchema).default([]),
  updatedAt: z.string().default(() => new Date().toISOString()),
});
export type Timeline = z.infer<typeof TimelineSchema>;

// ============================================================
// Plot Holes
// ============================================================

export const PlotHoleSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  chapters: z.array(z.string()).default([]).describe('Các chương liên quan'),
  createdAt: z.string().default(() => new Date().toISOString()),
  resolvedAt: z.string().optional(),
  resolution: z.string().optional(),
  status: z.enum(['open', 'resolved', 'wont-fix']).default('open'),
});
export type PlotHole = z.infer<typeof PlotHoleSchema>;

export const PlotHolesFileSchema = z.object({
  holes: z.array(PlotHoleSchema).default([]),
  updatedAt: z.string().default(() => new Date().toISOString()),
});
export type PlotHolesFile = z.infer<typeof PlotHolesFileSchema>;

// ============================================================
// Foreshadowing (Chekhov's Gun Tracker)
// ============================================================

export const ForeshadowingItemSchema = z.object({
  id: z.string(),
  setup: z.string().describe('Chi tiết cài cắm'),
  setupChapter: z.string().describe('Chương đặt setup'),
  setupLine: z.string().optional().describe('Trích dẫn dòng cài cắm'),
  payoff: z.string().optional().describe('Chi tiết giải gỡ'),
  payoffChapter: z.string().optional(),
  status: z.enum(['planted', 'fired', 'abandoned']).default('planted'),
  importance: z.enum(['minor', 'moderate', 'major']).default('moderate'),
  createdAt: z.string().default(() => new Date().toISOString()),
  firedAt: z.string().optional(),
});
export type ForeshadowingItem = z.infer<typeof ForeshadowingItemSchema>;

export const ForeshadowingFileSchema = z.object({
  items: z.array(ForeshadowingItemSchema).default([]),
  updatedAt: z.string().default(() => new Date().toISOString()),
});
export type ForeshadowingFile = z.infer<typeof ForeshadowingFileSchema>;

// ============================================================
// Relationships
// ============================================================

export const RelationshipSchema = z.object({
  source: z.string().describe('Nhân vật A'),
  target: z.string().describe('Nhân vật B'),
  type: z.enum([
    'ally', 'enemy', 'friend', 'lover', 'rival',
    'family', 'mentor', 'student', 'stranger', 'other'
  ]),
  description: z.string().default(''),
  startChapter: z.string().optional(),
  endChapter: z.string().optional(),
  evolution: z.array(z.object({
    chapter: z.string(),
    change: z.string(),
    newType: z.string().optional(),
  })).default([]),
});
export type Relationship = z.infer<typeof RelationshipSchema>;

export const RelationshipsFileSchema = z.object({
  relationships: z.array(RelationshipSchema).default([]),
  updatedAt: z.string().default(() => new Date().toISOString()),
});
export type RelationshipsFile = z.infer<typeof RelationshipsFileSchema>;

// ============================================================
// Style Guide
// ============================================================

export const StyleGuideSchema = z.object({
  voiceDescription: z.string().default('').describe('Mô tả giọng văn tổng thể'),
  avgSentenceLength: z.number().optional(),
  vocabularyLevel: z.enum(['simple', 'moderate', 'advanced', 'literary']).default('moderate'),
  dialogueStyle: z.string().default(''),
  narrativeStyle: z.string().default(''),
  avoidWords: z.array(z.string()).default([]),
  preferWords: z.array(z.string()).default([]),
  samplePassages: z.array(z.string()).default([]).describe('Đoạn văn mẫu tham chiếu'),
  updatedAt: z.string().default(() => new Date().toISOString()),
});
export type StyleGuide = z.infer<typeof StyleGuideSchema>;

// ============================================================
// Character Profile (bible/characters/)
// ============================================================

export const CharacterProfileSchema = z.object({
  name: z.string(),
  aliases: z.array(z.string()).default([]),
  role: z.enum(['protagonist', 'antagonist', 'supporting', 'minor', 'background']).default('supporting'),
  age: z.string().optional(),
  gender: z.string().optional(),
  appearance: z.string().default(''),
  personality: z.string().default(''),
  backstory: z.string().default(''),
  goals: z.array(z.string()).default([]),
  flaws: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  notes: z.string().default(''),
  firstAppearance: z.string().optional(),
});
export type CharacterProfile = z.infer<typeof CharacterProfileSchema>;

// ============================================================
// World Entry (bible/world/)
// ============================================================

export const WorldEntrySchema = z.object({
  name: z.string(),
  type: z.enum(['location', 'magic-system', 'technology', 'organization', 'history', 'culture', 'other']).default('location'),
  description: z.string().default(''),
  details: z.string().default(''),
  relatedCharacters: z.array(z.string()).default([]),
  relatedLocations: z.array(z.string()).default([]),
  notes: z.string().default(''),
});
export type WorldEntry = z.infer<typeof WorldEntrySchema>;

// ============================================================
// Scan Result (for story_scan_messy_project)
// ============================================================

export const FileClassificationSchema = z.object({
  path: z.string(),
  category: z.enum(['manuscript', 'notes', 'lore', 'outline', 'unknown']),
  confidence: z.number().min(0).max(1),
  encoding: z.string().default('utf-8'),
  wordCount: z.number().default(0),
  similarTo: z.array(z.string()).default([]).describe('Paths of similar files'),
});
export type FileClassification = z.infer<typeof FileClassificationSchema>;

// ============================================================
// Snapshot
// ============================================================

export const SnapshotSchema = z.object({
  id: z.string(),
  label: z.string(),
  createdAt: z.string().default(() => new Date().toISOString()),
  fileCount: z.number().default(0),
  description: z.string().default(''),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

export const SnapshotsIndexSchema = z.object({
  snapshots: z.array(SnapshotSchema).default([]),
});
export type SnapshotsIndex = z.infer<typeof SnapshotsIndexSchema>;

// ============================================================
// Refactor Action (for story_auto_refactor_structure preview)
// ============================================================

export const RefactorActionSchema = z.object({
  type: z.enum(['move', 'rename', 'create-dir', 'skip']),
  source: z.string(),
  destination: z.string(),
  reason: z.string(),
});
export type RefactorAction = z.infer<typeof RefactorActionSchema>;
