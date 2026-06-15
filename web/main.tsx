// Browser entry. Bundled by esbuild (web/main.tsx → web/main.js + web/main.css)
// and served from the loopback server. The Primer functional theme CSS is
// imported here so esbuild folds it (and every component's CSS) into main.css.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BaseStyles, ThemeProvider } from "@primer/react";
import { MotionConfig } from "motion/react";
import "@primer/primitives/dist/css/functional/themes/light.css";
import "@primer/primitives/dist/css/functional/themes/dark.css";
import "./app.css";
import "@wterm/react/css";
import { App } from "./components/App";
import { ToastProvider } from "./components/Toast";

const el = document.getElementById("root");
if (el) {
    createRoot(el).render(
        <StrictMode>
            <ThemeProvider colorMode="auto">
                <BaseStyles>
                    <MotionConfig reducedMotion="user">
                        <ToastProvider>
                            <App />
                        </ToastProvider>
                    </MotionConfig>
                </BaseStyles>
            </ThemeProvider>
        </StrictMode>,
    );
}
