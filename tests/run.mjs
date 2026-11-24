// Unit tests for YouTube Study Hub. Run with: node tests/run.mjs (after build)
import assert from "assert";
import Module from "module";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// We test the pure TypeScript modules by bundling them or importing compiled main/helpers via esbuild.
import esbuild from "esbuild";

const fakeObsidian = {
  Plugin: class {},
  PluginSettingTab: class {},
  Setting: class {},
  Notice: class { hide() {} setMessage() {} },
  Modal: class {},
  TFile: class {},
  normalizePath: (p) => String(p).replace(/\/+/g, "/").replace(/^\/|\/$/g, ""),
  requestUrl: async () => ({ status: 404, text: "" }),
};

const origLoad = Module._load;
Module._load = function (req, ...rest) {
  return req === "obsidian" ? fakeObsidian : origLoad.call(this, req, ...rest);
};

// Bundle parser + noteGenerator in-memory for direct testing
const built = await esbuild.build({
  stdin: {
    contents: `
      export * from "./src/youtubeParser.ts";
      export * from "./src/noteGenerator.ts";
      export { DEFAULT_SETTINGS } from "./src/types.ts";
    `,
    resolveDir: path.join(__dirname, ".."),
    loader: "ts",
  },
  bundle: true,
  write: false,
  format: "cjs",
  external: ["obsidian"],
});

const realRequire = Module.createRequire(import.meta.url);
const customRequire = (id) => (id === "obsidian" ? fakeObsidian : realRequire(id));

const mod = { exports: {} };
const fn = new Function("require", "module", "exports", built.outputFiles[0].text);
fn(customRequire, mod, mod.exports);
const lib = mod.exports;

// --- URL parsing
assert.deepStrictEqual(lib.parseYouTubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), {
  type: "video",
  videoId: "dQw4w9WgXcQ",
});
assert.deepStrictEqual(lib.parseYouTubeUrl("https://youtu.be/dQw4w9WgXcQ?t=42"), {
  type: "video",
  videoId: "dQw4w9WgXcQ",
});
assert.deepStrictEqual(lib.parseYouTubeUrl("https://www.youtube.com/playlist?list=PL1234567890abcdef"), {
  type: "playlist",
  playlistId: "PL1234567890abcdef",
});
assert.deepStrictEqual(
  lib.parseYouTubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1234567890abcdef"),
  {
    type: "both",
    videoId: "dQw4w9WgXcQ",
    playlistId: "PL1234567890abcdef",
  }
);
assert.strictEqual(lib.parseYouTubeUrl("https://example.com/not-youtube").type, "invalid");
console.log("url parsing ok");

// --- Timestamps
assert.strictEqual(lib.formatTimestamp(255), "04:15");
assert.strictEqual(lib.formatTimestamp(3750), "01:02:30");
assert.strictEqual(lib.parseTimestampToSeconds("4:15"), 255);
assert.strictEqual(lib.parseTimestampToSeconds("1:02:30"), 3750);
assert.strictEqual(lib.parseTimestampToSeconds("bad"), null);
console.log("timestamps ok");

// --- Video HTML parsing (structured chapters + fallback description chapters)
const fakeVideoHtml = `
<html><script>
var ytInitialPlayerResponse = {"videoDetails":{"videoId":"abc12345678","title":"TypeScript Deep Dive","author":"Dev Academy","lengthSeconds":"1800","shortDescription":"Learn TS\\n0:00 Intro\\n04:15 Generics","thumbnail":{"thumbnails":[{"url":"https://i.ytimg.com/vi/abc12345678/maxresdefault.jpg"}]}},"microformat":{"playerMicroformatRenderer":{"publishDate":"2026-10-12"}}};
var ytInitialData = {"playerOverlays":{"playerOverlayRenderer":{"decoratedPlayerBarRenderer":{"decoratedPlayerBarRenderer":{"playerBar":{"multiMarkersPlayerBarRenderer":{"markersMap":[{"key":"DESCRIPTION_CHAPTERS","value":{"chapters":[{"chapterRenderer":{"title":{"simpleText":"Introduction"},"timeRangeStartMillis":0}},{"chapterRenderer":{"title":{"simpleText":"Type Narrowing"},"timeRangeStartMillis":255000}}]}}]}}}}}}};
</script></html>
`;
const video = lib.parseVideoHtml("abc12345678", fakeVideoHtml);
assert.strictEqual(video.title, "TypeScript Deep Dive");
assert.strictEqual(video.channel, "Dev Academy");
assert.strictEqual(video.chapters.length, 2);
assert.strictEqual(video.chapters[1].formattedTime, "04:15");
assert.strictEqual(video.chapters[1].title, "Type Narrowing");

// Description fallback
const descChapters = lib.parseChaptersFromDescription(
  "Course outline:\n00:00 Welcome\n[05:30] Core Concepts\n1:02:00 - Final Project\n"
);
assert.strictEqual(descChapters.length, 3);
assert.strictEqual(descChapters[1].startSeconds, 330);
assert.strictEqual(descChapters[2].title, "Final Project");
console.log("video parsing ok");

