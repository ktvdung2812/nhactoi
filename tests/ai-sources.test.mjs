import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import ExcelJS from "exceljs";
import { registerRemoteStorageRoutes } from "../server/remote-storage.mjs";
import { AI_SOURCE_LIMITS, sourceUrls, resolveAiSourceUrl, fetchPublicSource, extractAiFile, aiDocumentBlock, readAiAttachment, collectAiSources } from "../server/ai-sources.mjs";

const publicDns = async () => [{ address: "8.8.8.8", family: 4 }];
function requestStub(responses, calls) {
  return (url, options, callback) => {
    calls.push({ url, options });
    const request = new EventEmitter();
    request.end = () => queueMicrotask(() => {
      const response = responses.shift();
      assert.ok(response, "unexpected request");
      const stream = new PassThrough();
      stream.statusCode = response.status || 200;
      stream.headers = response.headers || { "content-type": "text/plain" };
      callback(stream);
      stream.end(response.body || "");
    });
    return request;
  };
}

function zip(files) {
  const local = [], central = []; let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const filename = Buffer.from(name), data = Buffer.from(content), crc = crc32(data);
    const head = Buffer.alloc(30), entry = Buffer.alloc(46);
    head.writeUInt32LE(0x04034b50); head.writeUInt16LE(20, 4); head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(data.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(filename.length, 26);
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(filename.length, 28); entry.writeUInt32LE(offset, 42);
    local.push(head, filename, data); central.push(entry, filename); offset += head.length + filename.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

test("AI source URLs deduplicate fragments; public resolution blocks private/mixed DNS, credentials and unexpected ports", async () => {
  assert.deepEqual(sourceUrls(["[tài liệu](https://example.com/a#part). https://example.com/a", "http://example.com/b!"]), ["https://example.com/a", "http://example.com/b"]);
  assert.deepEqual(sourceUrls(["[wiki](https://example.com/Article_(Topic))"]), ["https://example.com/Article_(Topic)"]);
  for (const url of ["http://127.0.0.1", "https://[::1]", "https://user:password@example.com", "https://example.com:444", "https://internal.local", "file:///etc/passwd"])
    await assert.rejects(resolveAiSourceUrl(url, publicDns), undefined, url);
  await assert.rejects(resolveAiSourceUrl("https://example.com", async () => [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }]));
  const resolved = await resolveAiSourceUrl("http://example.com/page#fragment", publicDns);
  assert.equal(resolved.url.href, "http://example.com/page");
});

test("AI URL reader pins validated DNS, sends no credentials, revalidates redirects and bounds response bytes", async () => {
  const calls = [];
  const result = await fetchPublicSource("https://example.com/a", { lookupImpl: publicDns, requestImpl: requestStub([
    { status: 302, headers: { location: "/b" } }, { body: "public document" },
  ], calls) });
  assert.equal(result.data.toString(), "public document"); assert.equal(calls.length, 2);
  assert.equal(calls[1].url.href, "https://example.com/b");
  for (const { options } of calls) {
    assert.equal(options.headers.Authorization, undefined); assert.equal(options.headers.Cookie, undefined);
    options.lookup("example.com", {}, (error, address, family) => { assert.equal(error, null); assert.equal(address, "8.8.8.8"); assert.equal(family, 4); });
  }
  const denied = [];
  await assert.rejects(fetchPublicSource("https://example.com/a", { lookupImpl: publicDns, requestImpl: requestStub([
    { status: 302, headers: { location: "http://169.254.169.254/credentials" } },
  ], denied) }));
  assert.equal(denied.length, 1);
  await assert.rejects(fetchPublicSource("https://example.com/a", { lookupImpl: publicDns, maxBytes: 4, requestImpl: requestStub([{ body: "long body" }], []) }));
});

test("AI extraction reads DOCX, XLSX saved formula results, CSV and Markdown without evaluating formulas", async () => {
  const docx = zip({
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml": '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Nội dung từ tài liệu</w:t></w:r></w:p></w:body></w:document>',
  });
  assert.match((await extractAiFile(docx, { title: "document.docx" })).text, /Nội dung từ tài liệu/u);
  const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("Kế hoạch");
  sheet.addRow(["Người", "Tổng"]); sheet.addRow(["An", { formula: "1+2", result: 3 }]);
  sheet.addRow(["Không thực thi", { formula: 'WEBSERVICE("http://127.0.0.1")' }]);
  const xlsx = await extractAiFile(Buffer.from(await workbook.xlsx.writeBuffer()), { title: "plan.xlsx" });
  assert.match(xlsx.text, /An\t3/u); assert.doesNotMatch(xlsx.text, /127\.0\.0\.1/u);
  assert.match(xlsx.text, /công thức chưa có kết quả/u);
  for (const title of ["notes.md", "table.csv", "notes.txt"]) assert.equal((await extractAiFile(Buffer.from("@vyvy dữ liệu\n=1+2"), { title })).text, "@vyvy dữ liệu\n=1+2");
  await assert.rejects(extractAiFile(Buffer.from("not office"), { title: "bad.docx" }));
  const expanded = Buffer.from(docx), directory = expanded.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  expanded.writeUInt32LE(100 * 1024 * 1024, directory + 24);
  await assert.rejects(extractAiFile(expanded, { title: "bomb.docx" }));
  const falseSize=Buffer.from(docx);
  falseSize.writeUInt32LE(1,directory+24);
  await assert.rejects(extractAiFile(falseSize,{title:'false-size.docx'}),/Kích thước/u);
});

test("AI attachments use private storage paths, reject traversal and symlinks, and enforce size limits", async t => {
  const root = await mkdtemp(join(tmpdir(), "nhactoi-ai-source-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "files")); await writeFile(join(root, "files", "document"), "stored content");
  const row = { storage_root: root, storage_key: "files/document", size_bytes: 14 };
  assert.equal((await readAiAttachment(null, row)).toString(), "stored content");
  await assert.rejects(readAiAttachment(null, row, { maxBytes: 4 }));
  await assert.rejects(readAiAttachment(null, { ...row, storage_key: "../outside" }));
  await symlink(join(root, "files", "document"), join(root, "files", "alias"));
  await assert.rejects(readAiAttachment(null, { ...row, storage_key: "files/alias" }));
});

test("PDF/scan and image blocks retain original bytes for multimodal models", () => {
  const pdf = Buffer.from("%PDF-1.7\nscanned-page-data");
  const document = aiDocumentBlock(pdf, { title: "scan.pdf" }, "anthropic");
  assert.equal(document.type, "document"); assert.equal(Buffer.from(document.source.data, "base64").toString(), pdf.toString());
  assert.equal(aiDocumentBlock(pdf, { title: "scan.pdf" }, "openrouter").type, "file");
  const image = Buffer.from("89504e470d0a1a0a", "hex");
  assert.equal(aiDocumentBlock(image, { title: "image.png" }, "anthropic").source.media_type, "image/png");
  assert.equal(aiDocumentBlock(image, { title: "image.png" }, "openrouter").type, "image_url");
  assert.throws(() => aiDocumentBlock(Buffer.from("bad"), { title: "image.png" }, "anthropic"));
});

test("AI attachment reader uses the existing S3/Drive adapters and bounds streamed remote bytes", async () => {
  const db = {}, profiles = [{ id: "s3", type: "s3" }, { id: "drive", type: "drive" }], calls = [];
  const app = { locals: {}, get() {}, post() {}, put() {} };
  registerRemoteStorageRoutes(app, { db, loadStoredSettings: () => new Map([["remoteStorage", JSON.stringify({ profiles })]]),
    adapter: profile => ({ get: async key => { calls.push([profile.type, key]); const stream = new PassThrough(); queueMicrotask(() => stream.end("remote document")); return stream; } }),
  });
  for (const type of ["s3", "drive"]) assert.equal((await readAiAttachment(db, { storage_root: `remote:${type}`, storage_key: "document" })).toString(), "remote document");
  assert.deepEqual(calls, [["s3", "document"], ["drive", "document"]]);
  await assert.rejects(readAiAttachment(db, { storage_root: "remote:s3", storage_key: "large" }, { maxBytes: 4 }));
});

test("source collector reads old text links, summarizes every text chunk and explicitly reports unread/unsupported/partial sources", async () => {
  const calls = [], summaries = [];
  const result = await collectAiSources({ taskId: "task_1", workspaceId: "ws_1", assertAccess() {}, provider: "anthropic",
    attachments: [
      { id: "notes", kind: "file", title: "notes.md" },
      { id: "scan", kind: "file", title: "scan.pdf" },
      { id: "missing", kind: "file", title: "missing.txt" },
    ], texts: ["old comment https://example.com/old"],
    readAttachment: async (_db, row) => { calls.push(row.id); if (row.id === "missing") throw new Error("SECRET_STORAGE_PATH"); return Buffer.from("x".repeat(25_000)); },
    summarize: async (text, source) => { summaries.push({ text, source }); return "Tóm tắt có tham chiếu"; },
    fetchUrl: async () => ({ mimeType: "text/html", data: Buffer.from("<article>" + "Nội dung cũ. ".repeat(30) + "</article><script>BAD_SCRIPT</script>") }),
  });
  assert.deepEqual(calls, ["notes", "missing"]); assert.equal(summaries.length, 3);
  assert.deepEqual(result.sources.map(source => source.status), ["summarized", "unsupported", "unread", "read"]);
  assert.match(result.text, /Nguồn attachment:notes/u); assert.match(result.text, /Nội dung cũ/u); assert.doesNotMatch(result.text, /BAD_SCRIPT/u);
  assert.doesNotMatch(JSON.stringify(result), /SECRET_STORAGE_PATH/u);
  const truncated = await collectAiSources({ taskId: "task_1", assertAccess() {}, attachments: [{ id: "long", kind: "file", title: "long.txt" }], readAttachment: async () => Buffer.from("x".repeat(AI_SOURCE_LIMITS.textChars + 1)) });
  assert.equal(truncated.sources[0].status, "partial"); assert.match(truncated.sources[0].detail, /không phải toàn bộ/u);
  const empty=await collectAiSources({taskId:'task_1',assertAccess(){},attachments:[{id:'empty',kind:'file',title:'empty.txt'}],readAttachment:async()=>Buffer.from('')});
  assert.equal(empty.sources[0].status,'unread');
});

test("source collector rechecks authorization after asynchronous reads and does not return revoked data", async () => {
  let revoked = false;
  await assert.rejects(collectAiSources({ taskId: "task_1", assertAccess() { if (revoked) throw new Error("access revoked"); },
    attachments: [{ id: "notes", kind: "file", title: "notes.txt" }], readAttachment: async () => { revoked = true; return Buffer.from("private data"); },
  }), /access revoked/u);
  await assert.rejects(collectAiSources({ attachments: [] }), /access validation/u);
});

test('linked public PDFs use the model document protocol and remain unread until the model succeeds',async()=>{
  const result=await collectAiSources({taskId:'t',attachments:[{id:'pdf-url',kind:'link',title:'Scan',url:'https://example.com/scan.pdf'}],
    assertAccess(){},provider:'anthropic',capabilities:{pdf:true},fetchUrl:async()=>({mimeType:'application/pdf',data:Buffer.from('%PDF-1.7 scan')})});
  assert.deepEqual(result.documentSourceIds,['attachment:pdf-url']);
  assert.equal(result.sources[0].status,'unread');assert.equal(result.contentBlocks[1].type,'document');
});

test('login pages and JavaScript shells are reported unread instead of pretending to read the page',async()=>{
  for(const html of ['<div id="root"></div><script src="app.js"></script>', '<form><input type="password"/>Đăng nhập '+ 'Nội dung bảo vệ '.repeat(20)+'</form>']) {
    const result=await collectAiSources({taskId:'t',attachments:[],texts:['https://example.com/private'],assertAccess(){},
      fetchUrl:async()=>({mimeType:'text/html',data:Buffer.from(html)})});
    assert.equal(result.sources[0].status,'unread');assert.equal(result.text,'');
  }
});
