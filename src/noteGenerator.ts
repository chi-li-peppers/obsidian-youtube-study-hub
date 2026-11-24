import { App, TFile, normalizePath } from "obsidian";
import {
  YouTubeChapter,
  YouTubePlaylistItem,
  YouTubePlaylistMeta,
  YouTubeStudyHubSettings,
  YouTubeVideoMeta,
} from "./types";

const PROGRESS_START = "<!-- ytsh-progress:start -->";
const PROGRESS_END = "<!-- ytsh-progress:end -->";

/**
 * Strip illegal OS filename characters and normalise whitespace.
 */
export function sanitizeFileName(raw: string, fallback = "Untitled"): string {
  const cleaned = String(raw || "")
    .replace(/[\\/:*?"<>|#^\[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 120)
    .trim();
  return cleaned || fallback;
}

export function todayYmd(d?: Date): string {
  const x = d || new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

function yamlStr(val: string): string {
  const s = String(val ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ");
  return `"${s}"`;
}

/**
 * Render chapter headings with clickable timestamp links, e.g.:
 *   ## [04:15](https://youtu.be/{id}?t=255) Chapter Name
 */
export function renderChaptersMarkdown(
  videoId: string,
  chapters: YouTubeChapter[],
  headingLevel: "##" | "###"
): string {
  if (!chapters.length) {
    return `${headingLevel} Notes\n\n`;
  }
  const lines: string[] = [];
  for (const ch of chapters) {
    const link = `https://youtu.be/${videoId}?t=${ch.startSeconds}`;
    lines.push(`${headingLevel} [${ch.formattedTime}](${link}) ${ch.title}`);
    lines.push("");
    lines.push("");
  }
  return lines.join("\n").replace(/\n+$/, "\n");
}

/**
 * Generate the full Markdown content for a single YouTube video study note.
 */
export function generateVideoNoteMarkdown(
  video: YouTubeVideoMeta,
  settings: YouTubeStudyHubSettings,
  opts?: { courseIndexLink?: string; lessonIndex?: number }
): string {
  const lines: string[] = [
    "---",
    `title: ${yamlStr(video.title)}`,
    `channel: ${yamlStr(video.channel)}`,
    `url: ${yamlStr(video.url)}`,
    `video_id: ${yamlStr(video.videoId)}`,
  ];
  if (video.durationFormatted) lines.push(`duration: ${yamlStr(video.durationFormatted)}`);
  if (video.publishDate) lines.push(`published: ${video.publishDate}`);
  if (opts?.lessonIndex !== undefined) lines.push(`lesson: ${opts.lessonIndex}`);
  lines.push("status: todo");
  lines.push(`created: ${todayYmd()}`);
  lines.push("---", "");

  if (opts?.courseIndexLink) {
    lines.push(`← Back to [[${opts.courseIndexLink}]]`, "");
  }

  lines.push(`# ${video.title}`, "");
  lines.push(`**Channel:** ${video.channel}${video.durationFormatted ? ` · **Duration:** ${video.durationFormatted}` : ""}`);
  lines.push(`**Watch:** [Open on YouTube](${video.url})`, "");

  if (settings.includeVideoEmbed) {
    lines.push(`![${video.title}](${video.url})`, "");
  } else if (video.thumbnailUrl) {
    lines.push(`[![${video.title}](${video.thumbnailUrl})](${video.url})`, "");
  }

  lines.push(renderChaptersMarkdown(video.videoId, video.chapters, settings.chapterHeadingLevel));
  return lines.join("\n").replace(/\n+$/, "\n");
}

/**
 * Generate a lightweight lesson note (used when user skips fetching chapters during playlist import).
 */
export function generateLightweightLessonMarkdown(
  item: YouTubePlaylistItem,
  playlist: YouTubePlaylistMeta,
  settings: YouTubeStudyHubSettings,
  courseIndexName: string
): string {
  const meta: YouTubeVideoMeta = {
    videoId: item.videoId,
    title: item.title,
    channel: playlist.author,
    url: item.url,
    thumbnailUrl: `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,
    publishDate: "",
    durationSeconds: item.durationSeconds,
    durationFormatted: item.durationFormatted,
    description: "",
    chapters: [],
  };
  return generateVideoNoteMarkdown(meta, settings, {
    courseIndexLink: courseIndexName,
    lessonIndex: item.index,
  });
}

/**
 * Render the visual HTML progress bar block wrapped in markers for automatic updates.
 */
export function renderProgressBlock(completed: number, total: number): string {
  const safeTotal = Math.max(0, total);
  const safeDone = Math.max(0, Math.min(completed, safeTotal));
  const pct = safeTotal > 0 ? Math.round((safeDone / safeTotal) * 100) : 0;
  return [
    PROGRESS_START,
    `<div class="ytsh-progress-wrap"><progress class="ytsh-progress-bar" value="${safeDone}" max="${Math.max(1, safeTotal)}"></progress><span class="ytsh-progress-label"><strong>${safeDone} / ${safeTotal}</strong> lessons (${pct}%)</span></div>`,
    PROGRESS_END,
  ].join("\n");
}

/**
 * Compute numbered lesson filename (without .md extension), e.g. "01 - Introduction".
 */
export function formatLessonBaseName(index: number, title: string, totalCount: number): string {
  const width = Math.max(2, String(totalCount).length);
  const numStr = String(index).padStart(width, "0");
  return `${numStr} - ${sanitizeFileName(title, `Lesson ${numStr}`)}`;
}

/**
 * Generate the `_Course Index.md` note for a YouTube playlist course.
 */
export function generateCourseIndexMarkdown(
  playlist: YouTubePlaylistMeta,
  lessonBaseNames: string[]
): string {
  const total = playlist.videos.length;
  const lines: string[] = [
    "---",
    "type: course",
    `title: ${yamlStr(playlist.title)}`,
    `author: ${yamlStr(playlist.author)}`,
    `source: ${yamlStr(playlist.url)}`,
    `playlist_id: ${yamlStr(playlist.playlistId)}`,
    `total_lessons: ${total}`,
    "completed_lessons: 0",
    "status: todo",
    `created: ${todayYmd()}`,
    "---",
    "",
    `# ${playlist.title}`,
    "",
    `**Instructor / Channel:** ${playlist.author} · [Open playlist on YouTube](${playlist.url})`,
    "",
    "## Progress",
    "",
    renderProgressBlock(0, total),
    "",
    "## Lessons",
    "",
  ];

  playlist.videos.forEach((v, i) => {
    const baseName = lessonBaseNames[i];
    const dur = v.durationFormatted ? ` (${v.durationFormatted})` : "";
    lines.push(`- [ ] [[${baseName}]]${dur}`);
  });

  lines.push("");
  return lines.join("\n");
}

/**
 * Recalculate checkbox completion in a course index note and return updated markdown (or null if unchanged).
 */
export function updateCourseIndexProgress(content: string): {
  updated: string;
  completed: number;
  total: number;
  status: "todo" | "in-progress" | "completed";
} | null {
  if (!content.includes(PROGRESS_START) || !content.includes(PROGRESS_END)) {
    return null;
  }

  const checkboxes = content.match(/^\s*-\s+\[([ xX])\]\s+/gm) || [];
  const total = checkboxes.length;
  const completed = checkboxes.filter((line) => /^\s*-\s+\[[xX]\]/.test(line)).length;
  const status: "todo" | "in-progress" | "completed" =
    total > 0 && completed >= total ? "completed" : completed > 0 ? "in-progress" : "todo";

  const markerRe = new RegExp(`${PROGRESS_START}[\\s\\S]*?${PROGRESS_END}`);
  let next = content.replace(markerRe, renderProgressBlock(completed, total));

  // Keep frontmatter status & completed_lessons in sync when YAML frontmatter is present
  if (next.startsWith("---\n")) {
    const endIdx = next.indexOf("\n---", 4);
    if (endIdx !== -1) {
      let fm = next.slice(0, endIdx);
      fm = fm.replace(/^status:\s*.*$/m, `status: ${status}`);
      if (/^completed_lessons:\s*/m.test(fm)) {
        fm = fm.replace(/^completed_lessons:\s*.*$/m, `completed_lessons: ${completed}`);
      }
      if (/^total_lessons:\s*/m.test(fm)) {
        fm = fm.replace(/^total_lessons:\s*.*$/m, `total_lessons: ${total}`);
      }
      next = fm + next.slice(endIdx);
    }
  }

  if (next === content) return null;
  return { updated: next, completed, total, status };
}

/**
 * Recursively ensure a folder path exists in the vault.
 */
export async function ensureFolder(app: App, folderPath: string): Promise<string> {
  const clean = normalizePath(folderPath.replace(/^\/+|\/+$/g, ""));
  if (!clean || clean === ".") return "";
  const parts = clean.split("/");
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) {
      await app.vault.createFolder(current);
    }
  }
  return clean;
}

/**
 * Find a non-colliding file path by appending " (2)", " (3)", etc.
 */
export function findUniqueFilePath(app: App, folder: string, baseName: string): string {
  const prefix = folder ? `${folder}/` : "";
  let candidate = normalizePath(`${prefix}${baseName}.md`);
  let n = 2;
  while (app.vault.getAbstractFileByPath(candidate)) {
    candidate = normalizePath(`${prefix}${baseName} (${n++}).md`);
  }
  return candidate;
}

/**
 * Check if a file already exists at the given path.
 */
export function getExistingFile(app: App, fullPath: string): TFile | null {
  const af = app.vault.getAbstractFileByPath(normalizePath(fullPath));
  return af instanceof TFile ? af : null;
}
