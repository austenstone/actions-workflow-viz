import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useRef, useState } from "react";

type ShowToast = (msg: string, isError?: boolean) => void;

const ToastContext = createContext<ShowToast>(() => {});

export function useToast(): ShowToast {
    return useContext(ToastContext);
}

// Holds the transient bottom-center toast and exposes showToast() to the tree.
// Mirrors the old vanilla toast: 3.5s for info, 6s for errors.
export function ToastProvider({ children }: { children: ReactNode }) {
    const [toast, setToast] = useState({ msg: "", isError: false, show: false });
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const showToast = useCallback<ShowToast>((msg, isError = false) => {
        setToast({ msg, isError, show: true });
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(
            () => setToast((t) => ({ ...t, show: false })),
            isError ? 6000 : 3500,
        );
    }, []);

    return (
        <ToastContext.Provider value={showToast}>
            {children}
            <div
                className={
                    "awv-toast" + (toast.show ? " show" : "") + (toast.isError ? " err" : "")
                }
                role="status"
                aria-live="polite"
            >
                {toast.msg}
            </div>
        </ToastContext.Provider>
    );
}
