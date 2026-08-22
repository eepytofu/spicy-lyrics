import { describe, expect, it } from "vitest";
import { toSyllableLyrics } from "../src/convert";

import {
  exactTimedLineReadings,
  isProviderReadingEvidence,
  kugouPhoneticLanes,
  parseProviderKanaLayer,
  providerLineReadingLane,
  providerReadingEvidence,
} from "../src/provider-readings";
import { kugouLineReadings, parseKrc, parseKrcLanguage } from "../src/providers/kugou";
import { attachQqSidecars, parseQrc, qqLineReadings } from "../src/providers/qq";

describe("provider Kana contract", () => {
  it("keeps grouped jukujikun indivisible and preserves authored internal silence", () => {
    const raw = ["[kana:2あ(1000,363)し(1363,432)た(2173,237)]", "[1000,1410]明日(1000,1410)"].join(
      "\n"
    );
    const layer = parseProviderKanaLayer(raw, parseQrc(raw), "qq", "qrc");

    expect(layer?.validation).toMatchObject({
      walkState: "ordinalUnitProven",
      declaredUnitCount: 2,
      resolvedUnitCount: 2,
      findings: [],
    });
    expect(layer?.units).toHaveLength(2);
    expect(layer?.units[0]).toMatchObject({
      groupSize: 2,
      groupRole: "groupHead",
      coverage: "covered",
      reading: "あした",
      source: { exactSourceSlice: "明", utf16Start: 0, utf16End: 1 },
      groupSource: {
        exactSourceSlice: "明日",
        utf16Start: 0,
        utf16End: 2,
        readingUnitCount: 2,
      },
      timing: {
        state: "timingProven",
        spanEndDeltaMs: 0,
        internalGaps: [{ afterKanaIndex: 1, gapMs: 378 }],
      },
    });
    expect(layer?.units[1]).toMatchObject({
      groupRole: "groupMember",
      source: { exactSourceSlice: "日", utf16Start: 1, utf16End: 2 },
    });
    expect(layer?.units[1].reading).toBeUndefined();
  });

  it("applies document offset to both base and Kana frames", () => {
    const raw = ["[offset:500]", "[kana:1ひ(1000,1000)]", "[1000,1000]日(1000,1000)"].join("\n");
    const layer = parseProviderKanaLayer(raw, parseQrc(raw), "qq", "qrc", 500);

    expect(layer?.units[0].timing).toMatchObject({
      state: "timingProven",
      offsetMs: 500,
      rawBaseStartMs: 1000,
      effectiveBaseStartMs: 1500,
      rawKana: [{ startMs: 1000, durationMs: 1000 }],
      effectiveKana: [{ startMs: 1500, durationMs: 1000 }],
    });
  });

  it("walks contiguous digit runs as one unit and keeps explicit empty ranges", () => {
    const raw = ["[kana:12ふた]", "[1000,1000]2026日月(1000,1000)"].join("\n");
    const layer = parseProviderKanaLayer(raw, parseQrc(raw), "qq", "qrc");

    expect(layer?.validation.walkState).toBe("ordinalUnitProven");
    expect(
      layer?.units.map((unit) => ({
        source: unit.source.exactSourceSlice,
        coverage: unit.coverage,
        reading: unit.reading,
        groupSize: unit.groupSize,
      }))
    ).toEqual([
      { source: "2026", coverage: "explicitEmpty", reading: undefined, groupSize: 1 },
      { source: "日", coverage: "covered", reading: "ふた", groupSize: 2 },
      { source: "月", coverage: "covered", reading: undefined, groupSize: 2 },
    ]);
  });

  it("allocates one reading unit to a contiguous digit run", () => {
    const raw = ["[kana:1にじゅうご1じ]", "[1000,1000]25時(1000,1000)"].join("\n");
    const layer = parseProviderKanaLayer(raw, parseQrc(raw), "qq", "qrc");

    expect(layer?.validation.walkState).toBe("ordinalUnitProven");
    expect(
      layer?.units.map((unit) => ({
        source: unit.source.exactSourceSlice,
        reading: unit.reading,
      }))
    ).toEqual([
      { source: "25", reading: "にじゅうご" },
      { source: "時", reading: "じ" },
    ]);
  });

  it("keeps one gikun group across non-reading okurigana inside a token", () => {
    const raw = ["[kana:2ラングラー]", "[1000,1000]怒れる人(1000,1000)"].join("\n");
    const layer = parseProviderKanaLayer(raw, parseQrc(raw), "qq", "qrc");

    expect(layer?.validation).toMatchObject({
      walkState: "ordinalUnitProven",
      declaredUnitCount: 2,
      resolvedUnitCount: 2,
      findings: [],
    });
    expect(layer?.units).toEqual([
      expect.objectContaining({
        groupSize: 2,
        groupRole: "groupHead",
        reading: "ラングラー",
        source: expect.objectContaining({ exactSourceSlice: "怒", utf16Start: 0, utf16End: 1 }),
        groupSource: expect.objectContaining({
          exactSourceSlice: "怒れる人",
          utf16Start: 0,
          utf16End: 4,
          readingUnitCount: 2,
        }),
      }),
      expect.objectContaining({
        groupSize: 2,
        groupRole: "groupMember",
        source: expect.objectContaining({ exactSourceSlice: "人", utf16Start: 3, utf16End: 4 }),
      }),
    ]);
  });

  it("retains provider groups larger than two inside one token", () => {
    const raw = ["[kana:3じょうろ4ラットレース]", "[1000,1000]如雨露馬鹿競争(1000,1000)"].join(
      "\n"
    );
    const layer = parseProviderKanaLayer(raw, parseQrc(raw), "qq", "qrc");

    expect(layer?.validation).toMatchObject({
      walkState: "ordinalUnitProven",
      declaredUnitCount: 7,
      resolvedUnitCount: 7,
      findings: ["oversizeCount"],
    });
    expect(
      layer?.units
        .filter((unit) => unit.groupRole === "groupHead")
        .map((unit) => ({ size: unit.groupSize, reading: unit.reading }))
    ).toEqual([
      { size: 3, reading: "じょうろ" },
      { size: 4, reading: "ラットレース" },
    ]);
  });

  it("accepts a one-millisecond-late sub-timing span end", () => {
    const raw = ["[kana:1っ(1000,500)ち(1500,501)]", "[1000,1000]進(1000,1000)"].join("\n");
    const layer = parseProviderKanaLayer(raw, parseQrc(raw), "qq", "qrc");

    expect(layer?.units[0]).toMatchObject({
      reading: "っち",
      timing: { state: "timingProven", spanEndDeltaMs: 1 },
      findings: [],
    });
  });

  it("rejects zero-duration sub-timing without discarding its reading range", () => {
    const raw = ["[kana:1ろ(1000,500)う(1500,0)]", "[1000,500]労(1000,500)"].join("\n");
    const layer = parseProviderKanaLayer(raw, parseQrc(raw), "qq", "qrc");

    expect(layer?.validation.walkState).toBe("ordinalUnitProven");
    expect(layer?.units[0]).toMatchObject({
      reading: "ろう",
      timing: { state: "timingRejected", spanEndDeltaMs: 0 },
      findings: ["zeroDurationTiming"],
    });
  });

  it("rejects a non-closing walk before publishing any range", () => {
    const raw = ["[kana:1あ]", "[1000,1000]明日(1000,1000)"].join("\n");
    const layer = parseProviderKanaLayer(raw, parseQrc(raw), "qq", "qrc");

    expect(layer?.validation).toMatchObject({
      walkState: "walkNotClosed",
      declaredUnitCount: 1,
      resolvedUnitCount: 2,
      findings: expect.arrayContaining(["walkNotClosed", "truncatedLine"]),
    });
    expect(layer?.units).toEqual([]);
  });

  it("rejects partial sub-timing without discarding the proven reading range", () => {
    const raw = ["[kana:2あす(1000,1000)]", "[1000,1000]明日(1000,1000)"].join("\n");
    const layer = parseProviderKanaLayer(raw, parseQrc(raw), "qq", "qrc");

    expect(layer?.validation.walkState).toBe("ordinalUnitProven");
    expect(layer?.units[0]).toMatchObject({
      reading: "あす",
      timing: { state: "timingRejected" },
      findings: ["partialSubTiming"],
    });
  });

  it("uses KRC row start plus token offset as the effective base timing", () => {
    const raw = ["[kana:1ひ(1250,750)]", "[1000,1000]<250,750,0>日"].join("\n");
    const layer = parseProviderKanaLayer(raw, parseKrc(raw), "kugou", "krc");

    expect(layer?.units[0].timing).toMatchObject({
      state: "timingProven",
      rawBaseStartMs: 1250,
      effectiveBaseStartMs: 1250,
      baseDurationMs: 750,
    });
  });

  it("retains duplicate/copy findings without treating copies as corroboration", () => {
    const primary = [
      "[kana:1ひ(1000,1000)]",
      "[kana:1ひ(1000,1000)]",
      "[1000,1000]日(1000,1000)",
    ].join("\n");
    const translation = "[kana:1ひ]\n[1000,1000]day(1000,1000)";
    const layer = parseProviderKanaLayer(primary, parseQrc(primary), "qq", "qrc", 0, translation);

    expect(layer?.validation).toMatchObject({
      walkState: "ordinalUnitProven",
      findings: ["duplicateKanaLine"],
    });
    expect(layer?.derivation).toEqual({
      redundantCopies: [{ documentRole: "translation", identicalWithoutTimings: true }],
      layersDerivedFromThis: [
        {
          documentRole: "romanization",
          relationship: "inferredDerivation",
        },
      ],
    });
  });
});

