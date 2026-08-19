import { ShieldAlert } from "lucide-react";
import { useGetTeamLine } from "@workspace/api-client-react";
import { isUnavailableStatus } from "@workspace/shared";

const slotTone = (status: string | null) =>
  !status
    ? "text-muted-foreground"
    : isUnavailableStatus(status)
      ? "text-destructive"
      : "text-accent-foreground";

/**
 * The starting five from the team's ESPN depth chart, LT through RT, with the
 * swing man behind each spot, live injury designations, and the most recent
 * headline naming a lineman. Fetched from cache only — refresh to update.
 */
export function TeamLineFive({ team }: { team: string }) {
  const { data } = useGetTeamLine(team);
  const linemen = data?.linemen ?? [];
  const starters = linemen.filter((man) => man.rank === 1);
  const swing = linemen.filter((man) => man.rank === 2);
  const blurbs = linemen.filter((man) => man.headline || man.injuryStatus);

  if (linemen.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <span className="mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
          The five up front
        </span>
        <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
          No depth chart cached yet. Hit Refresh to pull ESPN's depth charts and see who is
          actually on this line.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4" data-testid={`line-five-${team}`}>
      <div className="flex items-center justify-between">
        <span className="mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
          The five up front · ESPN depth chart
        </span>
        {blurbs.some((man) => isUnavailableStatus(man.injuryStatus)) && (
          <ShieldAlert size={13} className="text-destructive" />
        )}
      </div>
      <div className="mt-3 grid grid-cols-5 gap-2">
        {starters.map((man) => {
          const backup = swing.find((candidate) => candidate.slot === man.slot);
          return (
            <div key={man.slot} className="rounded-lg bg-secondary/60 px-2 py-2 text-center">
              <span className="mono block text-[9px] text-muted-foreground">{man.slot}</span>
              <span
                className="mt-1 block truncate text-[10px] font-bold"
                title={`${man.name}${man.injuryStatus ? ` — ${man.injuryStatus}${man.injuryBodyPart ? ` (${man.injuryBodyPart})` : ""}` : ""}`}
              >
                {man.name.split(" ").slice(-1)[0]}
              </span>
              <span className={`mono block text-[8px] ${slotTone(man.injuryStatus)}`}>
                {man.injuryStatus ?? "no designation"}
              </span>
              {backup && (
                <span
                  className="mono mt-1 block truncate text-[8px] text-muted-foreground/70"
                  title={`Swing: ${backup.name}`}
                >
                  ↳ {backup.name.split(" ").slice(-1)[0]}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {blurbs.length > 0 && (
        <div className="mt-3 space-y-1.5 border-t border-border pt-3">
          {blurbs.slice(0, 3).map((man) => (
            <p key={`${man.slot}-${man.rank}`} className="text-[10px] leading-4">
              <span className={`font-bold ${slotTone(man.injuryStatus)}`}>
                {man.name} ({man.slot}
                {man.rank > 1 ? ` depth ${man.rank}` : ""})
              </span>
              {man.injuryStatus && (
                <span className="text-muted-foreground">
                  {" "}
                  — {man.injuryStatus}
                  {man.injuryBodyPart ? `, ${man.injuryBodyPart.toLowerCase()}` : ""}
                </span>
              )}
              {man.headline &&
                (man.headlineUrl ? (
                  <a
                    href={man.headlineUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-muted-foreground underline hover:text-foreground"
                  >
                    {" "}
                    "{man.headline}"
                  </a>
                ) : (
                  <span className="text-muted-foreground"> "{man.headline}"</span>
                ))}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
