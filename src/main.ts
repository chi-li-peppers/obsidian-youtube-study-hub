import { Notice, Plugin, TAbstractFile, TFile, normalizePath } from "obsidian";
import {
  DEFAULT_SETTINGS,
  DuplicateResolution,
  YouTubeStudyHubSettings,
} from "./types";
import {
  ensureFolder,
  findUniqueFilePath,
  formatLessonBaseName,
  generateCourseIndexMarkdown,
  generateLightweightLessonMarkdown,
  generateVideoNoteMarkdown,
  getExistingFile,
  renderChaptersMarkdown,
  sanitizeFileName,
  updateCourseIndexProgress,
} from "./noteGenerator";
import {
  fetchYouTubePlaylist,
  fetchYouTubeVideo,
  parseYouTubeUrl,
} from "./youtubeParser";
import { DuplicateNoteModal, ImportModal, ImportModalResult } from "./ui/ImportModal";
import { YouTubeStudyHubSettingTab } from "./settings";

const COURSE_INDEX_BASENAME = "_Course Index";

export default class YouTubeStudyHubPlugin extends Plugin {
  settings: YouTubeStudyHubSettings = { ...DEFAULT_SETTINGS };
  private saveTimer: number | null = null;
  private progressTimers = new Map<string, number>();
  private updatingProgressPaths = new Set<string>();

  async onload(): Promise<void> {
    await this.loadSettings();
    this.applyThemePreset();

    this.addRibbonIcon("play-circle", "Import YouTube video or course", () => {
      this.openImportModal();
    });

    this.addCommand({
      id: "import-youtube-video",
      name: "Import YouTube video & chapters",
      callback: () => this.openImportModal("video"),
    });

    this.addCommand({
      id: "import-youtube-playlist",
      name: "Import YouTube playlist as course",
      callback: () => this.openImportModal("playlist"),
    });

    this.addCommand({
      id: "fetch-chapters-active-note",
      name: "Fetch chapters for active video note",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return false;
        const vid = this.getVideoIdFromFile(file);
        if (!vid) return false;
        if (!checking) {
          this.fetchChaptersForActiveNote(file, vid);
        }
        return true;
      },
    });

    this.addSettingTab(new YouTubeStudyHubSettingTab(this.app, this));

