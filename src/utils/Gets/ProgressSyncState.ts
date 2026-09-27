export interface SyncedPosition {
  StartedSyncAt: number;
  Position: number;
  TrackUri?: string | null;
}

export function isPositionSampleCurrent(
  position: SyncedPosition,
  currentTrackUri: string | null,
): boolean {
  return position.TrackUri === currentTrackUri;
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
  rawSource: LocalPositionSourceHealth | null;
}

export interface LocalPositionSourceHealth {
  lastPosition: number;
  lastChangeAt: number;
  consecutiveChanges: number;
  usingPlaybackState: boolean;
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
export const LOCAL_SOURCE_STALL_TIMEOUT = 500;
export const LOCAL_SOURCE_RECOVERY_STREAK = 3;

export function initialLocalPositionSyncState(): LocalPositionSyncState {
  return { anchor: null, playbackState: null, rawSource: null };
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

  const trackChanged =
    previous.anchor !== null && previous.anchor.TrackUri !== sample.trackUri;
  const rawChanged = previous.rawSource?.lastPosition !== sample.sampledPosition;
  let rawSource: LocalPositionSourceHealth;
  if (!previous.rawSource || trackChanged) {
    rawSource = {
      lastPosition: sample.sampledPosition,
      lastChangeAt: sample.sampledAt,
      consecutiveChanges: 0,
      usingPlaybackState: false,
    };
  } else {
    rawSource = {
      ...previous.rawSource,
      lastPosition: sample.sampledPosition,
      consecutiveChanges: rawChanged
        ? previous.rawSource.consecutiveChanges + 1
        : 0,
      ...(rawChanged ? { lastChangeAt: sample.sampledAt } : {}),
    };
  }

  if (sample.isPlaying) {
    if (
      rawSource.usingPlaybackState
      && rawSource.consecutiveChanges >= LOCAL_SOURCE_RECOVERY_STREAK
    ) {
      rawSource.usingPlaybackState = false;
    } else if (
      sample.sampledAt - rawSource.lastChangeAt > LOCAL_SOURCE_STALL_TIMEOUT
    ) {
      rawSource.usingPlaybackState = true;
    }
  } else {
    // Paused playback legitimately freezes the raw source. Preserve the active
    // source choice, but do not let paused time count toward a new stall.
    rawSource.lastChangeAt = sample.sampledAt;
    rawSource.consecutiveChanges = 0;
  }

  if (
    rawSource.usingPlaybackState
    && sample.isPlaying
    && Number.isFinite(playbackPosition)
  ) {
    const anchor = {
      Position: playbackPosition,
      SampledAt: sample.sampledAt,
      TrackUri: sample.trackUri,
    };
    return {
      state: { anchor, playbackState, rawSource },
      position: {
        StartedSyncAt: sample.sampledAt,
        Position: playbackPosition,
      },
      stateJumped,
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
    state: { anchor, playbackState, rawSource },
    position: {
      StartedSyncAt: anchor.SampledAt,
      Position: anchor.Position,
    },
    stateJumped,
  };
}