describe("typed provider reading evidence", () => {
  it("keeps QQ raw row identity and explicit empty romanization rows", () => {
    const primary = parseQrc(
      ["[1000,1000]一(1000,1000)", "[2000,1000]二(2000,1000)", "[3000,1000]三(3000,1000)"].join("\n")
    );
    const romanization = [
      "[999,1000]ichi(999,1000)",
      "[1999,1000]",
      "[2999,1000]san(2999,1000)",
    ].join("\n");
    expect(attachQqSidecars(primary, undefined, romanization).map((line) => line.romanization))
      .toEqual(["ichi", undefined, "san"]);
    expect(qqLineReadings(primary, romanization)).toEqual([
      expect.objectContaining({
        evidenceKind: "romanization",
        responseField: "roma",
        rows: [
          expect.objectContaining({ rowOrdinal: 0, sourceRowOrdinal: 0, exactValue: "ichi" }),
          expect.objectContaining({ rowOrdinal: 1, sourceRowOrdinal: 1, validationStatus: "explicitEmpty" }),
          expect.objectContaining({ rowOrdinal: 2, sourceRowOrdinal: 2, exactValue: "san" }),
        ],
      }),
    ]);
  });

  it("remaps evidence around removed rows without changing visible lyrics", () => {
    const primary = [
      "[kana:1せん]",
      "[0,1000]//(0,1000)",
      "[1000,1000]千(1000,1000)",
    ].join("\n");
    const romanization = ["[0,1000]//(0,1000)", "[1000,1000]sen(1000,1000)"].join("\n");
    const parsed = parseQrc(primary);
    const lines = attachQqSidecars(parsed, undefined, romanization);
    const evidence = providerReadingEvidence(
      "qq",
      parseProviderKanaLayer(primary, parsed, "qq", "qrc"),
      [],
      qqLineReadings(parsed, romanization),
    );
    const baseline = toSyllableLyrics(lines, "qq") as any;
    const withEvidence = toSyllableLyrics(lines, "qq", undefined, evidence) as any;
    const { ProviderReadingEvidence, ...visible } = withEvidence;

    expect(visible).toEqual(baseline);
    expect(ProviderReadingEvidence.lineReadings[0].rows).toEqual([
      expect.objectContaining({ alignment: "unmatched", sourceRowOrdinal: 0 }),
      expect.objectContaining({ alignment: "rowOrdinalProven", rowOrdinal: 0, exactValue: "sen" }),
    ]);
    expect(ProviderReadingEvidence.lineReadings[0].rows[0].rowOrdinal).toBeUndefined();
    expect(ProviderReadingEvidence.kanaLayers[0].units[0].source.rowOrdinal).toBe(0);
  });

  it("keeps KuGou type-0 sidecar rows generic and preserves contentV2", () => {
    const language = Buffer.from(JSON.stringify({
      content: [{ type: 0, language: 0, lyricContent: [["han "], ["漢"]] }],
      contentV2: [{
        type: 2,
        language: 0,
        lyricContent: [["以下谐音标注由AI工具生产"], ["敢"]],
      }],
    })).toString("base64");
    const raw = [`[language:${language}]`, "[0,1000]", "[1000,1000]<0,1000,0>A"].join("\n");
    const lines = parseKrc(raw);
    expect(kugouLineReadings(lines, raw)).toEqual([
      expect.objectContaining({
        evidenceKind: "transliteration",
        rawProviderKind: 0,
        rawLanguage: 0,
        rows: [
          expect.objectContaining({ alignment: "unmatched", sourceRowOrdinal: 0, exactValue: "han " }),
          expect.objectContaining({ alignment: "rowOrdinalProven", rowOrdinal: 0, exactValue: "漢" }),
        ],
      }),
    ]);
    expect(kugouPhoneticLanes(parseKrcLanguage(raw)?.contentV2)[0]).toMatchObject({
      rawNumericKind: 2,
      authorshipProvenance: "providerDeclaredGenerated",
      rows: [{ rowOrdinal: 0, cells: ["以下谐音标注由AI工具生产"] }, { rowOrdinal: 1, cells: ["敢"] }],
    });
  });

  it("distinguishes QQ romanization from KuGou generic transliteration", () => {
    expect(
      providerLineReadingLane({
        evidenceId: "qq:romanization:roma",
        providerId: "qq",
        evidenceKind: "romanization",
        container: "qrc",
        responseField: "roma",
        authorshipProvenance: "unknown",
        derivation: "inferredKanaProjection",
      }, [{
        exactValue: "senbonzakura",
        rowOrdinal: 3,
        alignment: "rowOrdinalProven",
        validationStatus: "usable",
      }])
    ).toMatchObject({
      evidenceKind: "romanization",
      derivation: "inferredKanaProjection",
      rows: [{ exactValue: "senbonzakura", rowOrdinal: 3 }],
    });
    expect(providerLineReadingLane({
      evidenceId: "kugou:transliteration:0",
      providerId: "kugou",
      evidenceKind: "transliteration",
      container: "krc",
      responseField: "language.content[type=0]",
      authorshipProvenance: "unknown",
      derivation: "unknown",
    }, [{
      exactValue: "まるで",
      rowOrdinal: 3,
      alignment: "rowOrdinalProven",
      validationStatus: "usable",
    }])).toMatchObject({
      evidenceKind: "transliteration",
      rows: [{ exactValue: "まるで" }],
    });
  });

  it("preserves exact NetEase romanization whitespace while aligning by timestamp", () => {
    const readings = exactTimedLineReadings(
      [{ startMs: 1000 }, { startMs: 3000 }],
      "[00:01.000]  ashita  \n[00:03.000]yoru"
    );
    expect(readings).toEqual([
      expect.objectContaining({
        exactValue: "  ashita  ",
        rowOrdinal: 0,
        sourceRowOrdinal: 0,
        alignment: "exactTimestamp",
      }),
      expect.objectContaining({
        exactValue: "yoru",
        rowOrdinal: 1,
        sourceRowOrdinal: 1,
        alignment: "exactTimestamp",
      }),
    ]);
  });

  it("retains unmatched and ambiguous NetEase rows without guessing a target", () => {
    const readings = exactTimedLineReadings(
      [{ startMs: 1000 }, { startMs: 1000 }],
      "[00:01.000]duplicate target\n[00:02.000]missing target"
    );
    expect(readings).toEqual([
      expect.objectContaining({ alignment: "ambiguous", sourceRowOrdinal: 0 }),
      expect.objectContaining({ alignment: "unmatched", sourceRowOrdinal: 1 }),
    ]);
    expect(readings.every((reading) => reading.rowOrdinal === undefined)).toBe(true);
  });

  it("retains KuGou contentV2 as generic AI-provenanced phonetic evidence", () => {
    const lanes = kugouPhoneticLanes({
      content: [{ type: 2, lyricContent: [["敢", "愛"], ["A"]] }],
    });
    expect(lanes).toEqual([
      {
        evidenceId: "kugou:phonetic:2:0",
        providerId: "kugou",
        rawNumericKind: 2,
        rawLanguage: null,
        evidenceKind: "phonetic",
        targetScript: "empty",
        authorshipProvenance: "unknown",
        validationStatus: "layerRejected",
        validationFindings: ["invalidLanguage"],
        rows: [],
      },
    ]);
  });

  it("retains KuGou contentV2 language and exact cells when its shape is proven", () => {
    const [lane] = kugouPhoneticLanes({
      content: [{ type: 2, language: 0, lyricContent: [["敢", "愛"], ["A"]] }],
    });
    expect(lane).toMatchObject({
      rawNumericKind: 2,
      rawLanguage: 0,
      targetScript: "mixed",
      validationStatus: "shapeProven",
      validationFindings: [],
      rows: [
        { rowOrdinal: 0, cells: ["敢", "愛"] },
        { rowOrdinal: 1, cells: ["A"] },
      ],
      authorshipProvenance: "unknown",
    });
  });

  it("attributes generated provenance only to the bounded provider declaration", () => {
    const [lane] = kugouPhoneticLanes({
      content: [{
        type: 2,
        language: 0,
        lyricContent: [["以下谐音标注由AI工具生产", " "], ["敢"]],
      }],
    });
    expect(lane).toMatchObject({
      authorshipProvenance: "providerDeclaredGenerated",
      declaredProvenanceText: "以下谐音标注由AI工具生产",
    });
  });

  it("omits an empty document evidence envelope", () => {
    expect(providerReadingEvidence("netease")).toBeUndefined();
  });

  it("binds every nested evidence lane to the envelope provider", () => {
    const raw = ["[kana:1ひ]", "[1000,1000]日(1000,1000)"].join("\n");
    const lines = parseQrc(raw);
    const evidence = providerReadingEvidence(
      "qq",
      parseProviderKanaLayer(raw, lines, "qq", "qrc")
    );
    expect(isProviderReadingEvidence(evidence)).toBe(true);
    expect(isProviderReadingEvidence({ ...evidence, providerId: "kugou" })).toBe(false);
  });
});
