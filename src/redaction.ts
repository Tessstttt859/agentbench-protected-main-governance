const BEARER = /Bearer\s+[A-Za-z0-9_.-]+/gi;
const TOKEN_QUERY = /([?&](?:access_)?token=)[^&\s]+/gi;

export function redactSensitive(input: string): string {
  return input.replace(BEARER, "Bearer [REDACTED]").replace(TOKEN_QUERY, "$1[REDACTED]");
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return redactSensitive(error.message);
  }
  return redactSensitive(String(error));
}
