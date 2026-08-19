import type { AssistantTable } from "@/lib/assistant.functions";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function fmtCell(v: string | number | null): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return new Intl.NumberFormat("ar-YE", { maximumFractionDigits: 2 }).format(v);
  return v;
}

function renderInline(line: string, key: number) {
  const parts = line.split(/(\*\*[^*]+\*\*)/g);
  return (
    <p key={key} className="text-sm leading-7">
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? (
          <strong key={i} className="font-semibold">{p.slice(2, -2)}</strong>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </p>
  );
}

export function AssistantAnswerView({
  answer,
  tables,
}: {
  answer: string;
  tables: AssistantTable[];
}) {
  const lines = answer.split("\n").filter((l) => l.trim() !== "");

  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-card px-3 py-2 space-y-1">
        {lines.map((line, i) => {
          const t = line.trim();
          if (/^[-•*]\s+/.test(t)) {
            return (
              <div key={i} className="flex gap-2 text-sm leading-7">
                <span className="text-primary">•</span>
                <span className="flex-1">{renderInline(t.replace(/^[-•*]\s+/, ""), i)}</span>
              </div>
            );
          }
          if (/^#{1,3}\s+/.test(t)) {
            return (
              <h3 key={i} className="text-sm font-bold mt-2">
                {t.replace(/^#{1,3}\s+/, "")}
              </h3>
            );
          }
          return renderInline(t, i);
        })}
      </div>

      {tables.map((tb, ti) => (
        <div key={ti} className="rounded-lg border overflow-hidden">
          <div className="px-3 py-2 bg-muted/60 text-xs font-semibold">{tb.title}</div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {tb.columns.map((c) => (
                    <TableHead key={c} className="text-xs whitespace-nowrap">{c}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {tb.rows.map((row, ri) => (
                  <TableRow key={ri}>
                    {row.map((cell, ci) => (
                      <TableCell key={ci} className="text-xs whitespace-nowrap">{fmtCell(cell)}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ))}
    </div>
  );
}
