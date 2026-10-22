import { assistantMentionCandidate } from "../shared/assistant-mentions.mjs";

const MENTION_TOKEN = /(^|\s)@([^\s@]*)$/;

export function foldMention(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/đ/gi, "d")
    .toLowerCase();
}

export function mentionToken(value, cursor) {
  const text = String(value ?? "");
  const end = Number.isInteger(cursor) ? Math.max(0, Math.min(cursor, text.length)) : text.length;
  const match = MENTION_TOKEN.exec(text.slice(0, end));
  if (!match) return null;
  const query = match[2];
  return { start: end - query.length - 1, query };
}

export function assistantMention(assistant) {
  if (!assistant?.enabled || !assistant.handle) return null;
  return { ...assistantMentionCandidate(assistant), email: `@${assistant.handle} · Trợ lý AI`, assistant: true };
}

export function filterMentionMembers(members, query) {
  const needle = foldMention(query);
  return (Array.isArray(members) ? members : []).filter((member) => {
    if (!member?.id || !member?.name) return false;
    if (!needle) return true;
    return foldMention(member.name).includes(needle) || foldMention(member.email).includes(needle) || foldMention(member.handle).includes(needle);
  });
}
