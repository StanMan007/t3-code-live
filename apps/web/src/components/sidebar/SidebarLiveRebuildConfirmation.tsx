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
}

export function SidebarLiveRebuildConfirmation({
  activeTaskCount,
  open,
  onCancel,
  onConfirm,
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
          <DialogTitle>Restart while a task is running?</DialogTitle>
          <DialogDescription>
            {runningTaskCopy} Restarting will interrupt the active work, rebuild T3 Code Live, and
            reopen the app when the signed update is ready.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Keep working
          </Button>
          <Button onClick={onConfirm}>Restart now anyway</Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
