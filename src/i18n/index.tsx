import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getSettings } from "../api";
import { applyDensity, setGithubToken, setTranslator, substitute } from "../utils";
import { en, type MessageKey, type TFunc } from "./en";
import { uk } from "./uk";
import { ru } from "./ru";
import { es } from "./es";
import { de } from "./de";
import { fr } from "./fr";
import { ja } from "./ja";
import { zh } from "./zh";

export type Locale = "en" | "uk" | "ru" | "es" | "de" | "fr" | "ja" | "zh";

export const LOCALES: { code: Locale; label: string }[] = [
  { code: "en", label: "English" },
  { code: "uk", label: "Українська" },
  { code: "ru", label: "Русский" },
  { code: "es", label: "Español" },
  { code: "de", label: "Deutsch" },
  { code: "fr", label: "Français" },
  { code: "ja", label: "日本語" },
  { code: "zh", label: "中文" },
];

const MESSAGES: Record<Locale, Record<MessageKey, string>> = { en, uk, ru, es, de, fr, ja, zh };

export const LOCALE_CHANGED = "deckyhub-locale-changed";

function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && value in MESSAGES;
}

function detectLocale(): Locale {
  for (const raw of navigator.languages ?? [navigator.language]) {
    const code = raw.toLowerCase().split("-")[0];
    if (isLocale(code)) return code;
  }
  return "en";
}

const I18nContext = createContext<{ locale: Locale; t: TFunc } | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<string>("auto");

  useEffect(() => {
    // Every route mounts its own I18nProvider instance (see index.tsx), so
    // this doubles as the one place that primes the GitHub token for every
    // api.github.com call in this tree — see setGithubToken() in utils.ts.
    // SettingsPage re-dispatches LOCALE_CHANGED whenever the token changes
    // too, not just the language, so this re-syncs both on save.
    const refresh = () =>
      void getSettings().then((settings) => {
        setPreference(settings.language || "auto");
        setGithubToken(settings.githubToken || "");
        applyDensity(settings.density);
      });
    refresh();
    window.addEventListener(LOCALE_CHANGED, refresh);
    return () => window.removeEventListener(LOCALE_CHANGED, refresh);
  }, []);

  const locale = preference === "auto" ? detectLocale() : isLocale(preference) ? preference : "en";
  const t: TFunc = (key, vars) => substitute(MESSAGES[locale][key], vars);

  useEffect(() => setTranslator(t), [locale]);

  return <I18nContext.Provider value={{ locale, t }}>{children}</I18nContext.Provider>;
}

export function useT(): TFunc {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useT must be used within I18nProvider");
  return ctx.t;
}
