/**
 * Core helpers raise a plain Error for text written for the user. Transport, parser and
 * database failures carry another name, a code or a driver prefix; those get the fallback.
 */
export function publicMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error) || error.name !== "Error" || "code" in error || error.message.startsWith("D1_")) return fallback;
  return error.message || fallback;
}
