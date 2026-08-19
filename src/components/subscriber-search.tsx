import { useMemo, useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Search, Droplets } from "lucide-react";
import { useStore, type Customer, type Meter } from "@/lib/store";

interface Props {
  value: number | null;
  onChange: (meterId: number) => void;
  placeholder?: string;
}

export function SubscriberSearch({ value, onChange, placeholder }: Props) {
  const { meters, customers } = useStore();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const activeMeters = useMemo(
    () => meters.filter((m) => m.status === "active"),
    [meters],
  );

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return activeMeters.slice(0, 8);
    const norm = (v: string) => v.toLowerCase().replace(/[-\s]/g, "");
    return activeMeters
      .map((m) => {
        const c = customers.find((x) => x.id === m.customer_id);
        return { meter: m, customer: c };
      })
      .filter(({ meter, customer }) => {
        if (!customer) return false;
        if (norm(meter.number).includes(norm(query))) return true;
        return customer.name.toLowerCase().includes(query);
      })
      .slice(0, 12)
      .map((r) => r.meter);
  }, [q, activeMeters, customers]);

  const selectedMeter = activeMeters.find((m) => m.id === value);
  const selectedCustomer = selectedMeter
    ? customers.find((c) => c.id === selectedMeter.customer_id)
    : null;

  function pick(m: Meter, c: Customer | undefined) {
    onChange(m.id);
    setQ(`${c?.name ?? ""} · ${m.number}`);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground pointer-events-none" />
        <Input
          className="ps-9"
          placeholder={placeholder ?? "ابحث بالاسم أو رقم العداد…"}
          value={q}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        />
      </div>
      {open && (
        <div className="absolute z-20 mt-1 left-0 right-0 bg-popover border rounded-lg shadow-lg max-h-72 overflow-auto">
          {results.length === 0 ? (
            <div className="p-3 text-xs text-muted-foreground text-center">لا نتائج</div>
          ) : (
            results.map((m) => {
              const c = customers.find((x) => x.id === m.customer_id);
              return (
                <button
                  key={m.id}
                  type="button"
                  className="w-full text-right p-2.5 hover:bg-accent flex items-center gap-2 border-b last:border-b-0"
                  onClick={() => pick(m, c)}
                >
                  <Droplets className="w-4 h-4 text-water shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{c?.name}</div>
                    <div className="text-[11px] text-muted-foreground font-mono">{m.number}</div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}
      {selectedMeter && selectedCustomer && !open && (
        <p className="text-[11px] text-muted-foreground mt-1">
          محدد: {selectedCustomer.name} — {selectedMeter.number}
        </p>
      )}
    </div>
  );
}
