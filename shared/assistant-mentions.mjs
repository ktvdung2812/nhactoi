export const DEFAULT_ASSISTANT = Object.freeze({ name: 'Vyvy', handle: 'vyvy', enabled: true });

// Handles are deliberately separate from member IDs. Emails, URLs and quoted
// code must not accidentally start a background action.
export function containsAssistantMention(body, handle = 'vyvy') {
  if (typeof body !== 'string' || !/^[a-z][a-z0-9_]{1,31}$/i.test(handle)) return false;
  const prose = body.replace(/```[\s\S]*?(?:```|$)/g, '').replace(/`[^`\n]*`/g, '')
    .split('\n').filter(line => !/^\s*>/.test(line)).join('\n');
  return new RegExp(`(^|[\\s(\\[{])@${handle}(?=$|[^\\p{L}\\p{N}_@.-])`, 'iu').test(prose);
}

export function assistantMentionCandidate(assistant) {
  return assistant ? { id: 'assistant', name: assistant.name, handle: assistant.handle, kind: 'assistant' } : null;
}
