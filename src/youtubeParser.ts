import { requestUrl } from "obsidian";
import {
  ParsedYouTubeUrl,
  YouTubeChapter,
  YouTubePlaylistItem,
  YouTubePlaylistMeta,
  YouTubeVideoMeta,
} from "./types";

const YT_HEADERS: Record<string, string> = {
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};

/**
 * Parse a YouTube URL and determine whether it points to a video, playlist, or both.
 */
export function parseYouTubeUrl(raw: string): ParsedYouTubeUrl {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return { type: "invalid" };

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return { type: "invalid" };
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  let videoId: string | undefined;
  let playlistId: string | undefined;

  const listParam = url.searchParams.get("list") || undefined;
  if (listParam && /^[A-Za-z0-9_-]{10,}$/.test(listParam)) {
    playlistId = listParam;
  }

  if (host === "youtu.be") {
    const seg = url.pathname.split("/").filter(Boolean)[0];
    if (seg && /^[A-Za-z0-9_-]{11}$/.test(seg)) videoId = seg;
  } else if (host === "youtube.com" || host === "music.youtube.com" || host === "youtube-nocookie.com") {
    const vParam = url.searchParams.get("v");
    if (vParam && /^[A-Za-z0-9_-]{11}$/.test(vParam)) {
      videoId = vParam;
    } else {
      const match = /^\/(?:shorts|live|embed|v)\/([A-Za-z0-9_-]{11})/.exec(url.pathname);
      if (match) videoId = match[1];
    }
  } else {
    return { type: "invalid" };
  }

  if (videoId && playlistId) return { type: "both", videoId, playlistId };
  if (playlistId) return { type: "playlist", playlistId };
  if (videoId) return { type: "video", videoId };
  return { type: "invalid" };
}

/**
 * Format seconds as MM:SS (or HH:MM:SS when >= 1 hour).
 */
