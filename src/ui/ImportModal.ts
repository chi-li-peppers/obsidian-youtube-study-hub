import { App, Modal, Notice, Setting } from "obsidian";
import { DuplicateResolution, ParsedYouTubeUrl } from "../types";
import { parseYouTubeUrl } from "../youtubeParser";

export interface ImportModalResult {
  url: string;
  mode: "video" | "playlist";
  videoId?: string;
  playlistId?: string;
  fetchPlaylistChapters: boolean;
}

export class ImportModal extends Modal {
  private urlValue = "";
  private parsed: ParsedYouTubeUrl = { type: "invalid" };
  private chosenMode: "video" | "playlist" = "video";
  private fetchPlaylistChapters = false;
  private onSubmit: (result: ImportModalResult) => Promise<void>;

  private badgeEl!: HTMLElement;
  private modeChoiceContainer!: HTMLElement;
  private playlistOptionsEl!: HTMLElement;
  private submitBtn!: HTMLButtonElement;

  constructor(
    app: App,
    onSubmit: (result: ImportModalResult) => Promise<void>,
    initialMode?: "video" | "playlist",
    initialUrl?: string
  ) {
    super(app);
    this.onSubmit = onSubmit;
    if (initialMode) this.chosenMode = initialMode;
    if (initialUrl) this.urlValue = initialUrl;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Import from YouTube" });
    contentEl.createEl("p", {
      cls: "ytsh-modal-desc",
      text: "Paste a YouTube video or playlist URL. Videos import with auto-chapters; playlists become structured course folders.",
    });

    new Setting(contentEl)
      .setName("YouTube URL")
      .addText((text) => {
        text
          .setPlaceholder("https://www.youtube.com/watch?v=... or playlist?list=...")
          .setValue(this.urlValue)
          .onChange((val) => {
            this.urlValue = val;
            this.updateDetection();
          });
        text.inputEl.addEventListener("keydown", (evt) => {
          if (evt.key === "Enter") {
            evt.preventDefault();
            this.handleSubmit();
          }
        });
        window.setTimeout(() => text.inputEl.focus(), 20);
      });

    this.badgeEl = contentEl.createDiv({ cls: "ytsh-detect-badge" });
    this.modeChoiceContainer = contentEl.createDiv();
    this.playlistOptionsEl = contentEl.createDiv({ cls: "ytsh-playlist-options" });

    new Setting(this.playlistOptionsEl)
      .setName("Fetch chapters for all videos now")
      .setDesc(
        "Off (faster): creates lightweight lesson notes first — you can fetch chapters for any lesson later. On: fetches chapters for every video with a small delay."
      )
      .addToggle((toggle) => {
        toggle.setValue(this.fetchPlaylistChapters).onChange((val) => {
          this.fetchPlaylistChapters = val;
        });
      });

    const actions = contentEl.createDiv({ cls: "ytsh-modal-actions" });
    const cancelBtn = actions.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());

    this.submitBtn = actions.createEl("button", { text: "Import", cls: "mod-cta" });
    this.submitBtn.addEventListener("click", () => this.handleSubmit());

    this.updateDetection();
  }

  private updateDetection(): void {
    this.parsed = parseYouTubeUrl(this.urlValue);
    this.badgeEl.removeClass("is-video", "is-playlist", "is-error");
    this.modeChoiceContainer.empty();

    if (!this.urlValue.trim()) {
      this.badgeEl.setText("Waiting for a YouTube URL…");
      this.playlistOptionsEl.hide();
      this.submitBtn.disabled = true;
      return;
    }

    if (this.parsed.type === "invalid") {
      this.badgeEl.addClass("is-error");
      this.badgeEl.setText("Not a recognised YouTube video or playlist URL.");
      this.playlistOptionsEl.hide();
      this.submitBtn.disabled = true;
      return;
    }

    this.submitBtn.disabled = false;

    if (this.parsed.type === "video") {
      this.chosenMode = "video";
      this.badgeEl.addClass("is-video");
      this.badgeEl.setText(`Detected: Single video (${this.parsed.videoId})`);
      this.playlistOptionsEl.hide();
      this.submitBtn.setText("Import video");
    } else if (this.parsed.type === "playlist") {
      this.chosenMode = "playlist";
      this.badgeEl.addClass("is-playlist");
      this.badgeEl.setText(`Detected: Playlist course (${this.parsed.playlistId})`);
      this.playlistOptionsEl.show();
      this.submitBtn.setText("Import course");
    } else {
      // URL has both video ID and playlist ID (watch?v=...&list=...)
      this.badgeEl.addClass("is-playlist");
      this.badgeEl.setText("Detected: Video inside a playlist");
      new Setting(this.modeChoiceContainer)
        .setName("Import as")
        .addDropdown((dd) => {
          dd.addOption("playlist", "Entire playlist as course")
            .addOption("video", "Only this single video")
            .setValue(this.chosenMode)
            .onChange((v) => {
              this.chosenMode = v === "video" ? "video" : "playlist";
              if (this.chosenMode === "playlist") {
                this.playlistOptionsEl.show();
                this.submitBtn.setText("Import course");
              } else {
                this.playlistOptionsEl.hide();
                this.submitBtn.setText("Import video");
              }
            });
        });
      if (this.chosenMode === "playlist") {
        this.playlistOptionsEl.show();
        this.submitBtn.setText("Import course");
      } else {
        this.playlistOptionsEl.hide();
        this.submitBtn.setText("Import video");
      }
    }
  }

  private async handleSubmit(): Promise<void> {
    if (this.parsed.type === "invalid") {
      new Notice("YouTube Study Hub: please enter a valid YouTube URL.");
      return;
    }
    const mode = this.parsed.type === "both" ? this.chosenMode : this.parsed.type;
    const payload: ImportModalResult = {
      url: this.urlValue.trim(),
      mode,
      videoId: this.parsed.videoId,
      playlistId: this.parsed.playlistId,
      fetchPlaylistChapters: this.fetchPlaylistChapters,
    };
    this.close();
    await this.onSubmit(payload);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/**
 * Prompt the user when a target note already exists so we never silently overwrite their notes.
 */
export class DuplicateNoteModal extends Modal {
  private filePath: string;
  private resolveFn: (res: DuplicateResolution) => void;
  private resolved = false;

  constructor(app: App, filePath: string, resolveFn: (res: DuplicateResolution) => void) {
    super(app);
    this.filePath = filePath;
    this.resolveFn = resolveFn;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Note already exists" });
    contentEl.createEl("p", {
      cls: "ytsh-modal-desc",
      text: `A note already exists at "${this.filePath}". To protect your existing notes, it will not be overwritten.`,
    });

    const actions = contentEl.createDiv({ cls: "ytsh-modal-actions" });
    const cancelBtn = actions.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.finish({ action: "cancel" }));

    const copyBtn = actions.createEl("button", { text: "Create separate copy" });
    copyBtn.addEventListener("click", () => this.finish({ action: "create-copy" }));

    const openBtn = actions.createEl("button", { text: "Open existing note", cls: "mod-cta" });
    openBtn.addEventListener("click", () => this.finish({ action: "open" }));
  }

  private finish(res: DuplicateResolution): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolveFn(res);
    this.close();
  }

  onClose(): void {
    if (!this.resolved) {
      this.resolved = true;
      this.resolveFn({ action: "cancel" });
    }
    this.contentEl.empty();
  }
}
