/**
 * Learning-resource fetcher for optimization suggestions.
 *
 * NOTE: Unlike the rest of TokenWise (which is strictly local-only), this module
 * intentionally makes outbound requests to YouTube and DuckDuckGo to surface a
 * relevant video + article for a given topic. This is a deliberate, user-approved
 * exception to the local-only non-goal. Only the topic string is sent; no session
 * or token data ever leaves the machine. Results are cached in memory per topic.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

export interface ResourceLink {
  title: string;
  url: string;
  source: string;
}

export interface LearningResources {
  topic: string;
  video: ResourceLink | null;
  doc: ResourceLink | null;
  fetchedAt: string;
}

const cache = new Map<string, LearningResources>();

async function fetchText(url: string, extraHeaders: Record<string, string> = {}): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", ...extraHeaders },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function findVideo(topic: string): Promise<ResourceLink | null> {
  const html = await fetchText(
    "https://www.youtube.com/results?search_query=" + encodeURIComponent(topic)
  );
  if (!html) return null;
  const m = html.match(/"videoId":"([\w-]{11})"/);
  if (!m) return null;
  const id = m[1];
  const url = `https://www.youtube.com/watch?v=${id}`;

  // Reliable title via YouTube's official oEmbed endpoint.
  let title = topic;
  try {
    const oembed = await fetchText(
      "https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent(url)
    );
    if (oembed) {
      const j = JSON.parse(oembed) as { title?: string; author_name?: string };
      if (j.title) title = j.author_name ? `${j.title} — ${j.author_name}` : j.title;
    }
  } catch {
    /* keep fallback title */
  }
  return { title, url, source: "YouTube" };
}

async function findDoc(topic: string): Promise<ResourceLink | null> {
  const html = await fetchText(
    "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(topic)
  );
  if (!html) return null;
  const m = html.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
  if (!m) return null;

  let href = m[1].replace(/&amp;/g, "&");
  // DuckDuckGo wraps results in a redirect: //duckduckgo.com/l/?uddg=<encoded>
  const uddg = href.match(/[?&]uddg=([^&]+)/);
  if (uddg) href = decodeURIComponent(uddg[1]);
  else if (href.startsWith("//")) href = "https:" + href;

  const title = m[2].replace(/<[^>]+>/g, "").trim() || topic;
  let host = "Web";
  try {
    host = new URL(href).hostname.replace(/^www\./, "");
  } catch {
    /* ignore */
  }
  return { title, url: href, source: host };
}

export async function getResources(topic: string): Promise<LearningResources> {
  const key = topic.trim().toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;

  const [video, doc] = await Promise.all([findVideo(topic), findDoc(topic)]);
  const result: LearningResources = {
    topic,
    video,
    doc,
    fetchedAt: new Date().toISOString(),
  };
  cache.set(key, result);
  return result;
}
