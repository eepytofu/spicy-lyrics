import { toast } from "sonner";
import { dbPromise } from "./db";
import { LocalLyricsManager } from "./Lyrics/manager";
import { clearKuromojiAssetCache } from "./Lyrics/Analyzer/KuromojiAssetCache";
import { openSettingsPanel } from "./settings";
import { OpenLyricsDBPanel } from "./openLyricsDBPanel";
import { DeepFreeze } from "./utils";
import { triggerSpicyLyricsFakeUpdate } from "./version/CheckForUpdates";
import { SPICY_LYRICS_BUILD_MARKER } from "./buildMarker";
import { BreakerDebug } from "./API/CircuitBreaker";

const inspectQueryBreaker = () => {
    const state = BreakerDebug.state();
    return {
        open: state.open === true,
        retryAfterMs: Math.max(0, Number(state.retryAfterMs) || 0),
        ladderIndex: Math.max(0, Number(state.ladderIndex) || 0),
        lastTripAt: Math.max(0, Number(state.lastTripAt) || 0),
        lastProbeAt: Math.max(0, Number(state.lastProbeAt) || 0),
    };
};

export function exposeToWindow() {
    (window as any).__spicyLyricsBuildMarker = SPICY_LYRICS_BUILD_MARKER;
    const api = {
        buildMarker: SPICY_LYRICS_BUILD_MARKER,
        panels: {
            settings: {
                open: () => openSettingsPanel(),
            },
            lyricsDB: {
                open: () => OpenLyricsDBPanel(),
            },
        },
        db: {
            dbPromise: dbPromise,
            objectStores: {
                lyricsStore: {
                    manager: LocalLyricsManager,
                },
                japaneseAssets: {
                    clear: clearKuromojiAssetCache,
                }
            }
        },
        testing: {
            autoUpdate: {
                triggerFakeUpdate: triggerSpicyLyricsFakeUpdate,
            },
            queryBreaker: {
                inspect: inspectQueryBreaker,
                reset: () => {
                    BreakerDebug.reset();
                    return inspectQueryBreaker();
                },
            },
            toaster: toast,
        }
    };

    (window as any).SpicyLyrics = DeepFreeze(api);
}
