// Parses a CAL FIRE incident page. The page is HTML with no official feed found, so this is fragile by design.
// Every field is optional. A page that yields nothing returns null, and the caller keeps the last good result.

export interface CalFireIncident {
  url: string;
  name: string;
  acres: number | null;
  containmentPct: number | null;
  // Kept as the page's own text, e.g. "October 16, 2026 9:16 PM".
  updatedText: string | null;
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNumber(text: string): number | null {
  const value = Number(text.replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

export function parseCalFireIncident(html: string, url: string): CalFireIncident | null {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const rawName = h1 ? stripTags(h1[1]) : title ? stripTags(title[1]).replace(/\|\s*CAL FIRE.*$/i, '') : '';
  const name = rawName.trim();

  const text = stripTags(html);
  const acresMatch = text.match(/([\d,]+(?:\.\d+)?)\s*acres/i);
  const containMatch = text.match(/(\d{1,3})\s*%\s*contained/i);
  const updatedMatch = text.match(/last\s+updated?:?\s*([A-Za-z]+\s+\d{1,2},\s+\d{4}(?:\s+\d{1,2}:\d{2}\s*[AP]M)?)/i);

  const acres = acresMatch ? parseNumber(acresMatch[1]) : null;
  const containmentPct = containMatch ? parseNumber(containMatch[1]) : null;

  if (!name || (acres === null && containmentPct === null)) return null;
  return {
    url,
    name,
    acres,
    containmentPct,
    updatedText: updatedMatch ? updatedMatch[1].trim() : null,
  };
}
