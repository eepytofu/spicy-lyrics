import { afterEach, describe, expect, it, vi } from "vitest";
import { searchKugouCandidates, searchKugouSongs } from "../src/providers/kugou";
import { neteaseProvider, searchNetease } from "../src/providers/netease";
import { fetchQqLyric, qqProvider, searchQq } from "../src/providers/qq";
import { searchSoda, sodaProvider } from "../src/providers/soda";

afterEach(() => {
  vi.unstubAllGlobals();
});

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
    expect(urls[1]).toContain("/track_v2");
    expect(result?.Type).toBe("Syllable");
    expect(result?.SourceMatch).toMatchObject({
      title: "大东北我的家乡(DJ何鹏版)",
      artists: ["何玉"],
      durationMs: 246_807,
      method: "luna-pc-krc",
      evidence: { versionConflict: false },
    });
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
});
