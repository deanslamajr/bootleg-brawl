// IP rule enforced by tooling: scan every string in a content document (and its file name) for
// franchise names, character names and catchphrases from content/forbidden-terms.json.

export interface ForbiddenHit {
  path: string;
  term: string;
  text: string;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class ForbiddenScanner {
  private readonly res: { term: string; re: RegExp }[];
  private readonly allow: Set<string>;

  constructor(terms: readonly string[], allow: readonly string[] = []) {
    this.res = terms.map((term) => ({
      term,
      // Whole-word, case-insensitive; hyphens, apostrophes and spaces inside a term are flexible.
      re: new RegExp(
        `(^|[^a-z0-9])${escapeRe(term.toLowerCase()).replace(/\\?[ '-]/g, "[ '’_-]?")}($|[^a-z0-9])`,
        "i",
      ),
    }));
    this.allow = new Set(allow.map((a) => a.toLowerCase()));
  }

  scanText(text: string, path: string, extra: readonly string[] = []): ForbiddenHit[] {
    const hits: ForbiddenHit[] = [];
    const lower = text.toLowerCase();
    if (this.allow.has(lower)) return hits;
    for (const { term, re } of this.res) if (re.test(text)) hits.push({ path, term, text });
    for (const term of extra) {
      if (term && lower.includes(term.toLowerCase())) hits.push({ path, term, text });
    }
    return hits;
  }

  /** Walks every string value and object key in `doc`. */
  scanDoc(doc: unknown, file: string, extra: readonly string[] = []): ForbiddenHit[] {
    const hits: ForbiddenHit[] = [
      ...this.scanText(file.replace(/[/\\._]/g, " "), `${file}:<file name>`, extra),
    ];
    const walk = (v: unknown, path: string) => {
      if (typeof v === "string") hits.push(...this.scanText(v, `${file}:${path}`, extra));
      else if (Array.isArray(v)) v.forEach((item, i) => walk(item, `${path}[${i}]`));
      else if (v && typeof v === "object") {
        for (const [k, item] of Object.entries(v)) {
          // The parody metadata's own deny list is not content text.
          if (k === "forbiddenTerms") continue;
          hits.push(...this.scanText(k, `${file}:${path}.${k}<key>`, extra));
          walk(item, path ? `${path}.${k}` : k);
        }
      }
    };
    walk(doc, "");
    return hits;
  }
}
