import test from "node:test";
import assert from "node:assert/strict";
import { filterMentionMembers, foldMention, mentionToken } from "../src/mention-query.js";

test("mention token starts at @ after a boundary and keeps the typed query", () => {
  assert.deepEqual(mentionToken("@", 1), { start: 0, query: "" });
  assert.deepEqual(mentionToken("Xin chào @Ng", 12), { start: 9, query: "Ng" });
  assert.equal(mentionToken("a@b", 3), null);
  assert.equal(mentionToken("xong @An rồi", 9), null);
  assert.deepEqual(mentionToken("dòng\n@minh", 10), { start: 5, query: "minh" });
});

test("member filter ignores accents and đ", () => {
  const members = [
    { id: "1", name: "Lê Dũng", email: "dung@nhactoi.local" },
    { id: "2", name: "Nguyễn An", email: "an@nhactoi.local" },
  ];
  assert.equal(foldMention("Đức"), "duc");
  assert.deepEqual(filterMentionMembers(members, "").map((member) => member.id), ["1", "2"]);
  assert.deepEqual(filterMentionMembers(members, "dung").map((member) => member.id), ["1"]);
  assert.deepEqual(filterMentionMembers(members, "AN@").map((member) => member.id), ["2"]);
  assert.deepEqual(filterMentionMembers(members, "zzz"), []);
});
