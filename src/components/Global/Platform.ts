// Spotify Types
type TokenProviderResponse = {
  accessToken: string;
  expiresAtTime: number;
  tokenType: "Bearer";
};

// Store all our Spotify Services
const Spotify: typeof Spicetify = (globalThis as any).Spicetify;
let SpotifyPlatform: typeof Spicetify.Platform;
let SpotifyInternalFetch: typeof Spicetify.CosmosAsync;

// Spotify Ready Promise
const OnSpotifyReady = new Promise<void>((resolve) => {
  const CheckForServices = () => {
    SpotifyPlatform = Spotify.Platform;
    SpotifyInternalFetch = Spotify.CosmosAsync;

    if (!SpotifyPlatform || !SpotifyInternalFetch) {
      requestAnimationFrame(() => setTimeout(CheckForServices, 0));
      return;
    }

    resolve();
  };

  CheckForServices();
});

// Get Spotify Access Token Function
const TOKEN_REFRESH_SKEW_MS = 2_000;
let tokenProviderResponse: TokenProviderResponse | undefined;
let accessTokenPromise: Promise<string> | undefined;

const GetSpotifyAccessToken = (): Promise<string> => {
  if (
    tokenProviderResponse &&
    tokenProviderResponse.expiresAtTime - Date.now() > TOKEN_REFRESH_SKEW_MS
  ) {
    return Promise.resolve(tokenProviderResponse.accessToken);
  }
  tokenProviderResponse = undefined;

  if (accessTokenPromise) {
    return accessTokenPromise;
  }

  accessTokenPromise = SpotifyInternalFetch.get("sp://oauth/v2/token")
    .then((result: TokenProviderResponse) => {
      tokenProviderResponse = result;
      return result.accessToken;
    })
    .catch((error: unknown) => {
      if (!(error instanceof Error) || !error.message.includes("Resolver not found")) {
        throw error;
      }

      if (!SpotifyPlatform.Session) {
        console.warn("Failed to find SpotifyPlatform.Session for fetching token");
        throw error;
      }

      tokenProviderResponse = {
        accessToken: SpotifyPlatform.Session.accessToken,
        expiresAtTime: SpotifyPlatform.Session.accessTokenExpirationTimestampMs,
        tokenType: "Bearer",
      };
      return tokenProviderResponse.accessToken;
    })
    .finally(() => {
      accessTokenPromise = undefined;
    });

  return accessTokenPromise;
};

const Platform = {
  OnSpotifyReady,
  GetSpotifyAccessToken,
  get SpotifyVersion(): number[] {
    return Spicetify.Platform.version.split(".").map((i) => Number.parseInt(i, 10));
  }
};

export default Platform;
