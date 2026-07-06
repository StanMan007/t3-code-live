import {
  buildConnectClerkAuthorizeUrl,
  CONNECT_CALLBACK_PATH,
  CONNECT_OAUTH_SCOPES,
  readConnectAuthorizeRequest,
  type ConnectAuthorizeRequest,
} from "@t3tools/shared/connectAuth";
import { clerkFrontendApiUrlFromPublishableKey } from "@t3tools/shared/relayAuth";

import { resolveCloudPublicConfig } from "./publicConfig";

const CONNECT_CLI_AUTH_STATE_STORAGE_KEY = "t3code-connect-cli-auth-state";

function trimNonEmpty(value: string | undefined): string | null {
  return value?.trim() || null;
}

export function resolveConnectCliOAuthClientId(): string | null {
  return trimNonEmpty(import.meta.env.VITE_CLERK_CLI_OAUTH_CLIENT_ID as string | undefined);
}

export function hasConnectCliAuthConfig(): boolean {
  return Boolean(
    resolveCloudPublicConfig().clerkPublishableKey && resolveConnectCliOAuthClientId(),
  );
}

export function readConnectCliAuthorizeRequest(
  url: URL = new URL(window.location.href),
): ConnectAuthorizeRequest | null {
  return readConnectAuthorizeRequest(url);
}

/**
 * Builds the Clerk authorize URL for a CLI-initiated connect request. The
 * state is mirrored into sessionStorage so the callback page can verify the
 * response matches a request this browser actually started.
 */
export function buildConnectCliClerkAuthorizeUrl(
  request: ConnectAuthorizeRequest,
  currentOrigin: string = window.location.origin,
): string | null {
  const { clerkPublishableKey } = resolveCloudPublicConfig();
  const clientId = resolveConnectCliOAuthClientId();
  if (!clerkPublishableKey || !clientId) {
    return null;
  }
  return buildConnectClerkAuthorizeUrl({
    authorizationEndpoint: `${clerkFrontendApiUrlFromPublishableKey(clerkPublishableKey)}/oauth/authorize`,
    clientId,
    redirectUri: new URL(CONNECT_CALLBACK_PATH, currentOrigin).toString(),
    scopes: CONNECT_OAUTH_SCOPES,
    state: request.state,
    challenge: request.challenge,
  });
}

export function rememberConnectCliAuthState(state: string): void {
  try {
    window.sessionStorage.setItem(CONNECT_CLI_AUTH_STATE_STORAGE_KEY, state);
  } catch {
    // Session storage can be unavailable (e.g. blocked). The callback page
    // then falls back to trusting the state Clerk echoed back.
  }
}

export function consumeConnectCliAuthState(): string | null {
  try {
    const state = window.sessionStorage.getItem(CONNECT_CLI_AUTH_STATE_STORAGE_KEY);
    window.sessionStorage.removeItem(CONNECT_CLI_AUTH_STATE_STORAGE_KEY);
    return state;
  } catch {
    return null;
  }
}

export interface ConnectCliCallbackResult {
  readonly code: string;
  readonly state: string;
}

export function readConnectCliCallbackResult(
  url: URL = new URL(window.location.href),
): ConnectCliCallbackResult | null {
  const code = url.searchParams.get("code")?.trim() ?? "";
  const state = url.searchParams.get("state")?.trim() ?? "";
  if (!code || !state) {
    return null;
  }
  return { code, state };
}
