/** Search normalization only. Similar names are never proof of identity or authority. */
export function normalizeInstitutionName(value: string): string {
  const aliases: Record<string, string> = {
    univ: "university",
    universitys: "university",
    coll: "college",
    colg: "college",
    inst: "institute",
    instt: "institute",
    govt: "government",
    tech: "technology",
    st: "saint",
  };
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .map((word) => aliases[word] ?? word)
    .filter((word) => word && !["and", "the", "of"].includes(word))
    .join(" ");
}

export type RegistrySource = "aishe" | "ugc" | "aicte";
export type RegistryImportRow = {
  source: RegistrySource;
  externalId: string;
  canonicalName: string;
  institutionType: string;
  state: string;
  city: string | null;
  aisheCode: string | null;
  officialWebsite: string | null;
  officialDomain: string | null;
  status: string;
  sourceUrl: string;
  sourceUpdatedAt: string;
  /** Crosschecks require an explicit existing registry UUID, never a fuzzy-name merge. */
  registryId: string | null;
};

const hosts: Record<RegistrySource, string[]> = {
  aishe: ["aishe.gov.in", "aishe.nic.in"],
  ugc: ["ugc.gov.in", "ugc.ac.in"],
  aicte: ["aicte-india.org", "aicte.gov.in"],
};

function text(
  row: Record<string, unknown>,
  key: string,
  required = true,
  max = 200,
): string | null {
  const value = row[key];
  if (value == null || value === "") {
    if (!required) return null;
    throw new Error("Missing registry field: " + key);
  }
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error("Invalid registry field: " + key);
  return value.trim();
}

/** Boundary for downloaded official JSON, or consistently mapped official CSV exports. */
export function adaptRegistryRows(source: RegistrySource, rows: unknown[]): RegistryImportRow[] {
  if (!Object.hasOwn(hosts, source) || rows.length > 100000)
    throw new Error("Invalid registry import");
  return rows.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new Error("Invalid registry row");
    const row = raw as Record<string, unknown>;
    const sourceUrl = new URL(text(row, "source_url", true, 2000)!);
    if (
      sourceUrl.protocol !== "https:" ||
      sourceUrl.username ||
      sourceUrl.password ||
      !hosts[source].some(
        (host) => sourceUrl.hostname === host || sourceUrl.hostname.endsWith("." + host),
      )
    ) {
      throw new Error("Registry provenance must use an official " + source.toUpperCase() + " host");
    }
    const updated = text(row, "source_updated_at")!;
    if (!Number.isFinite(Date.parse(updated)) || Date.parse(updated) > Date.now())
      throw new Error("Invalid source update timestamp");
    const officialWebsite = text(row, "official_website", false, 2000);
    let officialDomain: string | null = null;
    if (officialWebsite) {
      const website = new URL(officialWebsite);
      if (website.protocol !== "https:" || website.username || website.password)
        throw new Error("Invalid official website");
      officialDomain = website.hostname.toLowerCase().replace(/^www\./, "");
    }
    const registryId = text(row, "registry_id", false);
    if (registryId && !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(registryId))
      throw new Error("Invalid registry ID");
    const aisheCode = text(row, "aishe_code", false);
    if (source === "aishe" && !aisheCode) throw new Error("AISHE import requires an AISHE code");
    return {
      source,
      externalId: text(row, "external_id", true, 150)!,
      canonicalName: text(row, "canonical_name")!,
      institutionType: text(row, "institution_type", true, 100)!,
      state: text(row, "state", true, 100)!,
      city: text(row, "city", false, 120),
      aisheCode,
      officialWebsite,
      officialDomain,
      status: text(row, "status", true, 100)!,
      sourceUrl: sourceUrl.href,
      sourceUpdatedAt: new Date(updated).toISOString(),
      registryId,
    };
  });
}

/** Small RFC4180-style reader. Mapping deliberately happens before the canonical adapter. */
export function parseRegistryCsv(input: string): Record<string, string>[] {
  const lines: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const textInput = input.replace(/^\uFEFF/, "");
  for (let i = 0; i < textInput.length; i++) {
    const char = textInput[i]!;
    if (char === '"') {
      if (quoted && textInput[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (quoted || cell === "") quoted = !quoted;
      else throw new Error("Invalid CSV quote");
    } else if (!quoted && char === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && (char === "\r" || char === "\n")) {
      if (char === "\r" && textInput[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((value) => value !== "")) lines.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("Unterminated CSV quote");
  if (cell || row.length) {
    row.push(cell);
    lines.push(row);
  }
  const headers = lines.shift();
  if (
    !headers ||
    new Set(headers).size !== headers.length ||
    headers.some((h) => !h || ["__proto__", "constructor", "prototype"].includes(h))
  )
    throw new Error("Invalid CSV headers");
  return lines.map((values) => {
    if (values.length !== headers.length) throw new Error("CSV column mismatch");
    return Object.fromEntries(headers.map((header, i) => [header, values[i]!]));
  });
}
