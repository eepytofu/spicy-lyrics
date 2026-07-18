import { afterEach, describe, expect, it, vi } from "vitest";
import { searchKugouCandidates, searchKugouSongs } from "../src/providers/kugou";
import { neteaseProvider } from "../src/providers/netease";
import { searchQq } from "../src/providers/qq";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provider search flow", () => {
  it("continues past a weak first query and includes QQ grouped variants", async () => {
    const queries: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      queries.push(request.req.param.query);
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
      return new Response(JSON.stringify({ req: { data: { body: { song: { list } } } } }), {
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
      "Signal Lead Guest",
    ]);
    expect(songs[0]).toMatchObject({ id: 3, title: "Signal (feat. Guest)", artists: ["Lead", "Guest"] });
    expect(songs.some((song) => song.id === 1)).toBe(true);
  });

  it("continues NetEase search until a strong candidate and fetches that lyric", async () => {
    let searchCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/eapi/batch")) {
        searchCalls += 1;
        const song = searchCalls === 1
          ? { id: 1, name: "Signal", ar: [{ name: "Cover Artist" }], al: { name: "Tribute Covers" }, dt: 240_000 }
          : { id: 2, name: "Signal (feat. Guest)", ar: [{ name: "Lead" }, { name: "Guest" }], al: { name: "Signal Album" }, dt: 240_000 };
        return new Response(JSON.stringify({ data: { resources: [{ baseInfo: { simpleSongData: song } }] } }), {
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

    expect(searchCalls).toBe(2);
    expect(result?.SourceMatch).toMatchObject({
      title: "Signal (feat. Guest)",
      artists: ["Lead", "Guest"],
      coherent: true,
    });
  });

  it("uses KuGou catalog metadata and carries the selected hash into lyric search", async () => {
    const queries: string[] = [];
    let lyricHash = "";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.hostname === "songsearch.kugou.com") {
        queries.push(url.searchParams.get("keyword") ?? "");
        const lists = queries.length === 1
          ? [{ FileHash: "cover", SongName: "Signal", SingerName: "Cover Artist", AlbumName: "Tribute Covers", Duration: 240 }]
          : [{
              FileHash: "another-cover",
              SongName: "Signal",
              SingerName: "Cover Artist",
              AlbumName: "Tribute Covers",
              Duration: 240,
              Grp: [{
                FileHash: "wanted-hash",
                SongName: "Signal (feat. Guest)",
                SingerName: "Lead / Guest",
                AlbumName: "Signal Album",
                Duration: 240,
              }],
            }];
        return new Response(JSON.stringify({ data: { lists } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      lyricHash = url.searchParams.get("hash") ?? "";
      return new Response(JSON.stringify({
        candidates: [{ id: "wanted", accesskey: "wanted-key", song: "Signal (feat. Guest)", singer: "Lead / Guest", duration: 240_000 }],
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
    expect(songs[0]).toMatchObject({ hash: "wanted-hash", title: "Signal (feat. Guest)", artists: ["Lead", "Guest"] });
    expect(lyricHash).toBe("wanted-hash");
    expect(candidates[0]?.id).toBe("wanted");
  });
});
