import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";

interface SidebarLiveRebuildConfirmationProps {
  readonly activeTaskCount: number;
  readonly open: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly title?: string;
  readonly description?: string;
  readonly confirmLabel?: string;
}

export function SidebarLiveRebuildConfirmation({
  activeTaskCount,
  open,
  onCancel,
  onConfirm,
  title = "Restart while a task is running?",
  description,
  confirmLabel = "Restart now anyway",
}: SidebarLiveRebuildConfirmationProps) {
  const runningTaskCopy =
    activeTaskCount === 1
      ? "1 task is still running."
      : `${activeTaskCount} tasks are still running.`;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onCancel();
      }}
    >
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {runningTaskCopy}{" "}
            {description ??
              "Restarting will interrupt the active work, rebuild T3 Code Live, and reopen the app when the signed update is ready."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Keep working
          </Button>
          <Button onClick={onConfirm}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
