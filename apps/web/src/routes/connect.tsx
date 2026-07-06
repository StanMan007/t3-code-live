import { createFileRoute, redirect } from "@tanstack/react-router";

import { hasConnectCliAuthConfig } from "../cloud/connectCliAuth";
import { hasCloudPublicConfig } from "../cloud/publicConfig";
import { ConnectCliAuthorizeSurface } from "../components/cloud/ConnectCliAuthSurface";
import { isHostedStaticApp } from "../hostedPairing";

// The web bundle also ships inside local/desktop instances; the CLI connect
// handshake only exists on the hosted app, so everything else bounces home.
export function connectCliAuthRoutesEnabled(): boolean {
  return isHostedStaticApp() && hasCloudPublicConfig() && hasConnectCliAuthConfig();
}

export const Route = createFileRoute("/connect")({
  beforeLoad: () => {
    if (!connectCliAuthRoutesEnabled()) {
      throw redirect({ to: "/", replace: true });
    }
  },
  component: ConnectCliAuthorizeSurface,
});
