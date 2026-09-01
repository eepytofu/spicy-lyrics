import {
  createSpotifyTokenProvider,
  type AuthorizationApiTokenState,
  type CosmosTokenResponse,
  type SessionTokenState,
} from "./SpotifyTokenProvider.ts";

// Store all our Spotify Services
const Spotify: typeof Spicetify = (globalThis as any).Spicetify;
let SpotifyPlatform: typeof Spicetify.Platform | undefined;
let SpotifyInternalFetch: typeof Spicetify.CosmosAsync | undefined;

type TokenPlatform = {
  AuthorizationAPI?: { getState?: () => unknown };
  Session?: SessionTokenState;
};

const tokenPlatform = (): TokenPlatform | undefined =>
  SpotifyPlatform as unknown as TokenPlatform | undefined;

// Spotify Ready Promise
const OnSpotifyReady = new Promise<void>((resolve) => {
  const CheckForServices = () => {
    SpotifyPlatform = Spotify.Platform;
    SpotifyInternalFetch = Spotify.CosmosAsync;

    const hasAuthorizationApi = typeof tokenPlatform()?.AuthorizationAPI?.getState === "function";
    const hasSession = Boolean(tokenPlatform()?.Session);
    if (!SpotifyPlatform || (!hasAuthorizationApi && !SpotifyInternalFetch && !hasSession)) {
      requestAnimationFrame(() => setTimeout(CheckForServices, 0));
      return;
    }

    resolve();
  };

  CheckForServices();
});

const tokenProvider = createSpotifyTokenProvider({
  now: Date.now,
  sources: {
    readAuthorizationApiState: () =>
      tokenPlatform()?.AuthorizationAPI?.getState?.() as AuthorizationApiTokenState | undefined,
    readLegacyCosmosToken: () =>
      SpotifyInternalFetch?.get("sp://oauth/v2/token") as Promise<CosmosTokenResponse> | undefined,
    readSessionTokenState: () => tokenPlatform()?.Session,
  },
});

const GetSpotifyAccessToken = (): Promise<string> => tokenProvider.getToken();
const InvalidateSpotifyAccessToken = (): void => tokenProvider.invalidate();

const Platform = {
  OnSpotifyReady,
  GetSpotifyAccessToken,
  InvalidateSpotifyAccessToken,
  get SpotifyVersion(): number[] {
    return Spicetify.Platform.version.split(".").map((i) => Number.parseInt(i, 10));
  }
};

export default Platform;
