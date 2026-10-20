export type Asset = { name: string; url: string; size: number; sha256?: string };

export type UpdateChannel = "stable" | "prerelease";

export type App = {
  id: string;
  name: string;
  description?: string;
  repo: string;
  category: string;
  releaseTagInclude?: string;
  asset: { include: string[]; exclude: string[] };
  installedVersion?: string | null;
  detect?: { type: string; names?: string[] };
  // Installed Decky plugin's own manifest name (decky-plugin detection only).
  pluginName?: string | null;
  latestVersion?: string | null;
  publishedAt?: string | null;
  releaseUrl?: string | null;
  assets: Asset[];
  updateAvailable?: boolean | null;
  error?: string | null;
  channel?: UpdateChannel;
};

// Manage-window buttons that Display Settings can hide.
export type HideableButton = "downloadZip" | "install" | "update" | "releasePage";

export type Settings = { overwriteExisting: boolean; updateChannel: UpdateChannel; language: string; columnsPerRow: 1 | 2 | 3; githubToken: string; density: "default" | "compact"; hiddenButtons: HideableButton[]; repoSettings?: Record<string, RepoPreference> };

export type Download = { state: string; filename?: string; repo?: string; received?: number; total?: number; path?: string; error?: string };

export type DeckyHubInfo = { version: string };

export type DeckyHubRelease = { version?: string; asset?: Asset; error?: string };

export type DeckyHubReleaseOption = { tag: string; prerelease: boolean; publishedAt: string | null; asset?: Asset; url: string };

export type AppReleaseOption = { tag: string; prerelease: boolean; publishedAt: string | null; url: string; assets: Asset[] };

export type View = "updates" | "discover";

export type SearchRepo = { full_name: string; description?: string; stargazers_count?: number };


export type ManagedRegistry = { url: string };

export type RepoPreference = { channel: "stable" | "prerelease"; assetFilter: string[] };
