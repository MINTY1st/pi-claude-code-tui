/**
 * 環境変数の値。Windows の process.env は名前の大文字小文字を区別しないが、写したオブジェクトは区別するため
 * （PATH が Path になる）、Windows では区別せずに探す
 */
export function environmentValue(
  environment: Record<string, string | undefined>,
  name: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (environment[name] !== undefined || platform !== "win32") return environment[name];
  const upper = name.toUpperCase();
  return Object.entries(environment).find(([key]) => key.toUpperCase() === upper)?.[1];
}

/** Whether an environment flag is set to something other than an explicit "off" value. */
export function envFlagEnabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return !!normalized && !["0", "false", "no", "off"].includes(normalized);
}
