export const TOKEN_EXPIRY_SAFETY_MARGIN_MS = 30_000;

export type AuthorizationApiTokenState = {
  isAuthorized?: boolean;
  token?: {
    accessToken?: string;
    accessTokenExpirationTimestampMs?: number;
    isAnonymous?: boolean;
  } | null;
};

export type CosmosTokenResponse = {
  accessToken?: string;
  expiresAtTime?: number;
};

export type SessionTokenState = {
  accessToken?: string;
  accessTokenExpirationTimestampMs?: number;
};

type TokenCandidate = {
  accessToken: string;
  expiresAtTime?: number;
};

type TokenReader<T> = () => T | undefined | Promise<T | undefined>;

export type SpotifyTokenProviderDependencies = {
  now: () => number;
  sources: {
    readAuthorizationApiState?: TokenReader<AuthorizationApiTokenState>;
    readLegacyCosmosToken?: TokenReader<CosmosTokenResponse>;
    readSessionTokenState?: TokenReader<SessionTokenState>;
  };
};

export class SpotifyTokenAcquisitionError extends Error {
  constructor() {
    super("Unable to obtain a Spotify access token from any source");
    this.name = "SpotifyTokenAcquisitionError";
  }
}

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const finiteExpiry = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

export function createSpotifyTokenProvider(dependencies: SpotifyTokenProviderDependencies) {
  const { now, sources } = dependencies;
  let cached: TokenCandidate | undefined;
  let inFlight: Promise<string> | undefined;
  let epoch = 0;

  const usable = (candidate: TokenCandidate | undefined): candidate is TokenCandidate =>
    Boolean(candidate)
    && nonEmpty(candidate!.accessToken)
    && (
      candidate!.expiresAtTime === undefined
      || candidate!.expiresAtTime - now() > TOKEN_EXPIRY_SAFETY_MARGIN_MS
    );

  const authorization = async (): Promise<TokenCandidate | undefined> => {
    const state = await sources.readAuthorizationApiState?.();
    if (!state || state.isAuthorized === false || state.token?.isAnonymous === true) return undefined;
    if (!nonEmpty(state.token?.accessToken)) return undefined;
    const expiresAtTime = finiteExpiry(state.token?.accessTokenExpirationTimestampMs);
    if (expiresAtTime === undefined || expiresAtTime - now() <= TOKEN_EXPIRY_SAFETY_MARGIN_MS) {
      return undefined;
    }
    return { accessToken: state.token.accessToken, expiresAtTime };
  };

  const cosmos = async (): Promise<TokenCandidate | undefined> => {
    const response = await sources.readLegacyCosmosToken?.();
    if (!nonEmpty(response?.accessToken)) return undefined;
    const expiresAtTime = finiteExpiry(response.expiresAtTime);
    const candidate = { accessToken: response.accessToken, expiresAtTime };
    return usable(candidate) ? candidate : undefined;
  };

  const session = async (): Promise<TokenCandidate | undefined> => {
    const state = await sources.readSessionTokenState?.();
    if (!nonEmpty(state?.accessToken)) return undefined;
    const expiresAtTime = finiteExpiry(state.accessTokenExpirationTimestampMs);
    const candidate = { accessToken: state.accessToken, expiresAtTime };
    return usable(candidate) ? candidate : undefined;
  };

  const safeRead = async (reader: () => Promise<TokenCandidate | undefined>) => {
    try {
      return await reader();
    } catch {
      return undefined;
    }
  };

  const refresh = async (startedAtEpoch: number): Promise<string> => {
    for (const reader of [authorization, cosmos, session]) {
      const candidate = await safeRead(reader);
      if (!candidate) continue;
      if (startedAtEpoch === epoch) cached = candidate;
      return candidate.accessToken;
    }
    throw new SpotifyTokenAcquisitionError();
  };

  const getToken = (): Promise<string> => {
    if (usable(cached)) return Promise.resolve(cached.accessToken);
    cached = undefined;
    if (inFlight) return inFlight;
    const pending = refresh(epoch).finally(() => {
      if (inFlight === pending) inFlight = undefined;
    });
    inFlight = pending;
    return pending;
  };

  const invalidate = (): void => {
    epoch += 1;
    cached = undefined;
    inFlight = undefined;
  };

  return { getToken, invalidate };
}
