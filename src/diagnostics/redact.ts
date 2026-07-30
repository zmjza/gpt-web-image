const SENSITIVE_KEY = /^(password|passphrase|cookie|cookies|token|access_token|refresh_token|api_key|authorization|proxy-authorization|set-cookie|headers|requestheaders|authheader|auth)$/i;
const TEXT_PATTERNS = [
  /(authorization\s*[:=]\s*)([^\s,;]+)/gi,
  /(cookie\s*[:=]\s*)([^\r\n]+)/gi,
  /((?:access|refresh)?_?token\s*[:=]\s*)([^\s,;]+)/gi,
  /(\bauth\s*[:=]\s*)([^\s,;]+)/gi,
  /(password\s*[:=]\s*)([^\s,;]+)/gi,
  /([?&](?:token|access_token|refresh_token|password|key)=)[^&#\s]+/gi
];

export function redactText(input: string): string {
  return TEXT_PATTERNS.reduce((value, pattern) => value.replace(pattern, "$1[REDACTED]"), input);
}

export function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) result[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactValue(entry);
    return result;
  }
  return value;
}

export function redactRecord<T>(value: T): T { return redactValue(value) as T; }
