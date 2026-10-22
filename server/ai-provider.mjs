// Provider URLs are fixed; neither users nor model tool arguments can select a network destination.
export async function completion(settings, system, messages, fetchImpl, signal, HttpError, toolDefinitions = [], { maxTokens = 3000, timeoutMessage } = {}) {
  const anthropic = settings.provider === "anthropic";
  const url = anthropic ? "https://api.anthropic.com/v1/messages" : "https://openrouter.ai/api/v1/chat/completions";
  const body = anthropic ? {
    model: settings.model, max_tokens: maxTokens, system, messages,
    tools: toolDefinitions.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters })),
  } : {
    model: settings.model, max_tokens: maxTokens, messages: [{ role: "system", content: system }, ...messages],
    tools: toolDefinitions.map(t => ({ type: "function", function: t })),
  };
  if (!toolDefinitions.length) delete body.tools;
  try {
    const response = await fetchImpl(url, {
      method: "POST", signal, redirect: "error",
      headers: { "Content-Type": "application/json", ...(anthropic
        ? { "x-api-key": settings.apiKey, "anthropic-version": "2023-06-01" }
        : { Authorization: `Bearer ${settings.apiKey}` }) },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new HttpError(response.status === 429 ? 429 : 502, response.status === 429
        ? "Nhà cung cấp AI đang giới hạn yêu cầu. Hãy thử lại sau ít phút."
        : "Không kết nối được mô hình AI. Quản trị viên cần kiểm tra khóa API, mã mô hình và số dư.");
    }
    let text = "";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 512_000) { await reader.cancel(); throw new Error("response too large"); }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
    const data = JSON.parse(text);
    if (anthropic) {
      if (!Array.isArray(data.content)) throw new Error("invalid content");
      const content = data.content.filter(p => p.type === "text").map(p => p.text).join("\n");
      const calls = data.content.filter(p => p.type === "tool_use").map(p => ({ id: p.id, name: p.name, args: p.input }));
      return { content, calls, replay: { role: "assistant", content: data.content } };
    }
    const message = data.choices?.[0]?.message;
    if (!message || (message.content != null && typeof message.content !== "string")) throw new Error("invalid message");
    const calls = (message.tool_calls || []).map(call => {
      let args;
      try { args = JSON.parse(call.function.arguments); } catch { args = null; }
      return { id: call.id, name: call.function?.name, args };
    });
    return { content: message.content || "", calls, replay: {
      role: "assistant", content: message.content || null,
      ...(calls.length ? { tool_calls: message.tool_calls } : {}),
      ...(message.reasoning_details ? { reasoning_details: message.reasoning_details } : {}),
    } };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (signal.aborted) throw new HttpError(504, timeoutMessage || "AI phản hồi quá lâu. Tin nhắn chưa được lưu; bạn có thể gửi lại.");
    throw new HttpError(502, "Không nhận được phản hồi hợp lệ từ AI. Vui lòng thử lại.");
  }
}
