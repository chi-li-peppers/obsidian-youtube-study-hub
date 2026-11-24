export type ChapterHeadingLevel = "##" | "###";
export type ThemePreset = "obsidian" | "crimson" | "violet" | "emerald";

export interface YouTubeChapter {
  title: string;
  startSeconds: number;
  formattedTime: string;
}

export interface YouTubeVideoMeta {
  videoId: string;
  title: string;
  channel: string;
  url: string;
  thumbnailUrl: string;
  publishDate: string;
  durationSeconds: number;
  durationFormatted: string;
  description: string;
  chapters: YouTubeChapter[];
}

export interface YouTubePlaylistItem {
  index: number;
  videoId: string;
  title: string;
  durationFormatted: string;
  durationSeconds: number;
  url: string;
}

export interface YouTubePlaylistMeta {
  playlistId: string;
  title: string;
  author: string;
  url: string;
  videos: YouTubePlaylistItem[];
}

export interface ParsedYouTubeUrl {
  type: "video" | "playlist" | "both" | "invalid";
  videoId?: string;
  playlistId?: string;
}

export interface DuplicateResolution {
  action: "open" | "create-copy" | "cancel";
}

export interface YouTubeStudyHubSettings {
  videosFolder: string;
  coursesFolder: string;
  includeVideoEmbed: boolean;
  chapterHeadingLevel: ChapterHeadingLevel;
  autoOpenNote: boolean;
  autoUpdateCourseProgress: boolean;
  playlistRequestDelayMs: number;
  themePreset: ThemePreset;
}

export const DEFAULT_SETTINGS: YouTubeStudyHubSettings = {
  videosFolder: "YouTube/Videos",
  coursesFolder: "YouTube/Courses",
  includeVideoEmbed: true,
  chapterHeadingLevel: "##",
  autoOpenNote: true,
  autoUpdateCourseProgress: true,
  playlistRequestDelayMs: 650,
  themePreset: "obsidian",
};
