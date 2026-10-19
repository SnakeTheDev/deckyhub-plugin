import { callable } from "@decky/api";
import type { Asset, App, Settings, Download, DeckyHubInfo, ManagedRepo, ManagedRegistry, RepoPreference } from "./types";

export const getApps = callable<[], { apps: App[] }>("get_apps");
export const getSettings = callable<[], Settings>("get_settings");
export const saveSettings = callable<[settings: Settings], Settings>("save_settings");
export const downloadAsset = callable<[asset: Asset, repo?: string], { jobId?: string; error?: string }>("download_asset");
export const getDownload = callable<[jobId: string], Download>("get_download");
export const cancelDownload = callable<[jobId: string], { ok: boolean }>("cancel_download");
export const getDeckyHubInfo = callable<[], DeckyHubInfo>("get_deckyhub_info");
export const addCustomRepo = callable<[repo: string], { added: boolean; repo: string }>("add_custom_repo");
export const getCustomRepos = callable<[], { repos: ManagedRepo[] }>("get_custom_repos");
export const removeCustomRepo = callable<[repo: string], { removed: boolean; repo: string }>("remove_custom_repo");
export const exportCustomRepos = callable<[], { path: string }>("export_custom_repos");
export const importCustomRepos = callable<[path: string], { added: string[] }>("import_custom_repos");
export const getCustomRegistries = callable<[], { registries: ManagedRegistry[] }>("get_custom_registries");
export const addCustomRegistry = callable<[url: string], { added: boolean; url: string; apps?: number }>("add_custom_registry");
export const removeCustomRegistry = callable<[url: string], { removed: boolean; url: string }>("remove_custom_registry");
export const refreshRegistry = callable<[], { apps: number }>("refresh_registry");
export const exportLogs = callable<[], { path: string }>("export_logs");
export const logFrontend = callable<[message: string], void>("log_frontend");
export const clearDownloads = callable<[], { removed: number }>("clear_downloads");
export const listDownloads = callable<[], { items: { name: string; directory: boolean }[] }>("list_downloads");
export const saveRepoSettings = callable<[repo: string, values: RepoPreference], RepoPreference>("save_repo_settings");

export const REGISTRY_UPDATED = "deckyhub-registry-updated";
