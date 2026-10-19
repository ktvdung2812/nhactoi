const fallbackModels = {
  openrouter: ["anthropic/claude-sonnet-4", "anthropic/claude-opus-4", "google/gemini-2.5-flash", "google/gemini-2.5-pro", "openai/gpt-4.1-mini"],
  anthropic: ["claude-sonnet-4-20250514", "claude-opus-4-20250514", "claude-3-5-haiku-20241022"],
};

// The catalog is public on OpenRouter; Anthropic requires the server's saved key.
export function createAiModelCatalog(fetchImpl = fetch) {
  const cache = new Map();
  return function load(provider, apiKey = "") {
    const credential = provider === "anthropic" ? apiKey : "";
    const old = cache.get(provider);
    if (old && old.credential === credential && old.expires > Date.now()) return old.promise;
    const entry = { credential, expires: Date.now() + 300_000 };
    entry.promise = (async () => {
      try {
        if (provider === "anthropic" && !credential) throw new Error("missing key");
        const models = new Map();
        let after = "";
        const signal = AbortSignal.timeout(10_000);
        for (let page = 0; page < 10; page++) {
          const url = provider === "openrouter" ? "https://openrouter.ai/api/v1/models"
            : `https://api.anthropic.com/v1/models?limit=100${after ? `&after_id=${encodeURIComponent(after)}` : ""}`;
          const response = await fetchImpl(url, { signal, redirect: "error", headers: provider === "anthropic"
            ? { "x-api-key": credential, "anthropic-version": "2023-06-01" } : {} });
          if (!response.ok) { await response.body?.cancel(); throw new Error("catalog unavailable"); }
          const payload = await response.json();
          if (!Array.isArray(payload.data)) throw new Error("invalid catalog");
          for (const row of payload.data) {
            if (provider === "openrouter" && !row.supported_parameters?.includes("tools")) continue;
            if (typeof row.id !== "string" || row.id.length > 150 || !/^[a-zA-Z0-9][a-zA-Z0-9._:/@-]*$/.test(row.id)) continue;
            const name = row.display_name || row.name;
            const modalities = row.architecture?.input_modalities;
            models.set(row.id, { id: row.id, name: typeof name === "string" ? name.slice(0, 200) : row.id,
              images: provider === 'anthropic' ? true : Array.isArray(modalities) ? modalities.includes('image') : null,
              nativePdf: provider === 'anthropic' ? true : Array.isArray(modalities) ? modalities.includes('file') : null,
              contextLength: Number(row.context_length) || null,
            });
          }
          if (provider === "openrouter" || !payload.has_more) break;
          if (typeof payload.last_id !== "string" || !payload.last_id || payload.last_id === after || page === 9) throw new Error("incomplete catalog");
          after = payload.last_id;
        }
        if (!models.size) throw new Error("empty catalog");
        return { models: [...models.values()].sort((a, b) => a.name.localeCompare(b.name)), source: "live" };
      } catch {
        entry.expires = Date.now() + 60_000;
        return { models: fallbackModels[provider].map(id => ({ id, name: id })), source: "fallback" };
      }
    })();
    cache.set(provider, entry);
    return entry.promise;
  };
}
