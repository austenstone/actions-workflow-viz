import { useRef, useState } from "react";
import { Checkbox, Dialog, FormControl } from "@primer/react";

interface CancelConfirmDialogProps {
    onConfirm: () => void;
    onClose: () => void;
}

// Confirmation before cancelling a run, with a "don't ask again" opt-out stored
// in localStorage (key awv:skipCancelConfirm) — same contract as the old modal.
export function CancelConfirmDialog({ onConfirm, onClose }: CancelConfirmDialogProps) {
    const [skip, setSkip] = useState(false);
    const okRef = useRef<HTMLButtonElement>(null);

    const confirm = () => {
        if (skip) {
            try {
                localStorage.setItem(SKIP_CANCEL_KEY, "1");
            } catch {
                /* localStorage unavailable — proceed without persisting */
            }
        }
        onConfirm();
    };

    return (
        <Dialog
            title="Cancel this run?"
            subtitle="In-progress and queued jobs will stop. This can't be undone."
            role="alertdialog"
            width="medium"
            onClose={onClose}
            footerButtons={[
                { content: "Keep running", onClick: onClose },
                {
                    content: "Cancel run",
                    buttonType: "danger",
                    onClick: confirm,
                    autoFocus: true,
                    ref: okRef,
                },
            ]}
        >
            <FormControl>
                <Checkbox checked={skip} onChange={(e) => setSkip(e.target.checked)} />
                <FormControl.Label>Don't ask me again</FormControl.Label>
            </FormControl>
        </Dialog>
    );
}

export const SKIP_CANCEL_KEY = "awv:skipCancelConfirm";

export function shouldSkipCancelConfirm(): boolean {
    try {
        return localStorage.getItem(SKIP_CANCEL_KEY) === "1";
    } catch {
        return false;
    }
}
