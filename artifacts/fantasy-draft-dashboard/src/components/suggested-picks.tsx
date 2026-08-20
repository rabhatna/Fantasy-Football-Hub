import { Sparkles } from "lucide-react";
import { useGetRecommendations } from "@workspace/api-client-react";
import type { Recommendation } from "@workspace/api-client-react";

const initials = (name: string) =>
  name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("");

function SuggestionCard({
  suggestion,
  rank,
  onInspect,
}: {
  suggestion: Recommendation;
  rank: number;
  onInspect: (playerId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onInspect(suggestion.playerId)}
      data-testid={`button-suggestion-${suggestion.playerId}`}
      className="group w-full rounded-xl px-2.5 py-3 text-left transition hover:bg-muted"
    >
      <div className="flex items-center gap-3">
        <span className="mono w-4 text-[10px] text-muted-foreground">{rank}</span>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-[9px] font-bold text-primary">
          {initials(suggestion.name)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-bold group-hover:text-primary">
            {suggestion.name}
          </span>
          <span className="mono text-[9px] text-muted-foreground">
            {suggestion.position} / {suggestion.team}
          </span>
        </span>
      </div>
      {suggestion.reasons.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1 pl-7">
          {suggestion.reasons.slice(0, 3).map((reason) => (
            <span
              key={reason}
              className="rounded bg-secondary/80 px-1.5 py-0.5 text-[9px] leading-3 text-muted-foreground"
            >
              {reason}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

/**
 * The ranked suggested-picks rail. The server derives everything — remaining
 * snake picks, needs net of keepers, consensus prices — so this component
 * only renders the argument it is handed.
 */
export function SuggestedPicks({ onInspect }: { onInspect: (playerId: string) => void }) {
  const { data: suggestions } = useGetRecommendations();

  return (
    <section className="rounded-2xl border border-border bg-card shadow-sm" data-testid="panel-suggested-picks">
      <div className="border-b border-border px-4 py-4">
        <div className="flex items-center justify-between">
          <div>
            <span className="mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
              Draft intelligence
            </span>
            <h2 className="mt-1 text-sm font-bold">Suggested picks</h2>
          </div>
          <Sparkles size={16} className="text-primary" />
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">
          Need, price, scarcity and timing, argued per player.
        </p>
      </div>
      <div className="p-2">
        {!suggestions || suggestions.length === 0 ? (
          <div className="p-5 text-center">
            <p className="text-[11px] font-semibold">Nothing to suggest yet</p>
            <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
              Suggestions appear while your roster has open spots and picks remaining.
            </p>
          </div>
        ) : (
          suggestions
            .slice(0, 5)
            .map((suggestion, index) => (
              <SuggestionCard
                key={suggestion.playerId}
                suggestion={suggestion}
                rank={index + 1}
                onInspect={onInspect}
              />
            ))
        )}
      </div>
    </section>
  );
}
