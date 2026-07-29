export interface SyncedPosition {
  StartedSyncAt: number;
  Position: number;
}

export interface LocalPositionAnchor {
  Position: number;
  SampledAt: number;
  TrackUri: string | null;
}

export interface PlaybackStateReading {
  Position: number;
  ReadAt: number;
  WasPlaying: boolean;
}

export interface LocalPositionSyncState {
  anchor: LocalPositionAnchor | null;
  playbackState: PlaybackStateReading | null;
}

interface PlayerPositionState {
  positionAsOfTimestamp: number;
  timestamp: number;
}

interface LocalPositionSample {
  sampledPosition: number;
  sampledAt: number;
  trackUri: string | null;
  isPlaying: boolean;
  playerState?: PlayerPositionState | null;
}

export const LOCAL_ANCHOR_RESYNC_THRESHOLD = 1000;

export function initialLocalPositionSyncState(): LocalPositionSyncState {
  return { anchor: null, playbackState: null };
}

/**
 * Holds the first timestamp for a repeated local-player sample so the lyric
 * clock can keep extrapolating when Spotify's local position API stalls.
 * Track changes, seeks, new samples, and pauses deliberately create a fresh
 * anchor.
 */
export function resolveLocalPositionSample(
  previous: LocalPositionSyncState,
  sample: LocalPositionSample,
  jumpThreshold = LOCAL_ANCHOR_RESYNC_THRESHOLD,
): { state: LocalPositionSyncState; position: SyncedPosition; stateJumped: boolean } {
  const playbackPosition = sample.playerState
    ? sample.isPlaying
      ? sample.playerState.positionAsOfTimestamp +
        (sample.sampledAt - sample.playerState.timestamp)
      : sample.playerState.positionAsOfTimestamp
    : Number.NaN;

  let playbackState = previous.playbackState;
  let stateJumped = false;
  if (Number.isFinite(playbackPosition)) {
    if (playbackState?.WasPlaying && sample.isPlaying) {
      const expected = playbackState.Position + (sample.sampledAt - playbackState.ReadAt);
      stateJumped = Math.abs(playbackPosition - expected) > jumpThreshold;
    }
    playbackState = {
      Position: playbackPosition,
      ReadAt: sample.sampledAt,
      WasPlaying: sample.isPlaying,
    };
  }

  const anchorIsStale =
    previous.anchor !== null &&
    sample.isPlaying &&
    (previous.anchor.TrackUri !== sample.trackUri || stateJumped);
  const anchor =
    !previous.anchor ||
    previous.anchor.Position !== sample.sampledPosition ||
    !sample.isPlaying ||
    anchorIsStale
      ? {
          Position: sample.sampledPosition,
          SampledAt: sample.sampledAt,
          TrackUri: sample.trackUri,
        }
      : previous.anchor;

  return {
    state: { anchor, playbackState },
    position: {
      StartedSyncAt: anchor.SampledAt,
      Position: anchor.Position,
    },
    stateJumped,
  };
}
