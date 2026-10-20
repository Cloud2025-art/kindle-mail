const JSZip = require("jszip");
const MarkdownIt = require("markdown-it");
const crypto = require("crypto");
const clean = (s) => String(s).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/g, "");
const xml = (s) => clean(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
async function buildEpub({ title, author, markdown, resolve, read, root }) {
  const warnings = /* @__PURE__ */ new Set(), assets = [], ids = /* @__PURE__ */ new Map();
  let total = 0, noteReads = 0, markdownBytes = 0;
  const md = new MarkdownIt({ html: false, xhtmlOut: true, linkify: false, breaks: false });
  async function expand(text, source, chain = []) {
    noteReads += 1;
    markdownBytes += Buffer.byteLength(text, "utf8");
    if (noteReads > 100 || markdownBytes > 5 * 1024 * 1024) throw new Error("笔记展开过大：最多读取 100 篇笔记，合计 5 MiB Markdown");
    text = clean(text);
    text = text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
    const tokens = md.parse(text, {});
    async function walk(list) {
      for (const t of list) {
        if (t.type === "inline") {
          const children = [];
          for (const child of t.children || []) {
            if (child.type !== "text") {
              children.push(child);
              continue;
            }
            const re = /!\[\[([^\]]+)\]\]/g;
            let pos = 0, match;
            while (match = re.exec(child.content)) {
              if (match.index > pos) {
                const n = new child.constructor("text", "", 0);
                n.content = child.content.slice(pos, match.index);
                children.push(n);
              }
              const target = match[1].split("|")[0];
              const [path, fragment] = target.split("#");
              const file = resolve(path, source);
              if (file && file.extension === "md") {
                const n = new child.constructor("html_inline", "", 0);
                if (fragment || chain.includes(file.path) || chain.length >= 3) {
                  n.content = xml("[未展开嵌入：" + target + "]");
                  warnings.add("部分嵌入因循环、深度或章节定位限制未展开");
                } else n.content = (await expand(await read(file, false), file.path, [...chain, file.path])).replace(/<(\/?)(h[1-6]|p|ul|ol|li|pre|blockquote|table|thead|tbody|tr|td|th)(?: [^>]*)?>/g, (_, close) => close ? "</span>" : '<span style="display:block">');
                children.push(n);
              } else {
                const n = new child.constructor("image", "img", 0);
                n.attrs = [["src", path], ["alt", target]];
                n.content = target;
                n.children = [];
                children.push(n);
              }
              pos = re.lastIndex;
            }
            if (pos < child.content.length) {
              const n = new child.constructor("text", "", 0);
              n.content = child.content.slice(pos);
              children.push(n);
            }
          }
          t.children = children;
        }
        if (t.children) await walk(t.children);
        if (t.type === "image") {
          const target = t.attrGet("src");
          const file = !/^[a-z][a-z0-9+.-]*:/i.test(target) && resolve(target, source);
          if (!file || !["png", "jpg", "jpeg", "gif"].includes(file.extension.toLowerCase())) {
            warnings.add("远程图片及不支持的图片以文字代替");
            t.type = "text";
            t.tag = "";
            t.nesting = 0;
            t.content = "[图片：" + (t.content || target) + "]";
            t.children = null;
            continue;
          }
          if (!ids.has(file.path)) {
            if (assets.length >= 100) throw new Error("图片数量超过 100 张限制");
            const bytes = Buffer.from(await read(file, true));
            if (bytes.length > 10 * 1024 * 1024 || total + bytes.length > 20 * 1024 * 1024) throw new Error("图片总量过大：单张最多 10 MB，总计最多 20 MB");
            const ext = file.extension.toLowerCase();
            const valid = ext === "png" ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : ext === "gif" ? /^GIF8[79]a/.test(bytes.subarray(0, 6).toString()) : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
            if (!valid) throw new Error("图片内容与扩展名不符：" + file.name);
            const name = "images/" + assets.length + "." + ext;
            total += bytes.length;
            ids.set(file.path, name);
            assets.push({ name, bytes, type: ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/" + ext });
          }
          t.attrSet("src", ids.get(file.path));
        }
        if (t.type === "text") t.content = t.content.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => b || a);
      }
    }
    await walk(tokens);
    let html2 = md.renderer.render(tokens, md.options, {});
    return html2;
  }
  const html = await expand(markdown, root, [root]);
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  const uid = "urn:uuid:" + crypto.randomUUID();
  const document = '<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" lang="zh-CN"><head><title>' + xml(title) + '</title><link rel="stylesheet" href="style.css"/></head><body><h1>' + xml(title) + "</h1>" + html + "</body></html>";
  zip.file("EPUB/content.xhtml", document);
  zip.file("EPUB/nav.xhtml", '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><h1>目录</h1><ol><li><a href="content.xhtml">' + xml(title) + "</a></li></ol></nav></body></html>");
  zip.file("EPUB/style.css", "body{line-height:1.7;font-family:serif}h1,h2,h3{line-height:1.3}img{max-width:100%;height:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere}blockquote{border-left:2px solid #888;margin-left:0;padding-left:1em}table{border-collapse:collapse;width:100%}td,th{border:1px solid #aaa;padding:.3em}a{overflow-wrap:anywhere}");
  for (const a of assets) zip.file("EPUB/" + a.name, a.bytes);
  zip.file("EPUB/package.opf", '<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">' + uid + "</dc:identifier><dc:title>" + xml(title) + "</dc:title><dc:creator>" + xml(author || "Obsidian") + '</dc:creator><dc:language>zh-CN</dc:language><meta property="dcterms:modified">' + (/* @__PURE__ */ new Date()).toISOString().replace(/\.\d{3}Z$/, "Z") + '</meta></metadata><manifest><item id="content" href="content.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="style.css" media-type="text/css"/>' + assets.map((a, i) => '<item id="img' + i + '" href="' + a.name + '" media-type="' + a.type + '"/>').join("") + '</manifest><spine><itemref idref="content"/></spine></package>');
  return { buffer: await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }), warnings: [...warnings], images: assets.length };
}
module.exports = { buildEpub };
