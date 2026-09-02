const BEARER = /Bearer\s+[A-Za-z0-9_.-]+/gi;
const TOKEN_QUERY = /([?&](?:access_)?token=)[^&\s]+/gi;
const GITHUB_TOKEN = /\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/gi;
const CREDENTIAL_URL = /(https?:\/\/[^\s/:@]+:)[^\s/@]+(@[^\s]+)/gi;
const JSON_SECRET = /(["'](?:token|password|secret|api[_-]?key)["']\s*:\s*["'])[^"']+(["'])/gi;

export function redactSensitive(input: string): string {
  return input
    .replace(BEARER, "Bearer [REDACTED]")
    .replace(TOKEN_QUERY, "$1[REDACTED]")
    .replace(CREDENTIAL_URL, "$1[REDACTED]$2")
    .replace(JSON_SECRET, "$1[REDACTED]$2")
    .replace(GITHUB_TOKEN, "[REDACTED]");
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return redactSensitive(error.message);
  }
  return redactSensitive(String(error));
}
