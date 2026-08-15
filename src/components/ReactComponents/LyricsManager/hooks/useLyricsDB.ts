import { useCallback, useEffect, useState } from "react";
import { LocalLyricsManager } from "../../../../utils/Lyrics/manager";
import { $currentLyricsData } from "../../../../utils/stores";
import ApplyLyrics from "../../../../utils/Lyrics/Global/Applyer";
import fetchLyrics, { invalidateLyricsPipeline } from "../../../../utils/Lyrics/fetchLyrics";
import { SpotifyPlayer } from "../../../Global/SpotifyPlayer";
import {
  automaticLyricsOverride,
  getLyricsOverridePreference,
  setLyricsOverridePreference,
} from "../../../../utils/Lyrics/LyricsOverridePreference.ts";
import type { LocalLyricsEnvelope } from "../../../../utils/Lyrics/LocalLyricsSource.ts";

export type UseLyricsDBResult = {
  uris: string[];
  loading: boolean;
  refresh: () => Promise<void>;
  remove: (uri: string) => Promise<void>;
  put: (uri: string, lyrics: LocalLyricsEnvelope) => Promise<void>;
  getRaw: (uri: string) => Promise<LocalLyricsEnvelope | null>;
};

export function useLyricsDB(): UseLyricsDBResult {
  const [uris, setUris] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const keys = await LocalLyricsManager.listKeys();
      setUris(keys);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const remove = useCallback(
    async (uri: string) => {
      const preference = await getLyricsOverridePreference(uri);
      await LocalLyricsManager.remove(uri);
      if (preference?.kind === "local") {
        await setLyricsOverridePreference(automaticLyricsOverride(uri));
      }
      if (preference?.kind === "local" && SpotifyPlayer.GetUri() === uri) {
        invalidateLyricsPipeline();
        $currentLyricsData.set("");
        setTimeout(() => {
          fetchLyrics(uri).then(ApplyLyrics);
        }, 25);
      }
      await refresh();
    },
    [refresh]
  );

  const put = useCallback(
    async (uri: string, lyrics: LocalLyricsEnvelope) => {
      await LocalLyricsManager.put(uri, lyrics);
      await refresh();
    },
    [refresh]
  );

  const getRaw = useCallback(async (uri: string) => {
    return LocalLyricsManager.getRaw(uri);
  }, []);

  return { uris, loading, refresh, remove, put, getRaw };
}
