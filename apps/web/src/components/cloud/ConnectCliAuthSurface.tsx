import { useAuth, useClerk, useUser } from "@clerk/react";
import { encodeConnectAuthCode } from "@t3tools/shared/connectAuth";
import { useEffect, useMemo, useState } from "react";

import { APP_DISPLAY_NAME } from "../../branding";
import {
  buildConnectCliClerkAuthorizeUrl,
  consumeConnectCliAuthState,
  readConnectCliAuthorizeRequest,
  readConnectCliCallbackResult,
  rememberConnectCliAuthState,
} from "../../cloud/connectCliAuth";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { Button } from "../ui/button";

function ConnectCliAuthShell({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10 text-foreground sm:px-6">
      <div className="pointer-events-none absolute inset-0 opacity-80">
        <div className="absolute inset-x-0 top-0 h-44 bg-[radial-gradient(44rem_16rem_at_top,color-mix(in_srgb,var(--color-emerald-500)_14%,transparent),transparent)]" />
        <div className="absolute inset-y-0 left-0 w-72 bg-[radial-gradient(28rem_18rem_at_left,color-mix(in_srgb,var(--color-sky-500)_10%,transparent),transparent)]" />
        <div className="absolute inset-0 bg-[linear-gradient(145deg,color-mix(in_srgb,var(--background)_90%,var(--color-black))_0%,var(--background)_55%)]" />
      </div>

      <section className="relative w-full max-w-xl rounded-2xl border border-border/80 bg-card/90 p-6 shadow-2xl shadow-black/20 backdrop-blur-md sm:p-8">
        <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
          {APP_DISPLAY_NAME}
        </p>
        {children}
      </section>
    </div>
  );
}

function ConnectCliAuthMessage({
  title,
  description,
}: {
  readonly title: string;
  readonly description: string;
}) {
  return (
    <>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
    </>
  );
}

const invalidLinkMessage = {
  title: "This connect link is incomplete",
  description:
    "The link is missing its authorization request. Re-run `t3 connect` in your terminal and open the freshly printed URL.",
} as const;

/**
 * /connect: the URL a headless CLI prints. Waits for a Clerk session, then
 * forwards the CLI's PKCE request to Clerk's authorize endpoint.
 */
export function ConnectCliAuthorizeSurface() {
  const request = useMemo(() => readConnectCliAuthorizeRequest(), []);
  const clerk = useClerk();
  const { isLoaded, isSignedIn } = useAuth();
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    if (!request || !isLoaded || redirecting) {
      return;
    }
    if (!isSignedIn) {
      clerk.openSignIn({ forceRedirectUrl: window.location.href });
      return;
    }
    const authorizeUrl = buildConnectCliClerkAuthorizeUrl(request);
    if (!authorizeUrl) {
      return;
    }
    setRedirecting(true);
    rememberConnectCliAuthState(request.state);
    window.location.assign(authorizeUrl);
  }, [clerk, isLoaded, isSignedIn, redirecting, request]);

  if (!request) {
    return (
      <ConnectCliAuthShell>
        <ConnectCliAuthMessage {...invalidLinkMessage} />
      </ConnectCliAuthShell>
    );
  }

  return (
    <ConnectCliAuthShell>
      <ConnectCliAuthMessage
        title="Connecting your terminal"
        description={
          isSignedIn
            ? "Redirecting to authorize T3 Connect for your CLI…"
            : "Sign in to continue authorizing T3 Connect for your CLI."
        }
      />
    </ConnectCliAuthShell>
  );
}

/**
 * /connect/callback: Clerk's redirect target. Shows the one-time code the
 * user pastes back into the waiting terminal.
 */
export function ConnectCliCallbackSurface() {
  const result = useMemo(() => readConnectCliCallbackResult(), []);
  const expectedState = useMemo(() => consumeConnectCliAuthState(), []);
  const { user } = useUser();
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "authentication code" });

  if (!result) {
    return (
      <ConnectCliAuthShell>
        <ConnectCliAuthMessage
          title="Authorization did not complete"
          description="No authorization code was returned. Re-run `t3 connect` in your terminal and try again."
        />
      </ConnectCliAuthShell>
    );
  }

  // A response for a request this browser did not start is the CSRF shape the
  // state parameter exists to stop; refuse to display a code for it.
  if (expectedState !== null && expectedState !== result.state) {
    return (
      <ConnectCliAuthShell>
        <ConnectCliAuthMessage
          title="This code belongs to a different request"
          description="The authorization response does not match the connect request this browser started. Re-run `t3 connect` in your terminal and open the freshly printed URL."
        />
      </ConnectCliAuthShell>
    );
  }

  const accountLabel = user?.primaryEmailAddress?.emailAddress ?? user?.username ?? null;
  const authCode = encodeConnectAuthCode(result);

  return (
    <ConnectCliAuthShell>
      <ConnectCliAuthMessage
        title="Almost connected"
        description={
          accountLabel
            ? `Paste this code into your waiting terminal to connect it as ${accountLabel}.`
            : "Paste this code into your waiting terminal to finish connecting."
        }
      />

      <div className="mt-6 rounded-lg border border-border/80 bg-background/60 p-4">
        <code className="block text-sm break-all select-all" data-testid="connect-auth-code">
          {authCode}
        </code>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button type="button" onClick={() => copyToClipboard(authCode)}>
          {isCopied ? "Copied!" : "Copy code"}
        </Button>
      </div>

      <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
        Only paste this code into a terminal session you started yourself. Anyone holding it can
        link their machine to your T3 Connect account while it is valid.
      </p>
    </ConnectCliAuthShell>
  );
}
