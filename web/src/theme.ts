// Page theme: follow the system, or the viewer's own choice (kept in this browser only).
// The choice is stamped on <html data-theme>, which the CSS palette reads.
import { useEffect, useState } from "preact/hooks";
import { usePreference } from "./state";

export type ThemeChoice = "system" | "light" | "dark";
export const THEMES: Record<ThemeChoice, string> = { system: "Match device", light: "Light", dark: "Dark" };
const isTheme = (v: string): v is ThemeChoice => v in THEMES;

const query = () => (typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null);

/** [choice, setChoice, whether the page is dark right now]. */
export function useTheme(): [ThemeChoice, (t: ThemeChoice) => void, boolean] {
  const [choice, setChoice] = usePreference<ThemeChoice>("wardmap.theme", "system", isTheme);
  const [systemDark, setSystemDark] = useState(() => query()?.matches ?? false);
  useEffect(() => {
    const q = query();
    if (!q) return;
    const on = () => setSystemDark(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    if (choice === "system") delete root.dataset.theme;
    else root.dataset.theme = choice;
  }, [choice]);
  return [choice, setChoice, choice === "dark" || (choice === "system" && systemDark)];
}
