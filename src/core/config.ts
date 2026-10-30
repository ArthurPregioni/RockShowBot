/** Validate the operator's origin before using it in OAuth redirects or email. */
export function configuredOrigin(value: string | undefined, development = false): string {
  if (!value?.trim()) {
    if (development) return "http://localhost:5173";
    throw new Error("Configure ROCKSHOWBOT_SITE_ORIGIN com a URL HTTPS desta instalação.");
  }
  const url = new URL(value.trim());
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      !(url.protocol === "https:" || development && loopback && url.protocol === "http:")) {
    throw new Error("ROCKSHOWBOT_SITE_ORIGIN deve conter somente a origem HTTPS, sem caminho ou credenciais.");
  }
  return url.origin;
}