export function formatTimestamp(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hrs > 0 ? `${pad(hrs)}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
}

/**
 * Parse a timestamp string like "4:15", "04:15", or "1:02:30" into seconds.
 */
export function parseTimestampToSeconds(raw: string): number | null {
  const parts = String(raw || "")
    .trim()
    .split(":")
    .map((p) => Number(p));
  if (parts.length < 2 || parts.length > 3 || parts.some((n) => !Number.isInteger(n) || n < 0)) {
    return null;
  }
  if (parts.length === 2) {
    const [m, s] = parts;
    if (s >= 60) return null;
    return m * 60 + s;
  }
  const [h, m, s] = parts;
  if (m >= 60 || s >= 60) return null;
  return h * 3600 + m * 60 + s;
}

/**
 * Safely extract a balanced JSON object literal that starts immediately after `marker` in HTML.
 * Handles nested braces and escaped quotes inside strings without fragile regex backtracking.
 */
export function extractJsonAfterMarker(html: string, marker: string): Record<string, unknown> | null {
  const idx = html.indexOf(marker);
  if (idx === -1) return null;

  let start = html.indexOf("{", idx + marker.length);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const rawJson = html.slice(start, i + 1);
        try {
          return JSON.parse(rawJson) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function readText(obj: unknown): string {
  if (!obj || typeof obj !== "object") return "";
  const rec = obj as Record<string, unknown>;
  if (typeof rec.simpleText === "string") return rec.simpleText;
  if (typeof rec.content === "string") return rec.content;
  if (Array.isArray(rec.runs)) {
    return rec.runs
      .map((r) => (r && typeof r === "object" && typeof (r as Record<string, unknown>).text === "string"
        ? (r as Record<string, unknown>).text
        : ""))
      .join("");
  }
  return "";
}

/**
 * Recursively find all objects in a parsed YouTube JSON tree containing a given key.
 */
function findObjectsByKey(node: unknown, key: string, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const item of node) findObjectsByKey(item, key, out);
    return out;
  }
  const rec = node as Record<string, unknown>;
  if (key in rec && rec[key] && typeof rec[key] === "object") {
    out.push(rec[key] as Record<string, unknown>);
  }
  for (const val of Object.values(rec)) {
    if (val && typeof val === "object") findObjectsByKey(val, key, out);
  }
  return out;
}

/**
 * Extract structured chapters from ytInitialData (player bar markers or engagement panel macro markers).
 */
export function extractStructuredChapters(ytInitialData: Record<string, unknown> | null): YouTubeChapter[] {
  if (!ytInitialData) return [];

  // 1. Player bar chapter markers (most common on desktop watch HTML)
  const chapterRenderers = findObjectsByKey(ytInitialData, "chapterRenderer");
  if (chapterRenderers.length > 0) {
    const chapters: YouTubeChapter[] = [];
    for (const ch of chapterRenderers) {
      const title = readText(ch.title).trim();
      const ms = Number(ch.timeRangeStartMillis);
      if (title && Number.isFinite(ms) && ms >= 0) {
        const startSeconds = Math.floor(ms / 1000);
        chapters.push({
          title,
          startSeconds,
          formattedTime: formatTimestamp(startSeconds),
        });
      }
    }
    if (chapters.length > 0) return deduplicateAndSortChapters(chapters);
  }

  // 2. Engagement panel macro markers (fallback structured source)
  const macroItems = findObjectsByKey(ytInitialData, "macroMarkersListItemRenderer");
  if (macroItems.length > 0) {
    const chapters: YouTubeChapter[] = [];
    for (const item of macroItems) {
      const title = readText(item.title).trim();
      const timeStr = readText(item.timeDescription).trim();
      const onTap = item.onTap as Record<string, unknown> | undefined;
      const watchEndpoint = onTap?.watchEndpoint as Record<string, unknown> | undefined;
      const startFromTap = watchEndpoint?.startTimeSeconds !== undefined ? Number(watchEndpoint.startTimeSeconds) : null;
      const startSeconds = startFromTap !== null && Number.isFinite(startFromTap)
        ? Math.floor(startFromTap)
        : parseTimestampToSeconds(timeStr);
      if (title && startSeconds !== null) {
        chapters.push({
          title,
          startSeconds,
          formattedTime: formatTimestamp(startSeconds),
        });
      }
    }
    if (chapters.length > 0) return deduplicateAndSortChapters(chapters);
  }

  return [];
}

/**
 * Fallback: parse timestamp chapters directly from a video description.
 * Matches formats like:
 *   00:00 Intro
 *   [04:15] Deep Dive
 *   1:02:30 - Wrap Up
 *   Intro - 00:00
 */
export function parseChaptersFromDescription(description: string): YouTubeChapter[] {
  if (!description) return [];
  const lines = description.split(/\r?\n/);
  const found: YouTubeChapter[] = [];

  const leadingRe = /^\s*(?:[-*•]\s*)?[\[(]?(\d{1,2}:\d{2}(?::\d{2})?)[\])]?\s*(?:[-–—:|]\s*)?(.+?)\s*$/;
  const trailingRe = /^\s*(?:[-*•]\s*)?(.+?)\s*(?:[-–—:|]\s*)[\[(]?(\d{1,2}:\d{2}(?::\d{2})?)[\])]?\s*$/;

  for (const line of lines) {
    if (!line.trim()) continue;
    let timeStr = "";
    let title = "";

    const mLead = leadingRe.exec(line);
    if (mLead) {
      timeStr = mLead[1];
      title = mLead[2];
    } else {
      const mTrail = trailingRe.exec(line);
      if (mTrail && !/https?:\/\//i.test(mTrail[1])) {
        title = mTrail[1];
        timeStr = mTrail[2];
      }
    }

    if (!timeStr || !title) continue;
    const sec = parseTimestampToSeconds(timeStr);
    if (sec === null) continue;
    const cleanTitle = title.replace(/^[-–—:|•\s]+|[-–—:|•\s]+$/g, "").trim();
    if (!cleanTitle) continue;
    found.push({
      title: cleanTitle,
      startSeconds: sec,
      formattedTime: formatTimestamp(sec),
    });
  }

  // Require at least 2 chapters to avoid false positives from a single timestamp mention in prose.
  if (found.length < 2) return [];
  return deduplicateAndSortChapters(found);
}

function deduplicateAndSortChapters(chapters: YouTubeChapter[]): YouTubeChapter[] {
  const seen = new Set<number>();
  return [...chapters]
    .sort((a, b) => a.startSeconds - b.startSeconds)
    .filter((ch) => {
      if (seen.has(ch.startSeconds)) return false;
      seen.add(ch.startSeconds);
      return true;
    });
}

/**
 * Parse video metadata and chapters from raw YouTube watch page HTML.
 */
export function parseVideoHtml(videoId: string, html: string): YouTubeVideoMeta {
  const playerResponse =
    extractJsonAfterMarker(html, "var ytInitialPlayerResponse =") ||
    extractJsonAfterMarker(html, "ytInitialPlayerResponse =");
  const initialData =
    extractJsonAfterMarker(html, "var ytInitialData =") ||
    extractJsonAfterMarker(html, "ytInitialData =");

  if (!playerResponse && !initialData) {
    throw new Error("Could not extract video data from YouTube. YouTube may have blocked the request or the video is unavailable.");
  }

  const details = (playerResponse?.videoDetails as Record<string, unknown>) || {};
  const micro = (
    (playerResponse?.microformat as Record<string, unknown>)?.playerMicroformatRenderer as Record<string, unknown>
  ) || {};

  const title = String(details.title || readText(micro.title) || "").trim();
  if (!title) {
    const playability = (playerResponse?.playabilityStatus as Record<string, unknown>) || {};
    const reason = String(playability.reason || "Video is private, deleted, or unavailable.");
    throw new Error(`YouTube video unavailable: ${reason}`);
  }

  const channel = String(details.author || micro.ownerChannelName || "Unknown Channel").trim();
  const durationSeconds = Number(details.lengthSeconds || micro.lengthSeconds || 0) || 0;
  const description = String(details.shortDescription || readText(micro.description) || "");
  const publishDate = String(micro.publishDate || micro.uploadDate || "").slice(0, 10);

  const thumbs = (details.thumbnail as Record<string, unknown>)?.thumbnails as Array<{ url?: string }> | undefined;
  const thumbnailUrl =
    thumbs && thumbs.length > 0 && thumbs[thumbs.length - 1]?.url
      ? String(thumbs[thumbs.length - 1].url)
      : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  let chapters = extractStructuredChapters(initialData);
  if (chapters.length === 0) {
    chapters = parseChaptersFromDescription(description);
  }

  return {
    videoId,
    title,
    channel,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    thumbnailUrl,
    publishDate,
    durationSeconds,
    durationFormatted: formatTimestamp(durationSeconds),
    description,
    chapters,
  };
}

/**
 * Parse playlist metadata and ordered videos from raw YouTube playlist page HTML.
 */
export function parsePlaylistHtml(playlistId: string, html: string): YouTubePlaylistMeta {
  const initialData =
    extractJsonAfterMarker(html, "var ytInitialData =") ||
    extractJsonAfterMarker(html, "ytInitialData =");

  if (!initialData) {
    throw new Error("Could not extract playlist data from YouTube. Make sure the playlist is public or unlisted.");
  }

  // Playlist title
  const metaRenderers = findObjectsByKey(initialData, "playlistMetadataRenderer");
  const headerRenderers = findObjectsByKey(initialData, "playlistHeaderRenderer");
  const pageHeaderRenderers = findObjectsByKey(initialData, "pageHeaderRenderer");

  const title = (
    String(metaRenderers[0]?.title || "") ||
    readText(headerRenderers[0]?.title) ||
    String(pageHeaderRenderers[0]?.pageTitle || "")
  ).trim();

  if (!title) {
    throw new Error("Playlist not found or is private.");
  }

  // Playlist author
  let author = readText(headerRenderers[0]?.ownerText).trim();
  if (!author) {
    const metadataParts = findObjectsByKey(initialData, "metadataParts");
    for (const mp of metadataParts) {
      const candidate = readText((mp as Record<string, unknown>).text).replace(/^by\s+/i, "").trim();
      if (candidate) {
        author = candidate;
        break;
      }
    }
  }
  if (!author) author = "YouTube";

  // Ordered videos — support both legacy playlistVideoRenderer and 2025+ lockupViewModel
  const videos: YouTubePlaylistItem[] = [];
  const seenIds = new Set<string>();

  const videoRenderers = findObjectsByKey(initialData, "playlistVideoRenderer");
  for (const vr of videoRenderers) {
    const videoId = String(vr.videoId || "").trim();
    if (!videoId || seenIds.has(videoId)) continue;
    const vidTitle = readText(vr.title).trim();
    if (!vidTitle || /^\[(Deleted|Private) video\]$/i.test(vidTitle)) continue;
    seenIds.add(videoId);

    const durSec = Number(vr.lengthSeconds || 0) || 0;
    const durText = readText(vr.lengthText).trim() || (durSec > 0 ? formatTimestamp(durSec) : "");

    videos.push({
      index: videos.length + 1,
      videoId,
      title: vidTitle,
      durationSeconds: durSec,
      durationFormatted: durText,
      url: `https://www.youtube.com/watch?v=${videoId}`,
    });
  }

  if (videos.length === 0) {
    const lockups = findObjectsByKey(initialData, "lockupViewModel");
    for (const lu of lockups) {
      const contentType = String(lu.contentType || "");
      if (contentType && contentType !== "LOCKUP_CONTENT_TYPE_VIDEO") continue;
      const videoId = String(lu.contentId || "").trim();
      if (!videoId || seenIds.has(videoId)) continue;

      const meta = (lu.metadata as Record<string, unknown> | undefined)?.lockupMetadataViewModel as
        | Record<string, unknown>
        | undefined;
      const vidTitle = readText(meta?.title).trim();
      if (!vidTitle || /^\[(Deleted|Private) video\]$/i.test(vidTitle)) continue;
      seenIds.add(videoId);

      // Extract duration badge from thumbnail overlays if present
      let durText = "";
      let durSec = 0;
      const badges = findObjectsByKey(lu.contentImage, "thumbnailBadgeViewModel");
      for (const b of badges) {
        const candidate = String(b.text || "").trim();
        const parsed = parseTimestampToSeconds(candidate);
        if (parsed !== null && parsed > 0) {
          durSec = parsed;
          durText = candidate;
          break;
        }
      }

      videos.push({
        index: videos.length + 1,
        videoId,
        title: vidTitle,
        durationSeconds: durSec,
        durationFormatted: durText,
        url: `https://www.youtube.com/watch?v=${videoId}`,
      });
    }
  }

  if (videos.length === 0) {
    throw new Error("No playable videos found in this playlist.");
  }

  return {
    playlistId,
    title,
    author,
    url: `https://www.youtube.com/playlist?list=${playlistId}`,
    videos,
  };
}

/**
 * Fetch and parse a single YouTube video using Obsidian's requestUrl (CORS-free, mobile-safe).
 */
export async function fetchYouTubeVideo(videoId: string): Promise<YouTubeVideoMeta> {
  const res = await requestUrl({
    url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en`,
    method: "GET",
    headers: YT_HEADERS,
    throw: false,
  });

  if (res.status !== 200) {
    throw new Error(`YouTube returned HTTP ${res.status} while fetching video.`);
  }
  return parseVideoHtml(videoId, res.text);
}

/**
 * Fetch and parse a YouTube playlist using Obsidian's requestUrl.
 */
export async function fetchYouTubePlaylist(playlistId: string): Promise<YouTubePlaylistMeta> {
  const res = await requestUrl({
    url: `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}&hl=en`,
    method: "GET",
    headers: YT_HEADERS,
    throw: false,
  });

  if (res.status !== 200) {
    throw new Error(`YouTube returned HTTP ${res.status} while fetching playlist.`);
  }
  return parsePlaylistHtml(playlistId, res.text);
}
