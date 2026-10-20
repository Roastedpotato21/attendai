import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { verificationRpc } from "@/lib/services/institution-verification";
import type { RegistryMatch } from "@/lib/institution-verification";

export function InstitutionSearch({
  onSelect,
  initialQuery = "",
}: {
  onSelect: (match: RegistryMatch | null, query: string) => void;
  initialQuery?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [matches, setMatches] = useState<RegistryMatch[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function search() {
    if (query.trim().length < 3) {
      setError("Enter at least three characters, or an AISHE code.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      setMatches(
        await verificationRpc<RegistryMatch[]>("search_institution_registry", {
          p_query: query.trim(),
        }),
      );
    } catch {
      setError("The official registry is not available right now. You can request manual review.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="institution-search">Institution name or AISHE code</Label>
        <Input
          id="institution-search"
          value={query}
          maxLength={100}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void search();
            }
          }}
        />
      </div>
      <Button type="button" onClick={() => void search()} disabled={busy}>
        {busy ? "Searching…" : "Search official registry"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {matches?.length === 0 && (
        <p className="text-sm">
          No imported official match was found. This does not mean your institution is invalid; use
          manual review.
        </p>
      )}
      {matches && matches.length > 1 && (
        <p className="text-sm text-muted-foreground">
          Several official records may match. Compare the state, type and AISHE code before
          choosing.
        </p>
      )}
      <ul className="space-y-2">
        {matches?.map((match) => (
          <li key={match.id}>
            <button
              type="button"
              className="w-full rounded-lg border p-3 text-left hover:bg-muted"
              onClick={() => onSelect(match, query)}
            >
              <strong>{match.canonical_name}</strong>
              <span className="block text-sm">
                {match.state} · {match.institution_type} ·{" "}
                {match.aishe_code ?? "AISHE code not available"}
              </span>
              <span className="text-xs text-muted-foreground">
                Official sources:{" "}
                {match.sources.map((s) => s.toUpperCase()).join(", ") || "Pending source review"}.
                Representative authority still requires verification.
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Button type="button" variant="outline" onClick={() => onSelect(null, query)}>
        Institution not found — request manual review
      </Button>
    </div>
  );
}
