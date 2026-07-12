import { describe, expect, it } from "vitest";
import { candidateScore, normalize, searchQueries, versionTags } from "../src/providers/shared";

const track = (title: string, artists = ["洛天依"], durationMs = 240_000) => ({ id: "spotify-id", title, artists, album: "", durationMs });

describe("provider candidate matching", () => {
  it("compares Traditional and Simplified Chinese consistently", () => {
    expect(normalize("樂鳴東方")).toBe(normalize("乐鸣东方"));
    expect(searchQueries(track("樂鳴東方"))).toContain("乐鸣东方 洛天依");
  });

  it("accepts common platform artist suffixes", () => {
    expect(candidateScore(track("乐鸣东方"), "乐鸣东方", ["洛天依Official"], 240_000)).toBeGreaterThanOrEqual(100);
    expect(candidateScore(track("Example", ["星尘Infinity"]), "Example", ["星尘"], 240_000)).toBeGreaterThanOrEqual(100);
  });

  it("does not silently replace a DJ or remix version with the original", () => {
    expect(versionTags("Example (DJ Remix)")).toEqual(new Set(["remix", "dj"]));
    expect(candidateScore(track("Example (DJ Remix)"), "Example", ["洛天依"], 240_000)).toBe(-100);
  });

  it("allows a close-duration artist match when title scripts differ", () => {
    expect(candidateScore(track("Hikari", ["初音ミク"]), "光", ["初音ミク"], 240_500)).toBeGreaterThanOrEqual(45);
    expect(candidateScore(track("Hikari", ["初音ミク"]), "光", ["別の歌手"], 240_500)).toBeLessThan(45);
  });
});