    // Auto-update course progress bar when checkboxes in _Course Index.md change
    this.registerEvent(
      this.app.vault.on("modify", (file: TAbstractFile) => {
        if (!this.settings.autoUpdateCourseProgress) return;
        if (!(file instanceof TFile) || file.extension !== "md") return;
        if (file.basename !== COURSE_INDEX_BASENAME) return;
        if (this.updatingProgressPaths.has(file.path)) return;
        this.scheduleCourseProgressUpdate(file);
      })
    );
  }

  onunload(): void {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
      void this.saveData(this.settings);
    }
    for (const timer of this.progressTimers.values()) {
      window.clearTimeout(timer);
    }
    this.progressTimers.clear();
    this.clearThemeClasses();
  }

  private clearThemeClasses(): void {
    if (typeof document === "undefined" || !document.body) return;
    document.body.classList.remove(
      "ytsh-theme-crimson",
      "ytsh-theme-violet",
      "ytsh-theme-emerald"
    );
  }

  applyThemePreset(): void {
    this.clearThemeClasses();
    if (typeof document === "undefined" || !document.body) return;
    if (this.settings.themePreset !== "obsidian") {
      document.body.classList.add(`ytsh-theme-${this.settings.themePreset}`);
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.applyThemePreset();
    await this.saveData(this.settings);
  }

  scheduleSaveSettings(delayMs = 500): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.saveSettings();
    }, delayMs);
  }

  private openImportModal(defaultMode?: "video" | "playlist"): void {
    new ImportModal(
      this.app,
      async (res) => {
        await this.handleImport(res);
      },
      defaultMode
    ).open();
  }

  private async handleImport(res: ImportModalResult): Promise<void> {
    if (res.mode === "video" && res.videoId) {
      await this.importSingleVideo(res.videoId);
    } else if (res.mode === "playlist" && res.playlistId) {
      await this.importPlaylistCourse(res.playlistId, res.fetchPlaylistChapters);
    } else {
      new Notice("YouTube Study Hub: invalid YouTube URL.");
    }
  }

  private promptDuplicate(filePath: string): Promise<DuplicateResolution> {
    return new Promise((resolve) => {
      new DuplicateNoteModal(this.app, filePath, resolve).open();
    });
  }

  private async importSingleVideo(videoId: string): Promise<void> {
    const progress = new Notice("YouTube Study Hub: fetching video & chapters…", 0);
    try {
      const video = await fetchYouTubeVideo(videoId);
      const folder = await ensureFolder(this.app, this.settings.videosFolder);
      const baseName = sanitizeFileName(video.title, videoId);
      const desiredPath = normalizePath(folder ? `${folder}/${baseName}.md` : `${baseName}.md`);

      let targetPath = desiredPath;
      const existing = getExistingFile(this.app, desiredPath);
      if (existing) {
        progress.hide();
        const choice = await this.promptDuplicate(desiredPath);
        if (choice.action === "cancel") return;
        if (choice.action === "open") {
          await this.app.workspace.getLeaf(false).openFile(existing);
          return;
        }
        targetPath = findUniqueFilePath(this.app, folder, baseName);
      }

      const md = generateVideoNoteMarkdown(video, this.settings);
      const created = await this.app.vault.create(targetPath, md);
      const chapMsg =
        video.chapters.length > 0
          ? `${video.chapters.length} chapter${video.chapters.length === 1 ? "" : "s"}`
          : "no chapters found";
      new Notice(`YouTube Study Hub: imported "${video.title}" (${chapMsg})`, 6000);

      if (this.settings.autoOpenNote) {
        await this.app.workspace.getLeaf(false).openFile(created);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      new Notice(`YouTube Study Hub: ${msg}`, 9000);
    } finally {
      progress.hide();
    }
  }

  private async importPlaylistCourse(playlistId: string, fetchChapters: boolean): Promise<void> {
    const progress = new Notice("YouTube Study Hub: fetching playlist…", 0);
    try {
      const playlist = await fetchYouTubePlaylist(playlistId);
      const coursesRoot = await ensureFolder(this.app, this.settings.coursesFolder);
      const courseFolderName = sanitizeFileName(playlist.title, playlistId);
      const courseFolder = await ensureFolder(
        this.app,
        coursesRoot ? `${coursesRoot}/${courseFolderName}` : courseFolderName
      );

      const indexPath = normalizePath(`${courseFolder}/${COURSE_INDEX_BASENAME}.md`);
      const existingIndex = getExistingFile(this.app, indexPath);
      if (existingIndex) {
        progress.hide();
        const choice = await this.promptDuplicate(indexPath);
        if (choice.action === "cancel") return;
        if (choice.action === "open") {
          await this.app.workspace.getLeaf(false).openFile(existingIndex);
          return;
        }
      }

      const total = playlist.videos.length;
      const lessonBaseNames: string[] = [];
      let createdCount = 0;
      let skippedCount = 0;

      for (let i = 0; i < total; i++) {
        const item = playlist.videos[i];
        const baseName = formatLessonBaseName(item.index, item.title, total);
        lessonBaseNames.push(baseName);
        const lessonPath = normalizePath(`${courseFolder}/${baseName}.md`);

        progress.setMessage(
          `YouTube Study Hub: creating lesson ${i + 1}/${total}${fetchChapters ? " (fetching chapters)" : ""}…`
        );

        if (getExistingFile(this.app, lessonPath)) {
          skippedCount++;
          continue;
        }

        let content: string;
        if (fetchChapters) {
          try {
            const fullVideo = await fetchYouTubeVideo(item.videoId);
            content = generateVideoNoteMarkdown(fullVideo, this.settings, {
              courseIndexLink: `${courseFolder}/${COURSE_INDEX_BASENAME}`,
              lessonIndex: item.index,
            });
          } catch {
            // Fall back to lightweight note if one video fails to fetch
            content = generateLightweightLessonMarkdown(
              item,
              playlist,
              this.settings,
              `${courseFolder}/${COURSE_INDEX_BASENAME}`
            );
          }
          if (i < total - 1) {
            await sleep(this.settings.playlistRequestDelayMs);
          }
        } else {
          content = generateLightweightLessonMarkdown(
            item,
            playlist,
            this.settings,
            `${courseFolder}/${COURSE_INDEX_BASENAME}`
          );
        }

        await this.app.vault.create(lessonPath, content);
        createdCount++;
      }

      const indexMd = generateCourseIndexMarkdown(playlist, lessonBaseNames);
      let indexFile: TFile;
      const existingAfter = getExistingFile(this.app, indexPath);
      if (existingAfter) {
        const altPath = findUniqueFilePath(this.app, courseFolder, COURSE_INDEX_BASENAME);
        indexFile = await this.app.vault.create(altPath, indexMd);
      } else {
        indexFile = await this.app.vault.create(indexPath, indexMd);
      }

      const skipNote = skippedCount > 0 ? ` (${skippedCount} existing kept)` : "";
      new Notice(
        `YouTube Study Hub: created course "${playlist.title}" — ${createdCount}/${total} lessons${skipNote}`,
        7000
      );

      if (this.settings.autoOpenNote) {
        await this.app.workspace.getLeaf(false).openFile(indexFile);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      new Notice(`YouTube Study Hub: ${msg}`, 9000);
    } finally {
      progress.hide();
    }
  }

  private getVideoIdFromFile(file: TFile): string | null {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm) return null;
    if (typeof fm.video_id === "string" && /^[A-Za-z0-9_-]{11}$/.test(fm.video_id.trim())) {
      return fm.video_id.trim();
    }
    if (typeof fm.url === "string") {
      const parsed = parseYouTubeUrl(fm.url);
      if (parsed.videoId) return parsed.videoId;
    }
    return null;
  }

  private async fetchChaptersForActiveNote(file: TFile, videoId: string): Promise<void> {
    const progress = new Notice("YouTube Study Hub: fetching chapters…", 0);
    try {
      const video = await fetchYouTubeVideo(videoId);
      if (!video.chapters.length) {
        new Notice("YouTube Study Hub: no chapters found for this video.", 5000);
        return;
      }
      const chaptersMd = renderChaptersMarkdown(
        video.videoId,
        video.chapters,
        this.settings.chapterHeadingLevel
      );
      await this.app.vault.process(file, (data) => {
        const emptyNotesRe = new RegExp(`\\n${this.settings.chapterHeadingLevel} Notes\\s*$`);
        if (emptyNotesRe.test(data)) {
          return data.replace(emptyNotesRe, `\n${chaptersMd}`);
        }
        return `${data.replace(/\s+$/, "")}\n\n${chaptersMd}`;
      });
      new Notice(`YouTube Study Hub: added ${video.chapters.length} chapters to "${file.basename}"`, 6000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      new Notice(`YouTube Study Hub: ${msg}`, 9000);
    } finally {
      progress.hide();
    }
  }

  private scheduleCourseProgressUpdate(file: TFile): void {
    const prev = this.progressTimers.get(file.path);
    if (prev !== undefined) window.clearTimeout(prev);

    const timer = window.setTimeout(async () => {
      this.progressTimers.delete(file.path);
      if (this.updatingProgressPaths.has(file.path)) return;
      this.updatingProgressPaths.add(file.path);
      try {
        await this.app.vault.process(file, (data) => {
          const res = updateCourseIndexProgress(data);
          return res ? res.updated : data;
        });
      } finally {
        window.setTimeout(() => this.updatingProgressPaths.delete(file.path), 300);
      }
    }, 350);

    this.progressTimers.set(file.path, timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
