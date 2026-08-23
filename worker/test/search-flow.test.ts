import { deflateSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assessCandidate } from "../src/matching/score";
import { ProviderTimeoutError } from "../src/http/fetch";
import {
  isKugouCandidateCompatible,
  kugouProvider,
  searchKugouCandidates,
  searchKugouSongs,
} from "../src/providers/kugou";
import { neteaseProvider, searchNetease } from "../src/providers/netease";
import { fetchQqLyric, qqProvider, searchQq } from "../src/providers/qq";
import { searchSoda, sodaProvider } from "../src/providers/soda";

afterEach(() => {
  vi.unstubAllGlobals();
});

const KRC_KEY = Uint8Array.from([
  0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47,
  0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69,
]);

function encodeKrc(value: string): string {
  const compressed = deflateSync(Buffer.from(value, "utf8"));
  const encrypted = Buffer.from(compressed.map((byte, index) => byte ^ KRC_KEY[index % KRC_KEY.length]));
  return Buffer.concat([Buffer.from("krc1", "ascii"), encrypted]).toString("base64");
}

describe("provider search flow", () => {
  it("continues past a weak first query and includes QQ grouped variants", async () => {
    const queries: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      queries.push(request.req_1.param.query);
      const list = queries.length === 1
        ? [{
            id: 1,
            title: "Signal",
            singer: [{ name: "Cover Artist" }],
            album: { name: "Tribute Covers" },
            interval: 240,
          }]
        : [{
            id: 2,
            title: "Signal",
            singer: [{ name: "Cover Artist" }],
            album: { name: "Tribute Covers" },
            interval: 240,
            grp: [{
              id: 3,
              title: "Signal (feat. Guest)",
              singer: [{ name: "Lead" }, { name: "Guest" }],
              album: { name: "Signal Album" },
              interval: 240,
            }],
          }];
      return new Response(JSON.stringify({ req_1: { data: { body: { song: { list } } } } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));

    const songs = await searchQq({
      id: "spotify-id",
      title: "Signal (feat. Guest)",
      artists: ["Lead", "Guest"],
      album: "Signal Album",
      durationMs: 240_000,
    });

    expect(queries).toEqual([
      "Signal (feat. Guest) Lead Guest Signal Album",
      "Signal feat. Guest Lead Guest",
    ]);
    expect(songs[0]).toMatchObject({ id: 3, title: "Signal (feat. Guest)", artists: ["Lead", "Guest"] });
    expect(songs.some((song) => song.id === 1)).toBe(true);
  });

  it("falls back to the QQ catalog when desktop search is unavailable", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("client_search_cp")) {
        return new Response(JSON.stringify({
          code: 0,
          subcode: 0,
          data: { song: { list: [{
            id: 233607290,
            title: "大东北我的家乡 (DJ何鹏版)",
            singer: [{ title: "何玉" }],
            album: { title: "大东北我的家乡" },
            interval: 246,
          }] } },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ code: 0, req_1: { code: 2001 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));

    const songs = await searchQq({
      id: "spotify-id",
      title: "大東北我的家鄉(DJ何鵬版)",
      artists: ["何玉"],
      album: "大東北我的家鄉",
      durationMs: 246_806,
    });

    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("musicu.fcg");
    expect(urls[1]).toContain("client_search_cp");
    expect(new URL(urls[1]).searchParams.get("w")).toBe(
      "大东北我的家乡(DJ何鹏版) 何玉 大东北我的家乡",
    );
    expect(songs[0]).toMatchObject({
      id: 233607290,
      title: "大东北我的家乡 (DJ何鹏版)",
      artists: ["何玉"],
      album: "大东北我的家乡",
      durationMs: 246_000,
    });
  });

  it("uses QQ localized singer titles as aliases while keeping the catalog name", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      req_1: { code: 0, data: { body: { song: { list: [{
        id: 42,
        title: "瑠璃の鳥",
        singer: [{ name: "霜月遥", title: "霜月遥 (霜月はるか)" }],
        interval: 284,
      }] } } } },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const songs = await searchQq({
      id: "spotify-id",
      title: "瑠璃の鳥",
      artists: ["霜月はるか"],
      album: "",
      durationMs: 284_000,
    });

    expect(songs[0]).toMatchObject({
      artists: ["霜月遥"],
      artistAliases: ["霜月遥 (霜月はるか)"],
    });
  });

  it("binds QQ lyric retrieval to the selected catalog song", async () => {
    let request: any;
    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      request = JSON.parse(String(init?.body));
      const key = "music.musichallSong.PlayLyricInfo.GetPlayLyricInfo";
      return new Response(JSON.stringify({
        code: 0,
        [key]: { code: 0, data: { songID: 999, lyric: "wrong-song" } },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    const result = await fetchQqLyric({
      id: 3,
      title: "Signal",
      artists: ["Lead"],
      album: "Signal Album",
      durationMs: 239_400,
    }, {
      id: "spotify-id",
      title: "Signal",
      artists: ["Lead"],
      album: "Signal Album",
      durationMs: 240_000,
    });

    const key = "music.musichallSong.PlayLyricInfo.GetPlayLyricInfo";
    expect(request[key].param.interval).toBe(239);
    expect(result).toBeUndefined();
  });

  it("uses one bounded QQ lyric-download fallback when the primary payload is empty", async () => {
    let primaryCalls = 0;
    let fallbackCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("lyric_download.fcg")) {
        fallbackCalls += 1;
        return new Response(`<!--
          <command-lable-xwl78-qq-music>
            <lyric>
              <content><![CDATA[[1000,1000]你(1000,400)好(1400,600)]]></content>
              <contentts><![CDATA[[00:01.000]hello]]></contentts>
              <contentroma><![CDATA[[00:01.000]ni hao]]></contentroma>
            </lyric>
          </command-lable-xwl78-qq-music>
        -->`, { status: 200, headers: { "Content-Type": "text/xml" } });
      }

      const request = JSON.parse(String(init?.body));
      if (request.req_1) {
        return new Response(JSON.stringify({
          req_1: { data: { body: { song: { list: [{
            id: 3,
            title: "Signal",
            singer: [{ name: "Lead" }],
            album: { name: "Signal Album" },
            interval: 240,
          }] } } } },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }

      primaryCalls += 1;
      const key = "music.musichallSong.PlayLyricInfo.GetPlayLyricInfo";
      return new Response(JSON.stringify({ code: 0, [key]: { code: 0, data: { songID: 3, lyric: "" } } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));

    const result = await qqProvider({
      id: "spotify-id",
      title: "Signal",
      artists: ["Lead"],
      album: "Signal Album",
      durationMs: 240_000,
    });

    expect(primaryCalls).toBe(1);
    expect(fallbackCalls).toBe(1);
    expect(result?.Type).toBe("Syllable");
    expect(result?.SourceMatch?.method).toBe("search-lyric-download");
  });

  it("uses the bounded QQ lyric fallback after a primary transport failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("lyric_download.fcg")) {
        return new Response("<content><![CDATA[[1000,1000]你(1000,400)好(1400,600)]]></content>", {
          status: 200,
          headers: { "Content-Type": "text/xml" },
        });
      }
      const request = JSON.parse(String(init?.body));
      if (request.req_1) {
        return new Response(JSON.stringify({
          req_1: { code: 0, data: { body: { song: { list: [{
            id: 3,
            title: "Signal",
            singer: [{ name: "Lead" }],
            album: { name: "Signal Album" },
            interval: 240,
          }] } } } },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new TypeError("simulated primary transport failure");
    }));

    const result = await qqProvider({
      id: "spotify-id",
      title: "Signal",
      artists: ["Lead"],
      album: "Signal Album",
      durationMs: 240_000,
    });

    expect(result?.Type).toBe("Syllable");
    expect(result?.SourceMatch?.method).toBe("search-lyric-download");
  });

  it("continues NetEase search until a strong candidate and fetches that lyric", async () => {
    let batchCalls = 0;
    let cloudCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/eapi/batch")) {
        batchCalls += 1;
        const song = { id: 1, name: "Signal", ar: [{ name: "Cover Artist" }], al: { name: "Tribute Covers" }, dt: 240_000 };
        return new Response(JSON.stringify({ data: { resources: [{ baseInfo: { simpleSongData: song } }] } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/eapi/cloudsearch/pc")) {
        cloudCalls += 1;
        return new Response(JSON.stringify({ result: { songs: [{
          id: 2,
          name: "Signal (feat. Guest)",
          ar: [{ name: "Lead" }, { name: "Guest" }],
          al: { name: "Signal Album" },
          dt: 239_400,
        }] } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        lrc: { lyric: "[00:00.000]Signal\n[00:10.000]Next line" },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));

    const result = await neteaseProvider({
      id: "spotify-id",
      title: "Signal (feat. Guest)",
      artists: ["Lead", "Guest"],
      album: "Signal Album",
      durationMs: 240_000,
    });

    expect(batchCalls).toBe(1);
    expect(cloudCalls).toBe(1);
    expect(result?.SourceMatch).toMatchObject({
      title: "Signal (feat. Guest)",
      artists: ["Lead", "Guest"],
      coherent: true,
      method: "cloud-search-eapi-lyric",
    });
    expect((result as any)?.Content.at(-1)?.EndTime).toBe(239.4);
  });

  it("fetches a provider-ranked native-script NetEase title from romanized Spotify metadata", async () => {
    let lyricCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/eapi/batch")) {
        return new Response(JSON.stringify({ data: { resources: [{
          baseInfo: { simpleSongData: {
            id: 2_648_541_142,
            name: "一梦红尘",
            ar: [{ name: "Risa Yuzuki" }, { name: "BlackY" }],
            al: { name: "ELYSIAN" },
            dt: 219_440,
          } },
        }] } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/eapi/cloudsearch/pc")) {
        return new Response(JSON.stringify({ result: { songs: [] } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      lyricCalls += 1;
      return new Response(JSON.stringify({
        lrc: { lyric: "[00:00.000]红尘一梦\n[00:10.000]梦醒皆空" },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    const result = await neteaseProvider({
      id: "spotify:track:6MhJdRWkzRgBX5rNlzuVig",
      title: "Yī mèng hóngchén",
      artists: ["Risa Yuzuki", "BlackY"],
      album: "ELYSIAN",
      durationMs: 219_000,
    });

    expect(lyricCalls).toBe(1);
    expect(result?.Type).toBe("Line");
    expect(result?.SourceMatch).toMatchObject({
      title: "一梦红尘",
      artists: ["Risa Yuzuki", "BlackY"],
      album: "ELYSIAN",
      durationMs: 219_440,
      coherent: true,
      method: "batch-search-eapi-lyric",
      evidence: { title: 0, artists: 1, album: 1, duration: 0.9, versionConflict: false },
    });
  });

  it("classifies a complete NetEase credit block when JSON credit rows are embedded in LRC", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/eapi/batch")) {
        return new Response(JSON.stringify({ data: { resources: [{
          baseInfo: { simpleSongData: {
            id: 1_937_718_268,
            name: "归家",
            ar: [{ name: "KBShinya" }, { name: "哦漏" }],
            al: { name: "归家" },
            dt: 280_000,
          } },
        }] } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        lrc: { lyric: [
          JSON.stringify({ t: 0, c: [{ tx: "作词: " }, { tx: "释子" }, { tx: "/" }, { tx: "公子无琊" }] }),
          JSON.stringify({ t: 1000, c: [{ tx: "作曲: " }, { tx: "王韩一淋" }] }),
          "[00:08.705]编曲：向往",
          "[00:10.195]文案故事：康玉婷（网易云音乐用户@糖果超级咸）",
          "[00:11.763]/题记/",
          "[00:13.000]飞雁终渡万重山，远行的儿郎卸甲归家。",
        ].join("\n") },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    const result = await neteaseProvider({
      id: "4Be8UHXmXCaKBWTi4OwpU6",
      title: "归家",
      artists: ["KBShinya", "哦漏"],
      album: "归家",
      durationMs: 280_000,
    }) as any;

    expect(result.SongWriters).toEqual(["释子", "公子无琊"]);
    expect(result.Content.map((line: any) => line.ProviderInfoKind)).toEqual([
      "credit", "credit", "credit", "credit", undefined, undefined,
    ]);
    expect(result.Content.map((line: any) => line.Text)).toEqual([
      "作词: 释子/公子无琊",
      "作曲: 王韩一淋",
      "编曲：向往",
      "文案故事：康玉婷（网易云音乐用户@糖果超级咸）",
      "/题记/",
      "飞雁终渡万重山，远行的儿郎卸甲归家。",
    ]);
  });

  it("continues past a pureMusic candidate instead of rendering its metadata as lyrics", async () => {
    let lyricCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("/eapi/batch")) {
        return new Response(JSON.stringify({ data: { resources: [1, 2].map((id) => ({
          baseInfo: { simpleSongData: {
            id,
            name: "Lune",
            ar: [{ name: "M2U" }],
            al: { name: "Lune" },
            dt: 180_000,
          } },
        })) } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      lyricCalls += 1;
      return new Response(JSON.stringify(lyricCalls === 1 ? {
        pureMusic: true,
        lrc: { lyric: `${JSON.stringify({ t: 0, c: [{ tx: "作曲: " }, { tx: "M2U" }] })}\n[00:00:00]纯音乐，请欣赏` },
      } : {
        lrc: { lyric: "[00:01.000]ordinary lyric" },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    const result = await neteaseProvider({
      id: "spotify-lune",
      title: "Lune",
      artists: ["M2U"],
      album: "Lune",
      durationMs: 180_000,
    }) as any;

    expect(lyricCalls).toBe(2);
    expect(result.Content.map((line: any) => line.Text)).toEqual(["ordinary lyric"]);
  });

  it("returns untimed NetEase lyrics as Static while keeping typed edge credits", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("/eapi/batch")) {
        return new Response(JSON.stringify({ data: { resources: [{
          baseInfo: { simpleSongData: {
            id: 3,
            name: "Dumes",
            ar: [{ name: "Denny Caknan" }],
            al: { name: "Dumes" },
            dt: 240_000,
          } },
        }] } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        lrc: { lyric: [
          JSON.stringify({ t: 0, c: [{ tx: "作词: " }, { tx: "Andry Priyanta" }] }),
          "Sepine ro aku",
          "Senengmu karo liyane",
        ].join("\n") },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    const result = await neteaseProvider({
      id: "spotify-dumes",
      title: "Dumes",
      artists: ["Denny Caknan"],
      album: "Dumes",
      durationMs: 240_000,
    }) as any;

    expect(result.Type).toBe("Static");
    expect(result.Lines).toEqual([
      { Text: "作词: Andry Priyanta", ProviderInfoKind: "credit" },
      { Text: "Sepine ro aku" },
      { Text: "Senengmu karo liyane" },
    ]);
  });

  it("rejects a NetEase document containing only structured credits", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("/eapi/batch")) {
        return new Response(JSON.stringify({ data: { resources: [{
          baseInfo: { simpleSongData: {
            id: 4,
            name: "Roman Picisan",
            ar: [{ name: "Dewa 19" }],
            al: { name: "Bintang Lima" },
            dt: 240_000,
          } },
        }] } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        lrc: { lyric: JSON.stringify({ t: 0, c: [{ tx: "作曲: " }, { tx: "Ahmad Dhani" }] }) },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    await expect(neteaseProvider({
      id: "spotify-roman-picisan",
      title: "Roman Picisan",
      artists: ["Dewa 19"],
      album: "Bintang Lima",
      durationMs: 240_000,
    })).resolves.toBeUndefined();
  });

  it("uses NetEase transNames as localized artist aliases", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("/eapi/batch")) {
        return new Response(JSON.stringify({ data: { resources: [{
          baseInfo: { simpleSongData: {
            id: 17647,
            name: "瑠璃の鳥",
            ar: [{ name: "霜月遥", transNames: ["霜月はるか"] }],
            dt: 284_000,
          } },
        }] } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ result: { songs: [] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));

    const songs = await searchNetease({
      id: "spotify-id",
      title: "瑠璃の鳥",
      artists: ["霜月はるか"],
      album: "",
      durationMs: 284_000,
    });

    expect(songs[0]).toMatchObject({
      artists: ["霜月遥"],
      artistAliases: ["霜月はるか"],
    });
  });

  it("merges richer same-song NetEase aliases without replacing the batch identity", async () => {
    let requestPaths: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      requestPaths.push(new URL(url).pathname);
      const song = {
        id: 1_941_230_174,
        name: "Killer Neuron",
        ar: [{ id: 12_417_042, name: "藍月なくる", alias: [], tns: [] }],
        al: { name: "Indigrotto" },
        dt: 248_314,
      };
      if (url.includes("/eapi/batch")) {
        return new Response(JSON.stringify({ data: { resources: [{
          baseInfo: { simpleSongData: song },
        }] } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/eapi/cloudsearch/pc")) {
        return new Response(JSON.stringify({ result: { songs: [{
          ...song,
          ar: [{
            id: 12_417_042,
            name: "藍月なくる",
            alias: ["Aitsuki Nakuru", "蓝月拿轱辘", "あいつきなくる", "Aitsuki Nakuru"],
            tns: ["蓝月奈久留"],
          }],
          alia: ["Killer Neuron Alt"],
        }, {
          ...song,
          id: 34_765_944,
          ar: [{ id: 34_765_944, name: "Different Artist", alias: ["Must Not Merge"] }],
        }] } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`Unexpected NetEase request: ${url}`);
    }));

    const fixture = {
      id: "spotify-id",
      title: "Killer Neuron",
      album: "Indigrotto",
      durationMs: 248_314,
    };
    for (const artist of ["Aitsuki Nakuru", "蓝月奈久留", "蓝月拿轱辘", "あいつきなくる"]) {
      requestPaths = [];
      const songs = await searchNetease({ ...fixture, artists: [artist] });
      const song = songs.find((candidate) => candidate.id === 1_941_230_174);
      expect(song).toMatchObject({
        id: 1_941_230_174,
        name: "Killer Neuron",
        titleAliases: ["Killer Neuron Alt"],
        searchMethod: "batch-search",
        artists: ["藍月なくる"],
        artistAliases: ["Aitsuki Nakuru", "蓝月拿轱辘", "あいつきなくる", "蓝月奈久留"],
      });
      expect(song?.artistAliases).not.toContain("Must Not Merge");
      expect(requestPaths).toEqual(["/eapi/batch", "/eapi/cloudsearch/pc"]);
      expect(assessCandidate(
        { ...fixture, artists: [artist] },
        {
          title: song!.name,
          artists: song!.artists,
          artistAliases: song!.artistAliases,
          album: song!.album,
          durationMs: song!.durationMs,
        },
      ).evidence.artists).toBe(1);
    }
  });

  it("uses Lyricify's KuGou mobile catalog first and carries the selected hash and duration into lyric search", async () => {
    const queries: string[] = [];
    let lyricHash = "";
    let lyricDuration = "";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.hostname === "mobilecdn.kugou.com") {
        queries.push(url.searchParams.get("keyword") ?? "");
        const info = queries.length === 1
          ? [{ FileHash: "cover", SongName: "Signal", SingerName: "Cover Artist", AlbumName: "Tribute Covers", Duration: 240 }]
          : [{
              hash: "another-cover",
              SongName: "Signal",
              SingerName: "Cover Artist",
              AlbumName: "Tribute Covers",
              Duration: 240,
              group: [{
                hash: "wanted-hash",
                SongName: "Signal (feat. Guest)",
                SingerName: "Lead / Guest",
                AlbumName: "Signal Album",
                Duration: 239.4,
              }],
            }];
        return new Response(JSON.stringify({ data: { info } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      lyricHash = url.searchParams.get("hash") ?? "";
      lyricDuration = url.searchParams.get("duration") ?? "";
      return new Response(JSON.stringify({
        candidates: [{ id: "wanted", accesskey: "wanted-key", song: "Signal (feat. Guest)", singer: "Lead / Guest", duration: 239_400 }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));

    const track = {
      id: "spotify-id",
      title: "Signal (feat. Guest)",
      artists: ["Lead", "Guest"],
      album: "Signal Album",
      durationMs: 240_000,
    };
    const songs = await searchKugouSongs(track);
    const candidates = await searchKugouCandidates(track, songs[0]);

    expect(queries).toEqual([
      "Signal (feat. Guest) Lead Guest Signal Album",
      "Signal Lead Guest",
    ]);
    expect(songs[0]).toMatchObject({
      hash: "wanted-hash",
      title: "Signal (feat. Guest)",
      artists: ["Lead", "Guest"],
      durationMs: 239_400,
      catalog: "mobile-http",
    });
    expect(lyricHash).toBe("wanted-hash");
    expect(lyricDuration).toBe("239400");
    expect(candidates[0]?.id).toBe("wanted");
  });

  it("accepts an omitted KuGou child version only under a strong hash-bound catalog match", () => {
    const track = {
      id: "spotify-id",
      title: "南山雪 - Dj降调版",
      artists: ["祥嘞嘞", "无名"],
      album: "南山雪 (Dj降调版)",
      durationMs: 202_000,
    };
    const song = {
      hash: "31ee30ce0e4d7c2ac753cf7a896255cc",
      title: "南山雪 (DJ降调版)",
      artists: ["祥嘞嘞"],
      album: "南山雪",
      durationMs: 201_000,
      catalog: "mobile-http" as const,
    };

    expect(isKugouCandidateCompatible(track, song, {
      id: "base-title",
      accesskey: "key",
      song: "南山雪",
      singer: "祥嘞嘞",
      duration: 201_613,
    })).toBe(true);
    expect(isKugouCandidateCompatible(track, song, {
      id: "explicit-conflict",
      accesskey: "key",
      song: "南山雪 (Live版)",
      singer: "祥嘞嘞",
      duration: 201_613,
    })).toBe(false);
    expect(isKugouCandidateCompatible(track, song, {
      id: "wrong-title",
      accesskey: "key",
      song: "北山雨",
      singer: "祥嘞嘞",
      duration: 201_613,
    })).toBe(false);
    expect(isKugouCandidateCompatible(track, song, {
      id: "wrong-artist",
      accesskey: "key",
      song: "南山雪",
      singer: "其他歌手",
      duration: 201_613,
    })).toBe(false);
  });

  it("retrieves the hash-bound KuGou KRC when the lyric record shortens the DJ title", async () => {
    let downloads = 0;
    const rawKrc = [
      "[offset:0]",
      "[180,2100]<0,500,0>南<500,500,0>山<1000,500,0>雪<1500,600,0>飞满天",
      "[2490,2200]<0,500,0>似<500,500,0>我<1000,600,0>挂念<1600,600,0>你无边",
      "[5000,2200]<0,500,0>白<500,500,0>了<1000,500,0>夜<1500,700,0>冷了心",
    ].join("\n");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.hostname === "mobilecdn.kugou.com") {
        return new Response(JSON.stringify({ data: { info: [{
          FileHash: "31ee30ce0e4d7c2ac753cf7a896255cc",
          SongName: "南山雪 (DJ降调版)",
          SingerName: "祥嘞嘞",
          AlbumName: "南山雪",
          Duration: 201,
        }] } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.pathname === "/search") {
        expect(url.searchParams.get("hash")).toBe("31ee30ce0e4d7c2ac753cf7a896255cc");
        return new Response(JSON.stringify({ candidates: [{
          id: "425768330",
          accesskey: "key",
          song: "南山雪",
          singer: "祥嘞嘞",
          duration: 201_613,
        }] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      downloads += 1;
      return new Response(JSON.stringify({ content: encodeKrc(rawKrc) }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));

    const result = await kugouProvider({
      id: "spotify-id",
      title: "南山雪 - Dj降调版",
      artists: ["祥嘞嘞", "无名"],
      album: "南山雪 (Dj降调版)",
      durationMs: 202_000,
    });

    expect(downloads).toBe(1);
    expect(result?.Type).toBe("Syllable");
    expect(result?.Content).toHaveLength(3);
    expect(result?.SourceMatch).toMatchObject({
      title: "南山雪 (DJ降调版)",
      artists: ["祥嘞嘞"],
      album: "南山雪",
      durationMs: 201_000,
      method: "catalog-hash-mobile-http",
      evidence: { versionConflict: false },
    });
  });

  it("retrieves Soda KRC as native syllable lyrics and validates the detail track", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/search/track")) {
        return new Response(JSON.stringify({
          result_groups: [{
            data: [{
              meta: { item_type: "track" },
              entity: { track: {
                id: "7537973495315073040",
                name: "大东北我的家乡(DJ何鹏版)",
                artists: [{ name: "何玉" }],
                album: { name: "大东北我的家乡" },
                duration: 246_807,
              } },
            }],
          }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        track: {
          id: "7537973495315073040",
          name: "大东北我的家乡(DJ何鹏版)",
          artists: [{ name: "何玉" }],
          album: { name: "大东北我的家乡" },
          duration: 246_807,
        },
        lyric: {
          type: "krc",
          content: "[1000,1000]<0,400,0>大<400,600,0>东北",
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    const result = await sodaProvider({
      id: "spotify-id",
      title: "大東北我的家鄉(DJ何鵬版)",
      artists: ["何玉"],
      album: "大東北我的家鄉",
      durationMs: 246_806,
    });

    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("/search/track");
    expect(urls[1]).toContain("/luna/track?");
    expect(new URL(urls[0]).searchParams.get("device_platform")).toBe("web");
    expect(new URL(urls[1]).searchParams.get("device_platform")).toBe("web");
    expect(result?.Type).toBe("Syllable");
    expect(result?.SourceMatch).toMatchObject({
      title: "大东北我的家乡(DJ何鹏版)",
      artists: ["何玉"],
      durationMs: 246_807,
      method: "luna-pc-krc",
      evidence: { versionConflict: false },
    });
  });

  it("retries Soda's detail risk rejection and surfaces persistent refusal", async () => {
    const searchBody = {
      result_groups: [{
        data: [{
          meta: { item_type: "track" },
          entity: { track: {
            id: "soda-risk-fixture",
            name: "Risk Fixture",
            artists: [{ name: "Artist" }],
            duration: 180_000,
          } },
        }],
      }],
    };
    const successBody = {
      track: {
        id: "soda-risk-fixture",
        name: "Risk Fixture",
        artists: [{ name: "Artist" }],
        duration: 180_000,
      },
      lyric: { type: "krc", content: "[1000,1000]<0,1000,0>line" },
    };
    const track = {
      id: "spotify-risk-fixture",
      title: "Risk Fixture",
      artists: ["Artist"],
      album: "",
      durationMs: 180_000,
    };

    let detailAttempts = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("/search/track")) return new Response(JSON.stringify(searchBody));
      detailAttempts += 1;
      return new Response(JSON.stringify(
        detailAttempts === 1 ? { status_code: 1000062 } : successBody,
      ));
    }));
    await expect(sodaProvider(track)).resolves.toMatchObject({ Type: "Syllable" });
    expect(detailAttempts).toBe(2);

    detailAttempts = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("/search/track")) return new Response(JSON.stringify(searchBody));
      detailAttempts += 1;
      return new Response(JSON.stringify({ status_code: 12345 }));
    }));
    await expect(sodaProvider(track)).resolves.toBeUndefined();
    expect(detailAttempts).toBe(1);

    detailAttempts = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("/search/track")) return new Response(JSON.stringify(searchBody));
      detailAttempts += 1;
      return new Response(JSON.stringify({ status_code: 1000062 }));
    }));
    await expect(sodaProvider(track)).rejects.toMatchObject({
      name: "ProviderUpstreamError",
      status: 502,
    });
    expect(detailAttempts).toBe(4);
  });

  it("uses Soda simple display names as artist aliases without another lookup", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      result_groups: [{
        data: [{
          meta: { item_type: "track" },
          entity: { track: {
            id: "localized-soda",
            name: "瑠璃の鳥",
            artists: [{ name: "霜月遥", simple_display_name: "霜月はるか" }],
            duration: 284_000,
          } },
        }],
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const songs = await searchSoda({
      id: "spotify-id",
      title: "瑠璃の鳥",
      artists: ["霜月はるか"],
      album: "",
      durationMs: 284_000,
    });

    expect(songs[0]).toMatchObject({
      artists: ["霜月遥"],
      artistAliases: ["霜月はるか"],
    });
  });

  it("distinguishes a valid empty Soda catalog from malformed HTTP 2xx payloads", async () => {
    const track = {
      id: "spotify-id",
      title: "D/N/A",
      artists: ["AZARI"],
      album: "",
      durationMs: 146_000,
    };

    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    await expect(searchSoda(track)).resolves.toEqual([]);

    let mixedAttempts = 0;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      mixedAttempts++ === 0 ? "" : "{}",
      { status: 200 },
    )));
    await expect(searchSoda(track)).resolves.toEqual([]);

    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 })));
    await expect(searchSoda(track)).rejects.toMatchObject({
      name: "ProviderUpstreamError",
      status: 502,
    });
  });

  it("recovers when a later Soda search query returns a valid result", async () => {
    let searches = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      searches += 1;
      if (searches === 1) return new Response("", { status: 200 });
      return new Response(JSON.stringify({
        result_groups: [{
          data: [{
            meta: { item_type: "track" },
            entity: { track: {
              id: "dna",
              name: "D/N/A",
              artists: [{ name: "AZARI" }],
              duration: 146_000,
            } },
          }],
        }],
      }), { status: 200 });
    }));

    await expect(searchSoda({
      id: "spotify-id",
      title: "D/N/A",
      artists: ["AZARI"],
      album: "",
      durationMs: 146_000,
    })).resolves.toMatchObject([{ id: "dna" }]);
    expect(searches).toBe(2);
  });

  it("continues to a later Soda candidate after a malformed detail payload", async () => {
    const detailIds: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("/search/track")) {
        return new Response(JSON.stringify({
          result_groups: [{
            data: ["broken", "recovered"].map((id) => ({
              meta: { item_type: "track" },
              entity: { track: {
                id,
                name: "D/N/A",
                artists: [{ name: "AZARI" }],
                duration: 146_000,
              } },
            })),
          }],
        }), { status: 200 });
      }
      const id = new URL(String(input)).searchParams.get("track_id") ?? "";
      detailIds.push(id);
      if (id === "broken") return new Response("not json", { status: 200 });
      return new Response(JSON.stringify({
        track: {
          id,
          name: "D/N/A",
          artists: [{ name: "AZARI" }],
          duration: 146_000,
        },
        lyric: { type: "lrc", content: "[00:01.00]D/N/A" },
      }), { status: 200 });
    }));

    await expect(sodaProvider({
      id: "spotify-id",
      title: "D/N/A",
      artists: ["AZARI"],
      album: "",
      durationMs: 146_000,
    })).resolves.toMatchObject({ Type: "Line" });
    expect(detailIds).toEqual(["broken", "recovered"]);
  });

  it("returns no match instead of falling from lyricless exact Soda identity to another artist", async () => {
    const detailIds: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("/search/track")) {
        return new Response(JSON.stringify({
          result_groups: [{
            data: [
              {
                meta: { item_type: "track" },
                entity: { track: {
                  id: "denny-caknan",
                  name: "Sekti",
                  artists: [{ name: "Denny Caknan" }],
                  album: { name: "Sekti" },
                  duration: 256_000,
                } },
              },
              {
                meta: { item_type: "track" },
                entity: { track: {
                  id: "adi-fajar",
                  name: "Sekti",
                  artists: [{ name: "Adi fajar" }],
                  album: { name: "Sekti" },
                  duration: 308_307,
                } },
              },
            ],
          }],
        }), { status: 200 });
      }
      const id = new URL(String(input)).searchParams.get("track_id") ?? "";
      detailIds.push(id);
      const exact = id === "denny-caknan";
      return new Response(JSON.stringify({
        track: {
          id,
          name: "Sekti",
          artists: [{ name: exact ? "Denny Caknan" : "Adi fajar" }],
          album: { name: "Sekti" },
          duration: exact ? 256_000 : 308_307,
        },
        lyric: exact
          ? { type: "lrc", content: "" }
          : { type: "krc", content: "[1000,1000]<0,1000,0>Sekti" },
      }), { status: 200 });
    }));

    await expect(sodaProvider({
      id: "spotify-sekti",
      title: "Sekti",
      artists: ["Denny Caknan"],
      album: "Sekti",
      durationMs: 256_000,
    })).resolves.toBeUndefined();
    expect(detailIds).toEqual(["denny-caknan", "adi-fajar"]);
  });

  it("rejects a lyric-bearing Soda title lookalike after corroborated lyricless variants", async () => {
    const candidates = [
      {
        id: "bighead-album",
        name: "Sharing the World (feat. Hatsune Miku) [Album ver.]",
        artists: [{ name: "BIGHEAD" }],
        album: { name: "ONLY 1 (feat. Hatsune Miku)" },
        duration: 246_087,
      },
      {
        id: "bighead-japanese",
        name: "Sharing the World (feat. Hatsune Miku)[JAPANESE ver.]",
        artists: [{ name: "BIGHEAD" }],
        album: { name: "ONLY 1 (feat. Hatsune Miku)" },
        duration: 246_155,
      },
      {
        id: "unrelated",
        name: "We Share The World",
        artists: [{ name: "邹妙琦" }, { name: "大卫" }, { name: "曾嘉婧" }],
        album: { name: "We Share The World" },
        duration: 246_318,
      },
    ];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("/search/track")) {
        return new Response(JSON.stringify({
          result_groups: [{
            data: candidates.map((track) => ({
              meta: { item_type: "track" },
              entity: { track },
            })),
          }],
        }), { status: 200 });
      }
      const id = new URL(String(input)).searchParams.get("track_id") ?? "";
      const track = candidates.find((candidate) => candidate.id === id)!;
      return new Response(JSON.stringify({
        track,
        lyric: id === "unrelated"
          ? { type: "krc", content: "[1000,1000]<0,1000,0>world" }
          : { type: "lrc", content: "" },
      }), { status: 200 });
    }));

    await expect(sodaProvider({
      id: "spotify-sharing-the-world",
      title: "Sharing The World",
      artists: ["BIGHEAD"],
      album: "Sharing The World",
      durationMs: 246_000,
    })).resolves.toBeUndefined();
  });

  it("preserves a localized-title Soda fallback with corroborated artist identity", async () => {
    const candidates = [
      {
        id: "zero-latin",
        name: "Zero Talking",
        artists: [{ name: "はるまきごはん" }],
        album: { name: "Zero Talking" },
        duration: 221_053,
      },
      {
        id: "zero-localized",
        name: "ゼロトーキング",
        artists: [{ name: "はるまきごはん" }],
        album: { name: "ゼロトーキング" },
        duration: 221_053,
      },
    ];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("/search/track")) {
        return new Response(JSON.stringify({
          result_groups: [{
            data: candidates.map((track) => ({
              meta: { item_type: "track" },
              entity: { track },
            })),
          }],
        }), { status: 200 });
      }
      const id = new URL(String(input)).searchParams.get("track_id") ?? "";
      const track = candidates.find((candidate) => candidate.id === id)!;
      return new Response(JSON.stringify({
        track,
        lyric: id === "zero-latin"
          ? { type: "lrc", content: "" }
          : { type: "krc", content: "[1000,1000]<0,500,0>ゼロ<500,500,0>トーキング" },
      }), { status: 200 });
    }));

    const result = await sodaProvider({
      id: "netease-zero-talking",
      title: "Zero Talking",
      artists: ["はるまきごはん", "初音ミク"],
      album: "ゼロトーキング",
      durationMs: 221_000,
    });

    expect(result?.Type).toBe("Syllable");
    expect(result?.SourceMatch).toMatchObject({
      title: "ゼロトーキング",
      artists: ["はるまきごはん"],
      evidence: { artists: 0.88, duration: 0.95, versionConflict: false },
    });
  });

  it("rejects a lyric-bearing Soda candidate without recording identity", async () => {
    const candidates = [
      {
        id: "weak-empty",
        name: "Sekti",
        artists: [{ name: "Tugu Music" }],
        album: { name: "Sekti" },
        duration: 357_750,
      },
      {
        id: "weak-lyrics",
        name: "Sekti",
        artists: [{ name: "Adi fajar" }],
        album: { name: "Sekti" },
        duration: 308_307,
      },
    ];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("/search/track")) {
        return new Response(JSON.stringify({
          result_groups: [{
            data: candidates.map((track) => ({
              meta: { item_type: "track" },
              entity: { track },
            })),
          }],
        }), { status: 200 });
      }
      const id = new URL(String(input)).searchParams.get("track_id") ?? "";
      const track = candidates.find((candidate) => candidate.id === id)!;
      return new Response(JSON.stringify({
        track,
        lyric: id === "weak-empty"
          ? { type: "lrc", content: "" }
          : { type: "krc", content: "[1000,1000]<0,1000,0>Sekti" },
      }), { status: 200 });
    }));

    await expect(sodaProvider({
      id: "spotify-sekti",
      title: "Sekti",
      artists: ["Denny Caknan"],
      album: "Sekti",
      durationMs: 256_000,
    })).resolves.toBeUndefined();
  });

  it("preserves a fully corroborated Soda recording when artist spelling differs", async () => {
    const track = {
      id: "tuyu",
      name: "泥の分際で私だけの大切を奪おうだなんて",
      artists: [{ name: "TUYU" }],
      album: { name: "泥の分際で私だけの大切を奪おうだなんて" },
      duration: 192_267,
    };
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("/search/track")) {
        return new Response(JSON.stringify({
          result_groups: [{
            data: [{ meta: { item_type: "track" }, entity: { track } }],
          }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        track,
        lyric: { type: "krc", content: "[1000,1000]<0,1000,0>泥の分際で" },
      }), { status: 200 });
    }));

    const result = await sodaProvider({
      id: "netease-tuyu",
      title: "泥の分際で私だけの大切を奪おうだなんて",
      artists: ["ツユ"],
      album: "泥の分際で私だけの大切を奪おうだなんて",
      durationMs: 192_000,
    });

    expect(result?.Type).toBe("Syllable");
    expect(result?.SourceMatch).toMatchObject({
      artists: ["TUYU"],
      evidence: { title: 1, artists: 0, album: 1, duration: 0.95 },
    });
  });

  it("uses Soda detail identity and continues to a later partial-artist match", async () => {
    const searchTracks = [
      {
        id: "misleading-detail",
        name: "Shared Song",
        artists: [{ name: "Lead" }, { name: "Guest" }, { name: "Vocal" }],
        album: { name: "Shared Song" },
        duration: 200_000,
      },
      {
        id: "partial-artists",
        name: "Shared Song",
        artists: [{ name: "Lead" }],
        duration: 206_000,
      },
    ];
    const detailIds: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("/search/track")) {
        return new Response(JSON.stringify({
          result_groups: [{
            data: searchTracks.map((track) => ({
              meta: { item_type: "track" },
              entity: { track },
            })),
          }],
        }), { status: 200 });
      }
      const id = new URL(String(input)).searchParams.get("track_id") ?? "";
      detailIds.push(id);
      if (id === "misleading-detail") {
        return new Response(JSON.stringify({
          track: {
            ...searchTracks[0],
            artists: [{ name: "Other" }],
            duration: 260_000,
          },
          lyric: { type: "krc", content: "[1000,1000]<0,1000,0>wrong" },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        track: { ...searchTracks[1], duration: 201_000 },
        lyric: { type: "krc", content: "[1000,1000]<0,1000,0>right" },
      }), { status: 200 });
    }));

    const result = await sodaProvider({
      id: "spotify-shared-song",
      title: "Shared Song",
      artists: ["Lead", "Guest", "Vocal"],
      album: "Shared Song",
      durationMs: 200_000,
    });

    expect(detailIds).toEqual(["misleading-detail", "partial-artists"]);
    expect(result?.SourceMatch).toMatchObject({
      artists: ["Lead"],
      evidence: { artists: 0.4, duration: 0.8, versionConflict: false },
    });
  });

  it("keeps rejecting a Soda version conflict introduced by detail metadata", async () => {
    const searchTrack = {
      id: "detail-live-version",
      name: "Original Song",
      artists: [{ name: "Artist" }],
      album: { name: "Original Song" },
      duration: 180_000,
    };
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("/search/track")) {
        return new Response(JSON.stringify({
          result_groups: [{
            data: [{ meta: { item_type: "track" }, entity: { track: searchTrack } }],
          }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        track: { ...searchTrack, name: "Original Song (Live)" },
        lyric: { type: "krc", content: "[1000,1000]<0,1000,0>live" },
      }), { status: 200 });
    }));

    await expect(sodaProvider({
      id: "spotify-original-song",
      title: "Original Song",
      artists: ["Artist"],
      album: "Original Song",
      durationMs: 180_000,
    })).resolves.toBeUndefined();
  });

  it("surfaces malformed Soda detail payloads when no candidate detail recovers", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("/search/track")) {
        return new Response(JSON.stringify({
          result_groups: [{
            data: [{
              meta: { item_type: "track" },
              entity: { track: {
                id: "dna",
                name: "D/N/A",
                artists: [{ name: "AZARI" }],
                duration: 146_000,
              } },
            }],
          }],
        }), { status: 200 });
      }
      return new Response("", { status: 200 });
    }));

    await expect(sodaProvider({
      id: "spotify-id",
      title: "D/N/A",
      artists: ["AZARI"],
      album: "",
      durationMs: 146_000,
    })).rejects.toMatchObject({ name: "ProviderUpstreamError", status: 502 });
  });

  it.each([
    [429, "ProviderRateLimitError"],
    [503, "ProviderUpstreamError"],
  ])("preserves Soda HTTP %i failure mapping", async (status, name) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status })));
    await expect(searchSoda({
      id: "spotify-id",
      title: "D/N/A",
      artists: ["AZARI"],
      album: "",
      durationMs: 146_000,
    })).rejects.toMatchObject({ name });
  });

  it("preserves Soda timeout and caller-abort failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new ProviderTimeoutError("timed out"); }));
    const track = {
      id: "spotify-id",
      title: "D/N/A",
      artists: ["AZARI"],
      album: "",
      durationMs: 146_000,
    };
    await expect(searchSoda(track)).rejects.toMatchObject({ name: "ProviderTimeoutError" });

    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));
    await expect(searchSoda(track, undefined, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
