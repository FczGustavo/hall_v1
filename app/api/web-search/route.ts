type WebSearchRequest = {
  query?: string;
};

type WebSearchItem = {
  title: string;
  snippet: string;
  url: string;
};

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function toItem(topic: Record<string, unknown>): WebSearchItem | null {
  const title = typeof topic.Text === "string" ? cleanText(topic.Text) : "";
  const url = typeof topic.FirstURL === "string" ? topic.FirstURL : "";
  if (!title || !url) return null;

  const parts = title.split(" - ");
  const safeTitle = cleanText(parts[0] || title);
  const snippet = cleanText(parts.slice(1).join(" - ") || title);

  return {
    title: safeTitle,
    snippet,
    url,
  };
}

export const maxDuration = 20;

export async function POST(req: Request) {
  const body = (await req.json()) as WebSearchRequest;
  const query = cleanText(body.query || "");

  if (!query) {
    return Response.json({ query: "", results: [] });
  }

  const endpoint = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;
  const response = await fetch(endpoint, {
    headers: {
      "User-Agent": "HAL-Voice-Assistant/1.0",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return new Response("Web search failed", { status: 502 });
  }

  const json = (await response.json()) as Record<string, unknown>;
  const items: WebSearchItem[] = [];

  const abstractText = typeof json.AbstractText === "string" ? cleanText(json.AbstractText) : "";
  const abstractUrl = typeof json.AbstractURL === "string" ? json.AbstractURL : "";
  const heading = typeof json.Heading === "string" ? cleanText(json.Heading) : "";

  if (abstractText && abstractUrl) {
    items.push({
      title: heading || query,
      snippet: abstractText,
      url: abstractUrl,
    });
  }

  const relatedTopics = Array.isArray(json.RelatedTopics) ? json.RelatedTopics : [];
  for (const raw of relatedTopics) {
    if (items.length >= 5) break;
    if (!raw || typeof raw !== "object") continue;

    const direct = toItem(raw as Record<string, unknown>);
    if (direct) {
      items.push(direct);
      continue;
    }

    const nested = Array.isArray((raw as Record<string, unknown>).Topics)
      ? ((raw as Record<string, unknown>).Topics as unknown[])
      : [];

    for (const nestedRaw of nested) {
      if (items.length >= 5) break;
      if (!nestedRaw || typeof nestedRaw !== "object") continue;
      const nestedItem = toItem(nestedRaw as Record<string, unknown>);
      if (nestedItem) {
        items.push(nestedItem);
      }
    }
  }

  return Response.json({
    query,
    results: items.slice(0, 5),
  });
}
