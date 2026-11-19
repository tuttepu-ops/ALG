export const GEMINI_MODEL = "gemini-3.1-flash-lite";

interface Part {
  text?: string;
  thought?: boolean;
  functionCall?: { name: string; args?: object; id?: string };
  functionResponse?: { name: string; response: object; id?: string };
}
type Content = { role: "user" | "model"; parts: Part[] };
interface AgentRequest {
  instructions: string;
  input: { role?: string; content?: string; type?: string; call_id?: string; output?: string }[];
  tools: { name: string; description: string; parameters: object }[];
}

/** A fresh adapter per caller turn. Retains raw model parts, including thought signatures, across tool rounds. */
export function geminiAgentRequest(fetcher = fetch) {
  const pending = new Map<string, NonNullable<Part["functionCall"]>>();
  const contents: Content[] = [];
  let cursor = 0;
  let sequence = 0;
  return async (body: unknown) => {
    const request = body as AgentRequest;
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("Gemini API key is missing.");
    const instructions = [request.instructions, ...request.input.filter(item => item.role === "developer").map(item => item.content)];
    if (!cursor) {
      for (const item of request.input) {
        if (typeof item.content !== "string" || !["user", "assistant"].includes(item.role ?? "")) continue;
        contents.push({ role: item.role === "assistant" ? "model" : "user", parts: [{ text: item.content }] });
      }
    } else {
      const parts: Part[] = [];
      for (const item of request.input.slice(cursor)) {
        if (item.type !== "function_call_output") continue;
        const call = pending.get(item.call_id ?? "");
        if (call) parts.push({
          functionResponse: { name: call.name, ...(call.id ? { id: call.id } : {}), response: { result: JSON.parse(item.output ?? "null") } },
        });
      }
      if (parts.length) contents.push({ role: "user", parts });
    }
    cursor = request.input.length;
    const response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      signal: AbortSignal.timeout(12000),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: instructions.filter(Boolean).join("\n\n") }] },
        contents,
        tools: [{ functionDeclarations: request.tools.map(({ name, description, parameters }) => ({ name, description, parametersJsonSchema: parameters })) }],
        generationConfig: { maxOutputTokens: 700, thinkingConfig: { thinkingLevel: "MINIMAL" } },
      }),
    });
    if (!response.ok) throw new Error(`Gemini request failed (HTTP ${response.status}).`);
    const bodyJson = await response.json() as {
      candidates?: { content?: { parts?: Part[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number };
    };
    const parts = bodyJson.candidates?.[0]?.content?.parts ?? [];
    if (parts.length) contents.push({ role: "model", parts });
    const output: unknown[] = [];
    for (const part of parts) {
      if (part.functionCall) {
        const callId = `gemini-${++sequence}`;
        pending.set(callId, part.functionCall);
        output.push({ type: "function_call", name: part.functionCall.name, call_id: callId, arguments: JSON.stringify(part.functionCall.args ?? {}) });
      } else if (part.text && !part.thought) {
        output.push({ type: "message", content: [{ type: "output_text", text: part.text }] });
      }
    }
    const usage = bodyJson.usageMetadata;
    return { output, usage: { input_tokens: usage?.promptTokenCount, output_tokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0), input_tokens_details: { cached_tokens: usage?.cachedContentTokenCount } } };
  };
}
