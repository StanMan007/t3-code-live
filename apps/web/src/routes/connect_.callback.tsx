import { createFileRoute, redirect } from "@tanstack/react-router";

import { ConnectCliCallbackSurface } from "../components/cloud/ConnectCliAuthSurface";
import { connectCliAuthRoutesEnabled } from "./connect";

export const Route = createFileRoute("/connect_/callback")({
  beforeLoad: () => {
    if (!connectCliAuthRoutesEnabled()) {
      throw redirect({ to: "/", replace: true });
    }
  },
  component: ConnectCliCallbackSurface,
});
