import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface AssistantTable {
  title: string;
  columns: string[];
  rows: Array<Array<string | number | null>>;
}

export interface AssistantTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantAnswer {
  answer: string;
  tables: AssistantTable[];
  tools: string[];
  suggestions: string[];
}

interface AskInput {
  question: string;
  history?: AssistantTurn[];
}

function validateAsk(input: unknown): AskInput {
  const obj = (input ?? {}) as Record<string, unknown>;
  const question = typeof obj["question"] === "string" ? obj["question"].trim() : "";
  if (!question) throw new Error("السؤال فارغ");
  if (question.length > 1000) throw new Error("السؤال طويل جداً");
  const rawHistory = Array.isArray(obj["history"]) ? obj["history"] : [];
  const history: AssistantTurn[] = rawHistory
    .slice(-8)
    .map((t) => t as Record<string, unknown>)
    .filter((t) => (t["role"] === "user" || t["role"] === "assistant") && typeof t["content"] === "string")
    .map((t) => ({ role: t["role"] as "user" | "assistant", content: String(t["content"]).slice(0, 2000) }));
  return { question, history };
}

export const askAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(validateAsk)
  .handler(async ({ data, context }): Promise<AssistantAnswer> => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("خدمة الذكاء الاصطناعي غير مهيأة (LOVABLE_API_KEY مفقود).");

    const { ASSISTANT_TOOLS, runAssistantTool } = await import("./assistant/tools.server");

    const today = new Date().toISOString().slice(0, 10);
    const system = `أنت «ميزان الذكي»، مساعد تحليلي لمنصة إدارة مياه يمنية. تجيب بالعربية الفصحى المبسطة وبإيجاز مهني.

التاريخ اليوم: ${today}. العملة: الريال اليمني. وحدة الاستهلاك: متر مكعب (م³).

قواعد إلزامية:
1. لا تخترع أرقاماً أبداً. كل رقم في إجابتك يجب أن يأتي من نتيجة أداة استدعيتها في هذه المحادثة.
2. للأسئلة عن مشترك محدد: استدعِ search_customers أولاً للحصول على UUID الحقيقي، ثم استخدم الأدوات الأخرى بذلك المعرّف.
3. إذا لم يُعثر على مشترك مطابق (found=false) فاذكر ذلك صراحةً واطلب توضيحاً. يُمنع منعاً باتاً عرض بيانات أي مشترك آخر أو التخمين.
4. إذا أعادت search_customers أكثر من مطابقة، اعرض قائمة المطابقات واطلب من المستخدم تحديد المقصود قبل عرض التفاصيل المالية.
5. مصدر الحقيقة للرصيد المستحق هو customer_balances (حقل current_balance في نتائج الأدوات)، وللمدفوعات جدول payments المعتمدة (status=approved)، وللفواتير water_bills.
6. الأسئلة الجماعية أو الترتيبية استخدم لها list_customers أو rank_customers أو get_summary_stats مع مدى زمني مناسب.
7. افهم المرادفات العربية: (المشترك/العميل/الزبون)، (العداد/القياس/الرقم التسلسلي)، (فاتورة/مطالبة)، (دفعة/سداد/تحصيل/توريد)، (متأخرات/ديون/مستحقات/عليه كم)، (استهلاك/صرف/كمية المياه)، (كشف حساب/بيان حساب)، (اليوم/أمس/هذا الأسبوع/هذا الشهر/الشهر الماضي/هذه السنة) وحوّلها إلى تواريخ فعلية بصيغة YYYY-MM-DD.
8. للأسئلة المركبة قسّمها إلى عدة استدعاءات أدوات ثم اجمع النتائج في إجابة واحدة.
9. اكتب الإجابة كنص واضح مع نقاط عند الحاجة؛ لا تكرر الجداول التفصيلية لأنها تُعرض تلقائياً للمستخدم.
10. اختم دائماً بسطر أخير بالصيغة: [اقتراحات] سؤال1 | سؤال2 | سؤال3 — تحتوي ثلاثة أسئلة متابعة قصيرة ومناسبة للسياق.`;

    interface ChatMessage {
      role: "system" | "user" | "assistant" | "tool";
      content: string | null;
      tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
      tool_call_id?: string;
    }

    const messages: ChatMessage[] = [
      { role: "system", content: system },
      ...(data.history ?? []).map((t) => ({ role: t.role, content: t.content })),
      { role: "user", content: data.question },
    ];

    const tables: AssistantTable[] = [];
    const usedTools: string[] = [];

    for (let step = 0; step < 5; step++) {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages,
          tools: ASSISTANT_TOOLS,
          temperature: 0.1,
        }),
      });

      if (res.status === 429) throw new Error("تم تجاوز حد الاستخدام مؤقتاً، أعد المحاولة بعد قليل.");
      if (res.status === 402) throw new Error("رصيد خدمة الذكاء الاصطناعي غير كافٍ.");
      if (!res.ok) {
        console.error("[assistant] gateway error", res.status, await res.text());
        throw new Error("تعذّر الوصول إلى محرك الذكاء الاصطناعي.");
      }

      const payload = (await res.json()) as {
        choices?: Array<{
          message?: {
            content?: string | null;
            tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
          };
        }>;
      };
      const msg = payload.choices?.[0]?.message;
      if (!msg) throw new Error("استجابة غير متوقعة من محرك الذكاء الاصطناعي.");

      const calls = msg.tool_calls ?? [];
      if (calls.length === 0) {
        const raw = (msg.content ?? "").trim();
        const suggestions: string[] = [];
        let answer = raw;
        const m = raw.match(/\[اقتراحات\]([^\n]*)$/m);
        if (m) {
          answer = raw.replace(m[0], "").trim();
          for (const s of (m[1] ?? "").split("|").map((x) => x.trim()).filter(Boolean).slice(0, 4)) {
            suggestions.push(s);
          }
        }
        return { answer: answer || "لم أتمكن من صياغة إجابة.", tables, tools: usedTools, suggestions };
      }

      messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: calls });

      for (const call of calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
        } catch {
          args = {};
        }
        usedTools.push(call.function.name);
        let result;
        try {
          result = await runAssistantTool(context.supabase, call.function.name, args);
        } catch (err) {
          console.error("[assistant] tool failed", call.function.name, err);
          result = { ok: false, data: { error: "تعذّر تنفيذ الاستعلام." } };
        }
        if (result.table && result.table.rows.length > 0) tables.push(result.table);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result.data).slice(0, 60000),
        });
      }
    }

    return {
      answer: "السؤال يتطلب خطوات كثيرة. جرّب صياغته بشكل أبسط أو قسّمه إلى سؤالين.",
      tables,
      tools: usedTools,
      suggestions: [],
    };
  });