// --- Playlist HTML parsing
const fakePlaylistJson = {
  metadata: { playlistMetadataRenderer: { title: "Obsidian Mastery: Full Course" } },
  header: { playlistHeaderRenderer: { ownerText: { runs: [{ text: "PKM Lab" }] } } },
  contents: {
    twoColumnBrowseResultsRenderer: {
      tabs: [
        {
          tabRenderer: {
            content: {
              sectionListRenderer: {
                contents: [
                  {
                    itemSectionRenderer: {
                      contents: [
                        {
                          playlistVideoListRenderer: {
                            contents: [
                              { playlistVideoRenderer: { videoId: "vid00000001", title: { runs: [{ text: "Lesson One" }] }, lengthSeconds: "420" } },
                              { playlistVideoRenderer: { videoId: "vid00000002", title: { runs: [{ text: "Lesson Two" }] }, lengthSeconds: "615" } },
                              { playlistVideoRenderer: { videoId: "vid00000003", title: { runs: [{ text: "[Deleted video]" }] } } },
                            ],
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      ],
    },
  },
};
const fakePlaylistHtml = `<html><script>var ytInitialData = ${JSON.stringify(fakePlaylistJson)};</script></html>`;
const pl = lib.parsePlaylistHtml("PLtest123456", fakePlaylistHtml);
assert.strictEqual(pl.title, "Obsidian Mastery: Full Course");
assert.strictEqual(pl.author, "PKM Lab");
assert.strictEqual(pl.videos.length, 2, "deleted video must be skipped");
assert.strictEqual(pl.videos[0].videoId, "vid00000001");
assert.strictEqual(pl.videos[1].durationFormatted, "10:15");

// Modern lockupViewModel playlist format
const fakeLockupPlaylistJson = {
  metadata: { playlistMetadataRenderer: { title: "Modern React Course" } },
  header: { playlistHeaderRenderer: { ownerText: { runs: [{ text: "Net Ninja" }] } } },
  contents: {
    items: [
      {
        lockupViewModel: {
          contentType: "LOCKUP_CONTENT_TYPE_VIDEO",
          contentId: "j942wKiXFu8",
          metadata: { lockupMetadataViewModel: { title: { content: "Lesson 1 - Intro" } } },
          contentImage: {
            thumbnailViewModel: {
              overlays: [{ thumbnailBottomOverlayViewModel: { badges: [{ thumbnailBadgeViewModel: { text: "6:07" } }] } }],
            },
          },
        },
      },
    ],
  },
};
const pl2 = lib.parsePlaylistHtml("PLmodern123", `<script>var ytInitialData = ${JSON.stringify(fakeLockupPlaylistJson)};</script>`);
assert.strictEqual(pl2.videos.length, 1);
assert.strictEqual(pl2.videos[0].videoId, "j942wKiXFu8");
assert.strictEqual(pl2.videos[0].title, "Lesson 1 - Intro");
assert.strictEqual(pl2.videos[0].durationSeconds, 367);
console.log("playlist parsing ok");

// --- Note generation, sanitization & progress bar updates
assert.strictEqual(lib.sanitizeFileName('How to: Build <Apps> / "Fast"? | 2026'), "How to Build Apps Fast 2026");

const noteMd = lib.generateVideoNoteMarkdown(video, lib.DEFAULT_SETTINGS);
assert.ok(noteMd.includes('title: "TypeScript Deep Dive"'));
assert.ok(noteMd.includes("## [04:15](https://youtu.be/abc12345678?t=255) Type Narrowing"));

const lessonNames = pl.videos.map((v) => lib.formatLessonBaseName(v.index, v.title, pl.videos.length));
assert.deepStrictEqual(lessonNames, ["01 - Lesson One", "02 - Lesson Two"]);

const idxMd = lib.generateCourseIndexMarkdown(pl, lessonNames);
assert.ok(idxMd.includes("- [ ] [[01 - Lesson One]] (07:00)"));
assert.ok(idxMd.includes('value="0" max="2"'));

const ticked = idxMd.replace("- [ ] [[01 - Lesson One]]", "- [x] [[01 - Lesson One]]");
const upd1 = lib.updateCourseIndexProgress(ticked);
assert.ok(upd1 && upd1.completed === 1 && upd1.total === 2 && upd1.status === "in-progress");
assert.ok(upd1.updated.includes('value="1" max="2"'));
assert.ok(upd1.updated.includes("status: in-progress"));

const allTicked = upd1.updated.replace("- [ ] [[02 - Lesson Two]]", "- [x] [[02 - Lesson Two]]");
const upd2 = lib.updateCourseIndexProgress(allTicked);
assert.ok(upd2 && upd2.completed === 2 && upd2.status === "completed");
assert.ok(upd2.updated.includes("status: completed"));
console.log("note generation & progress ok");

console.log("all tests passed");
