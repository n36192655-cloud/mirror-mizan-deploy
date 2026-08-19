import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, User, Loader2 } from "lucide-react";
import { askAssistant, type AssistantTable, type AssistantTurn } from "@/lib/assistant.functions";
import { AssistantAnswerView } from "@/components/assistant-answer";
import { MizanAiIcon } from "@/components/mizan-ai-icon";
import { toast } from "sonner";

export const Route = createFileRoute("/assistant")({
  head: () => ({
    meta: [
      { title: "ميزان الذكي — مساعد تحليل بيانات المياه" },
      { name: "description", content: "مساعد ذكي يجيب بالعربية عن المشتركين والعدادات والفواتير والمدفوعات والمتأخرات والتحصيل من أحدث بيانات المنصة." },
      { property: "og:title", content: "ميزان الذكي — مساعد تحليل بيانات المياه" },
      { property: "og:description", content: "اسأل بالعربية الطبيعية عن أي مشترك أو مؤشر تشغيلي واحصل على إجابة مبنية على بيانات القاعدة مباشرة." },
    ],
  }),
  component: AssistantPage,
});

interface UserMsg { role: "user"; text: string }
interface AssistantMsg { role: "assistant"; text: string; tables: AssistantTable[] }
type Msg = UserMsg | AssistantMsg;

const DEFAULT_SUGGESTIONS = [
  "كشف حساب المشترك أحمد",
  "من عليه أكبر مديونية؟",
  "كم حصّلنا هذا الشهر؟",
  "أعلى ٥ مشتركين استهلاكاً هذا العام",
  "المشتركون الجدد هذا الشهر",
  "الفواتير غير المسددة",
];

const WELCOME =
  "أهلاً بك في «ميزان الذكي». اسألني بالعربية الطبيعية عن أي مشترك (بالاسم أو رقم الحساب أو الهاتف أو رقم العداد)، أو عن القراءات والفواتير والمدفوعات والمتأخرات والتحصيل والاستهلاك — وسأجيبك من أحدث بيانات القاعدة مباشرة.";

function AssistantPage() {
  const ask = useServerFn(askAssistant);
  const [messages, setMessages] = useState<Msg[]>([
    { role: "assistant", text: WELCOME, tables: [] },
  ]);
  const [suggestions, setSuggestions] = useState<string[]>(DEFAULT_SUGGESTIONS);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [messages, busy]);

  async function send(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    const history: AssistantTurn[] = messages
      .slice(1)
      .map((m) => ({ role: m.role, content: m.role === "user" ? m.text : m.text }));

    setMessages((m) => [...m, { role: "user", text: question }]);
    setInput("");
    setBusy(true);
    try {
      const res = await ask({ data: { question, history } });
      setMessages((m) => [...m, { role: "assistant", text: res.answer, tables: res.tables }]);
      setSuggestions(res.suggestions.length > 0 ? res.suggestions : DEFAULT_SUGGESTIONS);
    } catch (err) {
      const message = err instanceof Error ? err.message : "تعذّر تنفيذ الطلب";
      toast.error(message);
      setMessages((m) => [...m, { role: "assistant", text: `تعذّر تنفيذ الطلب: ${message}`, tables: [] }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
          <MizanAiIcon size={32} /> ميزان الذكي
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          مساعد ذكي يفهم العربية ويستعلم مباشرة من قاعدة البيانات ضمن صلاحياتك
        </p>
      </div>

      <Card className="flex flex-col h-[72vh]">
        <CardHeader className="border-b py-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <MizanAiIcon size={18} /> مستشار ميزان الرقمي
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto p-4 space-y-4" ref={boxRef}>
          {messages.map((m, i) => (
            <div key={i} className={`flex gap-2 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
              <div
                className={`w-8 h-8 rounded-full grid place-items-center shrink-0 ${
                  m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                }`}
              >
                {m.role === "user" ? <User className="w-4 h-4" /> : <MizanAiIcon size={20} />}
              </div>
              <div
                className={
                  m.role === "user"
                    ? "max-w-[90%] rounded-lg px-3 py-2 text-sm bg-primary text-primary-foreground"
                    : "flex-1 max-w-[90%]"
                }
              >
                {m.role === "user" ? m.text : <AssistantAnswerView answer={m.text} tables={m.tables} />}
              </div>
            </div>
          ))}
          {busy && (
            <div className="flex gap-2 items-center text-sm text-muted-foreground">
              <div className="w-8 h-8 rounded-full grid place-items-center bg-muted">
                <MizanAiIcon size={20} />
              </div>
              <Loader2 className="w-4 h-4 animate-spin" /> يحلل البيانات…
            </div>
          )}
        </CardContent>
        <div className="border-t p-3 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                disabled={busy}
                onClick={() => void send(s)}
                className="text-xs px-2.5 py-1 rounded-full border hover:bg-primary/10 hover:border-primary/40 transition-colors disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="اكتب سؤالك بالعربية…"
              disabled={busy}
            />
            <Button type="submit" size="icon" disabled={busy || !input.trim()}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </form>
        </div>
      </Card>
    </div>
  );
}
