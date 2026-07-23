import { ProviderInteractionMode } from "@t3tools/contracts";
import { memo, type ReactNode } from "react";
import { BotIcon, ListTodoIcon, PencilRulerIcon, PlusIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";

export const CompactComposerControlsMenu = memo(function CompactComposerControlsMenu(props: {
  activePlan: boolean;
  interactionMode: ProviderInteractionMode;
  planSidebarLabel: string;
  planSidebarOpen: boolean;
  runContextControls?: ReactNode;
  showInteractionModeToggle: boolean;
  traitsPicker?: ReactNode;
  onToggleInteractionMode: () => void;
  onTogglePlanSidebar: () => void;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            size="icon-sm"
            variant="ghost"
            className="shrink-0 rounded-full text-muted-foreground/80 hover:text-foreground"
            aria-label="Add context or change composer options"
            data-chat-composer-plus-trigger="true"
          />
        }
      >
        <PlusIcon aria-hidden="true" className="size-4" />
      </PopoverTrigger>
      <PopoverPopup align="start" side="top" className="w-72" viewportClassName="grid gap-2 p-2">
        {props.runContextControls}

        {props.runContextControls && (props.traitsPicker || props.showInteractionModeToggle) ? (
          <div className="mx-1 h-px bg-border/60" />
        ) : null}

        {props.traitsPicker ? (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-1">
            <span className="text-muted-foreground text-xs">Model options</span>
            {props.traitsPicker}
          </div>
        ) : null}

        {props.showInteractionModeToggle ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-between px-2 font-normal"
            onClick={props.onToggleInteractionMode}
            aria-label={`Switch to ${props.interactionMode === "plan" ? "Build" : "Plan"} mode`}
          >
            <span className="text-muted-foreground text-xs">Mode</span>
            <span className="inline-flex items-center gap-1.5 text-foreground">
              {props.interactionMode === "plan" ? (
                <PencilRulerIcon className="size-3.5 text-blue-400" />
              ) : (
                <BotIcon className="size-3.5 text-muted-foreground" />
              )}
              {props.interactionMode === "plan" ? "Plan" : "Build"}
            </span>
          </Button>
        ) : null}

        {props.activePlan ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 px-2 font-normal"
            onClick={props.onTogglePlanSidebar}
          >
            <ListTodoIcon className="size-4 shrink-0" />
            {props.planSidebarOpen
              ? `Hide ${props.planSidebarLabel.toLowerCase()} sidebar`
              : `Show ${props.planSidebarLabel.toLowerCase()} sidebar`}
          </Button>
        ) : null}
      </PopoverPopup>
    </Popover>
  );
});
