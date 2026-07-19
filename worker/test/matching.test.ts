import { describe, expect, it } from "vitest";
import {
  assessCandidate,
  candidateScore,
  isAcceptableCandidate,
  isStrongCandidate,
  matchMetadata,
  normalize,
  searchQueries,
  versionTags,
} from "../src/providers/shared";

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

  it("uses provider-supplied localized aliases without replacing canonical metadata", () => {
    const assessment = assessCandidate(track("瑠璃の鳥", ["霜月はるか"], 284_000), {
      title: "琉璃之鸟",
      titleAliases: ["瑠璃の鳥"],
      artists: ["霜月遥"],
      artistAliases: ["霜月遥 (霜月はるか)", "Haruka Shimotsuki"],
      durationMs: 284_200,
    });

    expect(assessment.evidence.title).toBe(1);
    expect(assessment.evidence.artists).toBeGreaterThanOrEqual(0.85);
    expect(isStrongCandidate(assessment)).toBe(true);
  });

  it("does not turn same-script bracket labels into artist aliases", () => {
    const assessment = assessCandidate(track("Signal", ["官方"]), {
      title: "Signal",
      artists: ["主唱 (官方)"],
      durationMs: 240_000,
    });

    expect(assessment.evidence.artists).toBe(0);
  });

  it("records a DJ or remix difference without vetoing otherwise strong identity evidence", () => {
    expect(versionTags("Example (DJ Remix)")).toEqual(new Set(["remix", "dj"]));
    const assessment = assessCandidate(track("Example (DJ Remix)"), {
      title: "Example",
      artists: ["洛天依"],
      durationMs: 240_000,
    });
    expect(assessment.evidence.versionConflict).toBe(true);
    expect(isAcceptableCandidate(assessment)).toBe(true);
  });

  it("allows a close-duration artist match when title scripts differ", () => {
    expect(candidateScore(track("Hikari", ["初音ミク"]), "光", ["初音ミク"], 240_500)).toBeGreaterThanOrEqual(45);
    expect(candidateScore(track("Hikari", ["初音ミク"]), "光", ["別の歌手"], 240_500)).toBeLessThan(45);
  });

  it("exposes normalized confidence and selected metadata", () => {
    const match = matchMetadata(track("Example", ["Artist"]), "Example", ["Artist"], 240_000, "search");
    expect(match.confidence).toBeGreaterThan(0.9);
    expect(match.method).toBe("search");
    expect(match.title).toBe("Example");
  });

  it("builds a metadata-first query ladder before broad title-only searches", () => {
    const queries = searchQueries({
      ...track("Signal (feat. Guest)", ["Lead", "Guest"]),
      album: "Signal Album",
    });

    expect(queries[0]).toBe("Signal (feat. Guest) Lead Guest Signal Album");
    expect(queries).toContain("Signal Lead Guest");
    expect(queries.at(-1)).toBe("Signal (feat. Guest)");
  });

  it("treats feat and harmless edition labels as title evidence without erasing version conflicts", () => {
    const feat = assessCandidate(track("Signal (feat. Guest)", ["Lead", "Guest"]), {
      title: "Signal",
      artists: ["Lead", "Guest"],
      durationMs: 240_300,
    });
    const edition = assessCandidate(track("Signal", ["Lead"]), {
      title: "Signal (Explicit)",
      artists: ["Lead"],
      durationMs: 240_300,
    });

    expect(isAcceptableCandidate(feat)).toBe(true);
    expect(feat.evidence.title).toBeGreaterThanOrEqual(0.9);
    expect(isAcceptableCandidate(edition)).toBe(true);
    expect(edition.evidence.title).toBeGreaterThanOrEqual(0.9);
    expect(assessCandidate(track("Signal (Live)", ["Lead"]), {
      title: "Signal",
      artists: ["Lead"],
      durationMs: 240_300,
    }).evidence.versionConflict).toBe(true);
  });

  it("uses all artists and splits provider artist strings", () => {
    const assessment = assessCandidate(track("Duet", ["Lead", "Guest"]), {
      title: "Duet",
      artists: ["Lead / Guest"],
      durationMs: 240_200,
    });

    expect(assessment.evidence.artists).toBeGreaterThanOrEqual(0.9);
    expect(isStrongCandidate(assessment)).toBe(true);
  });

  it("uses album evidence to separate otherwise similar candidates", () => {
    const wanted = { ...track("Signal", ["Lead"]), album: "Original Album" };
    const matchingAlbum = assessCandidate(wanted, {
      title: "Signal",
      artists: ["Lead"],
      album: "Original Album",
      durationMs: 240_500,
    });
    const otherAlbum = assessCandidate(wanted, {
      title: "Signal",
      artists: ["Lead"],
      album: "Tribute Covers",
      durationMs: 240_500,
    });

    expect(matchingAlbum.score).toBeGreaterThan(otherAlbum.score);
    expect(matchingAlbum.evidence.album).toBe(1);
    expect(otherAlbum.evidence.album).toBe(0);
  });

  it("rejects an exact-title close-duration cover when artist and album disagree", () => {
    const assessment = assessCandidate({
      ...track("Bad Apple!!", ["nomico"]),
      album: "Lovelight",
      durationMs: 230_000,
    }, {
      title: "Bad Apple!!",
      artists: ["YaboiMatoi", "RichaadEB"],
      album: "Bad Apple!!",
      durationMs: 224_810,
    });

    expect(assessment.evidence.title).toBe(1);
    expect(assessment.evidence.artists).toBe(0);
    expect(assessment.coherent).toBe(true);
    expect(isAcceptableCandidate(assessment)).toBe(false);
  });

  it("keeps a cross-script title candidate when artist and duration strongly identify it", () => {
    const assessment = assessCandidate(track("Hikari", ["初音ミク"]), {
      title: "光",
      artists: ["初音ミク"],
      durationMs: 240_500,
    });

    expect(assessment.evidence.title).toBe(0);
    expect(assessment.coherent).toBe(true);
    expect(isAcceptableCandidate(assessment)).toBe(true);
  });

  it("recognizes named Chinese DJ editions and rejects an uncorroborated base-version fallback", () => {
    expect(versionTags("大東北我的家鄉(DJ何鵬版)")).toEqual(new Set(["dj"]));
    const assessment = assessCandidate(track("大東北我的家鄉(DJ何鵬版)", ["何玉"], 246_806), {
      title: "大东北我的家乡",
      artists: ["何玉"],
    });

    expect(assessment.evidence.versionConflict).toBe(true);
    expect(isAcceptableCandidate(assessment)).toBe(false);
  });

  it("keeps a localized NetEase album when its stable prefix, artist, and duration agree", () => {
    const wanted = {
      ...track("Sabaku ni sumu mamono", ["canoue"], 304_000),
      album: "Maple Leaf BOX (II Streaming ver.)",
    };
    const assessment = assessCandidate(wanted, {
      title: "砂漠に棲む魔物",
      artists: ["canoue"],
      album: "Maple Leaf BOX II 配信盤",
      durationMs: 303_973,
    });

    expect(assessment.evidence.title).toBe(0);
    expect(assessment.evidence.album).toBeGreaterThanOrEqual(0.7);
    expect(assessment.coherent).toBe(true);
    expect(isAcceptableCandidate(assessment)).toBe(true);
  });

  it("keeps a cross-script candidate when artist and duration outweigh a different album number", () => {
    const assessment = assessCandidate({
      ...track("Sabaku ni sumu mamono", ["canoue"], 304_000),
      album: "Maple Leaf BOX (II Streaming ver.)",
    }, {
      title: "砂漠に棲む魔物",
      artists: ["canoue"],
      album: "Maple Leaf BOX III 配信盤",
      durationMs: 303_973,
    });

    expect(assessment.evidence.album).toBeLessThan(0.6);
    expect(assessment.coherent).toBe(true);
    expect(isAcceptableCandidate(assessment)).toBe(true);
  });

  it("treats a contradictory album as weak evidence instead of a hard cross-script veto", () => {
    const assessment = assessCandidate({
      ...track("Hikari", ["初音ミク"]),
      album: "Original Album",
    }, {
      title: "光",
      artists: ["初音ミク"],
      album: "Different Album",
      durationMs: 240_500,
    });

    expect(assessment.evidence.album).toBe(0);
    expect(assessment.coherent).toBe(true);
    expect(isAcceptableCandidate(assessment)).toBe(true);
  });

  it("does not stop broad search on an exact title with no corroborating metadata", () => {
    const assessment = assessCandidate(track("Signal", ["Lead"]), {
      title: "Signal",
      artists: [],
    });

    expect(isAcceptableCandidate(assessment)).toBe(true);
    expect(isStrongCandidate(assessment)).toBe(false);
  });

  it("does not match a short single-artist name inside an unrelated name", () => {
    const assessment = assessCandidate(track("Signal", ["Li"]), {
      title: "Signal",
      artists: ["Olivia"],
      durationMs: 240_200,
    });

    expect(assessment.evidence.artists).toBe(0);
  });

  it("ranks the real DJ fixture above unrelated short KuGou candidates", () => {
    const wanted = {
      ...track("大東北我的家鄉(DJ何鵬版)", ["何玉"], 246_806),
      album: "大東北我的家鄉",
    };
    const kugouExact = assessCandidate(wanted, {
      title: "大东北我的家乡 (DJ何鹏版)",
      artists: ["何玉"],
      album: "大东北我的家乡",
      durationMs: 246_000,
    });
    const netease = assessCandidate(wanted, {
      title: "大东北我的家乡 (DJ版)",
      artists: ["何玉"],
      album: "大东北我的家乡",
      durationMs: 246_806,
    });
    const kugou = assessCandidate(wanted, {
      title: "大东北我的家乡",
      artists: ["DJ"],
      durationMs: 33_000,
    });

    expect(isAcceptableCandidate(kugouExact)).toBe(true);
    expect(isAcceptableCandidate(netease)).toBe(true);
    expect(isAcceptableCandidate(kugou)).toBe(false);
    expect(kugouExact.score).toBeGreaterThan(kugou.score);
    expect(netease.score).toBeGreaterThan(kugou.score);
  });
});
