export function normalize(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
export function webURL(value: string) {
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("Informe um link HTTP ou HTTPS válido.");
  return url.href;
}
export async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, "0")).join("");
}
export const COUNTRY_NAMES: Record<string, string> = {
  BR: "Brasil", AR: "Argentina", CL: "Chile", UY: "Uruguai", PY: "Paraguai", BO: "Bolívia", PE: "Peru", EC: "Equador",
  CO: "Colômbia", VE: "Venezuela", MX: "México", CR: "Costa Rica", PA: "Panamá", GT: "Guatemala", DO: "República Dominicana",
  US: "Estados Unidos", CA: "Canadá", PT: "Portugal", ES: "Espanha", GB: "Reino Unido", FR: "França", DE: "Alemanha", AU: "Austrália", JP: "Japão",
};
export type Candidate = { id: string; name: string };
export type ShowEvent = { id?: string; artist: string; title: string; country: string; city: string; startsAt: string; url: string; source: string; status: "listed" | "unverified" };

export function appleConfiguration(token: string | undefined, origin: string) {
  if (!token) throw new Error("Falta a credencial MusicKit do aplicativo. A vinculação de conta está indisponível.");
  try {
    const decode = (part: string) => JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error();
    const header = decode(parts[0]);
    const claims = decode(parts[1]);
    if (header.alg !== "ES256" || !header.kid || !claims.iss || !Number.isFinite(claims.exp)) throw new Error();
    if (claims.exp * 1000 < Date.now() + 60000) throw new Error("A credencial Apple Music expirou. É preciso renová-la.");
    if (claims.origin && (!Array.isArray(claims.origin) || !claims.origin.includes(origin))) throw new Error("A credencial Apple Music foi gerada para outro endereço. Gere-a para a URL desta instalação.");
  } catch (error) {
    if (error instanceof Error && error.message.includes("credencial")) throw error;
    throw new Error("A credencial MusicKit configurada não é um token ES256 válido.");
  }
  return token;
}

export async function appleLibrary(userToken: string, developerToken: string, origin: string, transport: typeof fetch = fetch): Promise<Candidate[]> {
  if (typeof userToken !== "string" || !userToken || userToken.length > 20000 || /[\r\n]/.test(userToken)) throw new Error("Autorização Apple Music inválida. Conecte novamente.");
  let path: string | null = "/v1/me/library/artists?limit=25";
  const seen = new Set<string>();
  const found = new Map<string, Candidate>();
  while (path) {
    const url = new URL(path, "https://api.music.apple.com");
    if (url.origin !== "https://api.music.apple.com" || url.pathname !== "/v1/me/library/artists" || url.hash || seen.has(url.href)) throw new Error("Apple Music retornou paginação inválida.");
    seen.add(url.href);
    const response = await transport(url, { headers: { Authorization: "Bearer " + developerToken, "Music-User-Token": userToken, Origin: origin }, signal: AbortSignal.timeout(20000), redirect: "manual" });
    if (!response.ok) {
      const messages: Record<number, string> = {401: "Apple recusou a credencial MusicKit. Confira a validade e a origem.", 403: "Apple recusou o acesso à biblioteca. Confira sua assinatura e autorize novamente.", 429: "A Apple limitou as consultas. Aguarde e tente novamente."};
      throw new Error(messages[response.status] || "Apple Music está indisponível. Tente novamente.");
    }
    const payload = await response.json() as { data: { id: string; attributes?: { name?: string } }[]; next?: string };
    for (const artist of payload.data || []) if (artist.id && artist.attributes?.name) found.set(artist.id, { id: artist.id, name: artist.attributes.name });
    path = payload.next || null;
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function decodeXML(text: string) {
  const value = text.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1");
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_m, key: string) => {
    if (key.startsWith("#")) {
      const code = key[1].toLowerCase() === "x" ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[key.toLowerCase()] || "";
  });
}
export function newsItems(xml: string, artist: string, country: string): ShowEvent[] {
  const results: ShowEvent[] = [];
  for (const match of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/g)) {
    const get = (tag: string) => decodeXML(match[1].match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`))?.[1] || "").trim();
    const title = get("title"), link = get("link");
    if (!(` ${normalize(title)} `).includes(` ${normalize(artist)} `) || !/\b(show|shows|turne|tour|concierto|concertos?|festival|festivais)\b/.test(normalize(title))) continue;
    try { webURL(link); } catch { continue; }
    results.push({ artist, title, country, city: "", startsAt: "", url: link, source: get("source") || "Google News", status: "unverified" });
    if (results.length === 5) break;
  }
  return results;
}

export async function discover(artist: string, country: string, keys: { ticketmaster?: string; predicthq?: string }, transport: typeof fetch = fetch) {
  const events: ShowEvent[] = [], warnings: string[] = [];
  const tasks: Promise<void>[] = [];
  const countryName = COUNTRY_NAMES[country] || country;
  tasks.push((async () => {
    try {
      const q = `"${artist}" (show OR turnê OR tour OR concierto) "${countryName}" when:30d`;
      const response = await transport("https://news.google.com/rss/search?" + new URLSearchParams({ q, hl: "pt-BR", gl: "BR", ceid: "BR:pt-419" }), { signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error();
      events.push(...newsItems(await response.text(), artist, country));
    } catch { warnings.push(`Notícias indisponíveis para ${artist} (${country}).`); }
  })());
  if (keys.ticketmaster) tasks.push((async () => {
    try {
      const query = new URLSearchParams({ apikey: keys.ticketmaster!, keyword: artist, countryCode: country, classificationName: "music", size: "50", sort: "date,asc" });
      const response = await transport("https://app.ticketmaster.com/discovery/v2/events.json?" + query, { signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error();
      const payload = await response.json() as any;
      for (const event of payload._embedded?.events || []) {
        if (["cancelled", "canceled"].includes(event.dates?.status?.code)) continue;
        const attractions = event._embedded?.attractions || [];
        if (attractions.length ? !attractions.some((item: any) => normalize(item.name || "") === normalize(artist)) : !(` ${normalize(event.name || "")} `).includes(` ${normalize(artist)} `)) continue;
        const venue = event._embedded?.venues?.[0] || {};
        events.push({ artist, title: event.name, country, city: venue.city?.name || "", startsAt: event.dates?.start?.localDate || "", url: event.url, source: "Ticketmaster", status: "listed" });
      }
    } catch { warnings.push(`Ticketmaster indisponível para ${artist} (${country}).`); }
  })());
  if (keys.predicthq) tasks.push((async () => {
    try {
      const query = new URLSearchParams({ q: artist, category: "concerts,festivals", country, "start.gte": new Date().toISOString().slice(0, 10), limit: "50", sort: "start" });
      const response = await transport("https://api.predicthq.com/v1/events/?" + query, { headers: { Authorization: "Bearer " + keys.predicthq }, signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error();
      const payload = await response.json() as any;
      for (const event of payload.results || []) {
        if (!(` ${normalize(event.title || "")} `).includes(` ${normalize(artist)} `) && !(event.entities || []).some((e: any) => normalize(e.name || "") === normalize(artist))) continue;
        events.push({ artist, title: event.title, country, city: "", startsAt: (event.start || "").slice(0, 10), url: "https://www.predicthq.com/events", source: "PredictHQ", status: "listed" });
      }
    } catch { warnings.push(`PredictHQ indisponível para ${artist} (${country}).`); }
  })());
  await Promise.all(tasks);
  return { events, warnings };
}
