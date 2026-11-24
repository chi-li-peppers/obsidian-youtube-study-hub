import { App, PluginSettingTab, Setting, SettingDefinitionItem } from "obsidian";
import type YouTubeStudyHubPlugin from "./main";
import { ThemePreset } from "./types";

export class YouTubeStudyHubSettingTab extends PluginSettingTab {
  plugin: YouTubeStudyHubPlugin;

  constructor(app: App, plugin: YouTubeStudyHubPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        type: "group",
        heading: "Folders",
        items: [
          {
            name: "Default folder for videos",
            desc: "Where single imported video notes are created.",
            control: {
              type: "text",
              key: "videosFolder",
              placeholder: "YouTube/Videos",
              defaultValue: "YouTube/Videos",
            },
          },
          {
            name: "Default folder for courses",
            desc: "Where playlist course folders are created.",
            control: {
              type: "text",
              key: "coursesFolder",
              placeholder: "YouTube/Courses",
              defaultValue: "YouTube/Courses",
            },
          },
        ],
      },
      {
        type: "group",
        heading: "Note formatting",
        items: [
          {
            name: "Include video embed",
            desc: "On: embeds the YouTube player at the top of the note. Off: inserts a clickable thumbnail instead.",
            control: {
              type: "toggle",
              key: "includeVideoEmbed",
              defaultValue: true,
            },
          },
          {
            name: "Heading level for chapters",
            desc: "Markdown heading level used for each imported chapter.",
            control: {
              type: "dropdown",
              key: "chapterHeadingLevel",
              defaultValue: "##",
              options: {
                "##": "Heading 2 (##)",
                "###": "Heading 3 (###)",
              },
            },
          },
          {
            name: "Auto-open created note",
            desc: "Open the newly created video note or course index automatically after import.",
            control: {
              type: "toggle",
              key: "autoOpenNote",
              defaultValue: true,
            },
          },
        ],
      },
      {
        type: "group",
        heading: "Appearance",
        items: [
          {
            name: "Theme style",
            desc: "Color theme for course progress bars, badges, and import controls.",
            control: {
              type: "dropdown",
              key: "themePreset",
              defaultValue: "obsidian",
              options: {
                obsidian: "Obsidian accent (default)",
                crimson: "YouTube Crimson",
                violet: "Electric Violet",
                emerald: "Emerald Study",
              },
            },
          },
        ],
      },
      {
        type: "group",
        heading: "Courses & playlists",
        items: [
          {
            name: "Auto-update course progress bar",
            desc: "Automatically recalculate the progress bar and status when you check off lessons in _Course Index.md.",
            control: {
              type: "toggle",
              key: "autoUpdateCourseProgress",
              defaultValue: true,
            },
          },
          {
            name: "Delay between playlist chapter requests (ms)",
            desc: "Pause between video requests when fetching chapters for an entire playlist, to avoid YouTube rate limits.",
            control: {
              type: "number",
              key: "playlistRequestDelayMs",
              placeholder: "650",
              defaultValue: 650,
            },
          },
        ],
      },
    ];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const s = this.plugin.settings;
    switch (key) {
      case "videosFolder":
        s.videosFolder = String(value || "").trim() || "YouTube/Videos";
        break;
      case "coursesFolder":
        s.coursesFolder = String(value || "").trim() || "YouTube/Courses";
        break;
      case "includeVideoEmbed":
        s.includeVideoEmbed = Boolean(value);
        break;
      case "chapterHeadingLevel":
        s.chapterHeadingLevel = value === "###" ? "###" : "##";
        break;
      case "autoOpenNote":
        s.autoOpenNote = Boolean(value);
        break;
      case "themePreset":
        s.themePreset =
          value === "crimson" || value === "violet" || value === "emerald" ? value : "obsidian";
        break;
      case "autoUpdateCourseProgress":
        s.autoUpdateCourseProgress = Boolean(value);
        break;
      case "playlistRequestDelayMs":
        s.playlistRequestDelayMs = Math.max(150, Math.min(5000, Math.floor(Number(value) || 650)));
        break;
      default:
        return;
    }
    await this.plugin.saveSettings();
  }

  display(): void {
    const { containerEl } = this;
    const s = this.plugin.settings;
    containerEl.empty();

    const intro = containerEl.createDiv({ cls: "setting-item-description ytsh-settings-intro" });
    intro.appendText("⭐ Enjoying YouTube Study Hub? A star on ");
    intro.createEl("a", {
      text: "GitHub",
      href: "https://github.com/chi-li-peppers/obsidian-youtube-study-hub",
    });
    intro.appendText(" helps other learners find it. Ideas or bugs? ");
    intro.createEl("a", {
      text: "Open an issue",
      href: "https://github.com/chi-li-peppers/obsidian-youtube-study-hub/issues",
    });
    intro.appendText(".");

    new Setting(containerEl).setName("Folders").setHeading();

    new Setting(containerEl)
      .setName("Default folder for videos")
      .setDesc("Where single imported video notes are created.")
      .addText((text) =>
        text
          .setPlaceholder("YouTube/Videos")
          .setValue(s.videosFolder)
          .onChange((val) => {
            s.videosFolder = val.trim() || "YouTube/Videos";
            this.plugin.scheduleSaveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Default folder for courses")
      .setDesc("Where playlist course folders are created.")
      .addText((text) =>
        text
          .setPlaceholder("YouTube/Courses")
          .setValue(s.coursesFolder)
          .onChange((val) => {
            s.coursesFolder = val.trim() || "YouTube/Courses";
            this.plugin.scheduleSaveSettings();
          })
      );

    new Setting(containerEl).setName("Note formatting").setHeading();

    new Setting(containerEl)
      .setName("Include video embed")
      .setDesc("On: embeds the YouTube player at the top of the note. Off: inserts a clickable thumbnail instead.")
      .addToggle((toggle) =>
        toggle.setValue(s.includeVideoEmbed).onChange(async (val) => {
          s.includeVideoEmbed = val;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Heading level for chapters")
      .setDesc("Markdown heading level used for each imported chapter.")
      .addDropdown((dd) =>
        dd
          .addOption("##", "Heading 2 (##)")
          .addOption("###", "Heading 3 (###)")
          .setValue(s.chapterHeadingLevel)
          .onChange(async (val) => {
            s.chapterHeadingLevel = val === "###" ? "###" : "##";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Auto-open created note")
      .setDesc("Open the newly created video note or course index automatically after import.")
      .addToggle((toggle) =>
        toggle.setValue(s.autoOpenNote).onChange(async (val) => {
          s.autoOpenNote = val;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl).setName("Appearance").setHeading();

    new Setting(containerEl)
      .setName("Theme style")
      .setDesc("Color theme for course progress bars, badges, and import controls.")
      .addDropdown((dd) =>
        dd
          .addOption("obsidian", "Obsidian accent (default)")
          .addOption("crimson", "YouTube Crimson")
          .addOption("violet", "Electric Violet")
          .addOption("emerald", "Emerald Study")
          .setValue(s.themePreset)
          .onChange(async (val) => {
            s.themePreset = val as ThemePreset;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName("Courses & playlists").setHeading();

    new Setting(containerEl)
      .setName("Auto-update course progress bar")
      .setDesc("Automatically recalculate the progress bar and status when you check off lessons in _Course Index.md.")
      .addToggle((toggle) =>
        toggle.setValue(s.autoUpdateCourseProgress).onChange(async (val) => {
          s.autoUpdateCourseProgress = val;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Delay between playlist chapter requests (ms)")
      .setDesc("Pause between video requests when fetching chapters for an entire playlist, to avoid YouTube rate limits.")
      .addText((text) =>
        text
          .setPlaceholder("650")
          .setValue(String(s.playlistRequestDelayMs))
          .onChange((val) => {
            const parsed = Math.max(150, Math.min(5000, Math.floor(Number(val) || 650)));
            s.playlistRequestDelayMs = parsed;
            this.plugin.scheduleSaveSettings();
          })
      );
  }
}
