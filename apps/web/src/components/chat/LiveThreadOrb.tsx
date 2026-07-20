import { useEffect, useMemo, useRef, useState } from "react";

import orbSceneSource from "../../assets/live-thread-orb.json?raw";
import orbRuntimeSource from "../../assets/live-thread-unicorn-studio.txt?raw";
import { cn } from "~/lib/utils";

import type { LiveThreadPhase } from "./LiveThreadControl";

const ORB_SPEED_BY_PHASE: Record<LiveThreadPhase, number> = {
  idle: 0.2,
  requesting: 0.32,
  connecting: 0.42,
  listening: 0.62,
  sent: 0.78,
  stopping: 0.26,
  error: 0.12,
};

function inlineScript(value: string): string {
  return value.replaceAll("</script", "<\\/script");
}

function inlineString(value: string): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function buildOrbDocument(): string {
  const patchedSceneSource = orbSceneSource
    .replaceAll("vec2(0.4470762476814534, 0.5163287800255401)", "vec2(0.5, 0.5)")
    .replaceAll("float pixelSize = 0.0025;", "float pixelSize = 0.001;")
    .replaceAll("vec3(1, 0.5176470588235295, 0.5019607843137255)", "vec3(0.02, 0.00, 0.08)")
    .replaceAll("vec3(0.6470588235294118, 0.47843137254901963, 1)", "vec3(0.08, 0.01, 0.16)")
    .replaceAll("1.0000 * vec3(1, 1, 1)", "0.72 * vec3(0.82, 0.66, 1.0)")
    .replaceAll(
      "refractionColor = sampleTexture(samplePosition, entryNormal);",
      "vec3 surfaceTexture = sampleTexture(samplePosition, entryNormal); float surface = smoothstep(0.08, 0.22, dot(surfaceTexture, vec3(0.3333))); refractionColor = mix(vec3(0.14, 0.03, 0.42), vec3(0.78, 0.18, 1.0), surface);",
    )
    .replaceAll(
      "if (partialAlpha == 0.0) { return vec4(0); }",
      "if (partialAlpha == 0.0) { return vec4(0.0, 0.0, 0.0, 1.0); }",
    );

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <style>
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #000; }
      #orb { position: absolute; inset: 0; width: 100%; height: 100%; }
    </style>
    <script>${inlineScript(orbRuntimeSource)}</script>
  </head>
  <body>
    <div id="orb"></div>
    <script>
      const sceneData = JSON.parse(${inlineString(patchedSceneSource)});
      for (const item of sceneData.history || []) {
        if (item.type !== "sdf_shape") continue;
        item.scale = 0.21;
        item.states = { appear: [], scroll: [], hover: [] };
      }
      const sceneBlob = new Blob([JSON.stringify(sceneData)], { type: "application/json" });
      const sceneUrl = URL.createObjectURL(sceneBlob);
      let scene = null;
      let speed = 0.2;
      let frame = 0;

      function setLayerSpeed(layers, nextSpeed) {
        if (!Array.isArray(layers)) return;
        for (const layer of layers) {
          if (typeof layer.speed === "number") layer.speed = nextSpeed;
          setLayerSpeed(layer.layers, nextSpeed);
          setLayerSpeed(layer.effects, nextSpeed);
        }
      }

      window.addEventListener("message", (event) => {
        if (event.data?.type !== "t3-live-thread-orb") return;
        speed = Number(event.data.speed) || 0.2;
        setLayerSpeed(scene?.layers, speed);
      });

      async function startOrb() {
        try {
          if (!window.UnicornStudio) throw new Error("Orb runtime unavailable");
          void window.UnicornStudio.init();
          scene = await window.UnicornStudio.addScene({
            elementId: "orb",
            filePath: sceneUrl,
            projectId: sceneData.id,
            fps: sceneData.options?.fps || 60,
            scale: sceneData.options?.scale || 1,
            dpi: Math.min((window.devicePixelRatio || 2) * 1.5, 3),
            altText: "Live Thread voice presence",
            ariaLabel: "Live Thread voice presence",
            interactivity: { mouse: { disabled: false } },
          });
          setLayerSpeed(scene?.layers, speed);
          const keepCentered = () => {
            const bounds = document.getElementById("orb")?.getBoundingClientRect();
            if (bounds) {
              window.dispatchEvent(new MouseEvent("mousemove", {
                bubbles: true,
                clientX: bounds.width / 2,
                clientY: bounds.height / 2,
              }));
            }
            frame = requestAnimationFrame(keepCentered);
          };
          frame = requestAnimationFrame(keepCentered);
          window.parent.postMessage({ type: "t3-live-thread-orb-ready" }, "*");
        } catch (error) {
          window.parent.postMessage({
            type: "t3-live-thread-orb-error",
            message: error instanceof Error ? error.message : String(error),
          }, "*");
        }
      }

      void startOrb();
      window.addEventListener("beforeunload", () => {
        cancelAnimationFrame(frame);
        scene?.destroy?.();
        URL.revokeObjectURL(sceneUrl);
      });
    </script>
  </body>
</html>`;
}

export function LiveThreadOrb({ phase }: { readonly phase: LiveThreadPhase }) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const documentHtml = useMemo(() => buildOrbDocument(), []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (event.data?.type === "t3-live-thread-orb-ready") {
        setReady(true);
        setFailed(false);
      } else if (event.data?.type === "t3-live-thread-orb-error") {
        setFailed(true);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: "t3-live-thread-orb", speed: ORB_SPEED_BY_PHASE[phase] },
      "*",
    );
  }, [phase, ready]);

  return (
    <div
      className={cn(
        "relative size-52 transition duration-700",
        phase === "listening" && "scale-[1.04]",
        phase === "sent" && "scale-[1.02]",
        phase === "error" && "opacity-60 grayscale",
      )}
      aria-hidden="true"
    >
      {!ready && !failed ? (
        <div className="absolute inset-[34%] animate-pulse rounded-full bg-foreground/10 blur-xl" />
      ) : null}
      {failed ? (
        <div className="absolute inset-[36%] rounded-full border border-border/70 bg-muted/40" />
      ) : null}
      <iframe
        ref={iframeRef}
        title="Live Thread orb"
        srcDoc={documentHtml}
        className={cn(
          "relative size-full scale-[1.12] border-0 bg-black contrast-[1.12] saturate-[1.25] mix-blend-screen transition-opacity duration-700",
          ready ? "opacity-100" : "opacity-0",
        )}
        style={{
          WebkitMaskImage:
            "radial-gradient(circle at center, black 0%, black 24%, transparent 32%)",
          maskImage: "radial-gradient(circle at center, black 0%, black 24%, transparent 32%)",
        }}
        sandbox="allow-scripts"
      />
    </div>
  );
}
