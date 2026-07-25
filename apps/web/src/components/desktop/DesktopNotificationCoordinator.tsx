import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { useClientSettings } from "../../hooks/useSettings";
import { setActiveEnvironmentId, useProjects, useThreadShells } from "../../state/entities";
import {
  DesktopNotificationTransitionController,
  projectDesktopNotificationThreadSnapshot,
} from "../../desktopNotifications";

function projectKey(environmentId: string, projectId: string): string {
  return `${environmentId}\u0000${projectId}`;
}

export function DesktopNotificationCoordinator() {
  const preference = useClientSettings((settings) => settings.desktopNotificationPreference);
  const projects = useProjects();
  const threads = useThreadShells();
  const navigate = useNavigate();
  const controllerRef = useRef(new DesktopNotificationTransitionController());

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge?.onDesktopThreadNavigation) {
      return;
    }
    return bridge.onDesktopThreadNavigation((target) => {
      setActiveEnvironmentId(target.environmentId);
      void navigate({
        to: "/$environmentId/$threadId",
        params: target,
      });
    });
  }, [navigate]);

  useEffect(() => {
    const projectTitles = new Map(
      projects.map((project) => [projectKey(project.environmentId, project.id), project.title]),
    );
    const candidates = controllerRef.current.update(
      threads.map((thread) =>
        projectDesktopNotificationThreadSnapshot({
          environmentId: thread.environmentId,
          projectTitle:
            projectTitles.get(projectKey(thread.environmentId, thread.projectId)) ?? "T3 Code",
          thread,
        }),
      ),
    );

    const bridge = window.desktopBridge;
    if (
      preference === "off" ||
      window.Notification?.permission !== "granted" ||
      !bridge?.showDesktopNotification
    ) {
      return;
    }

    for (const candidate of candidates) {
      void bridge
        .showDesktopNotification({
          kind: "thread",
          condition: preference,
          ...candidate,
        })
        .catch((error: unknown) => {
          console.warn("Could not show a desktop completion notification.", { error });
        });
    }
  }, [preference, projects, threads]);

  return null;
}
