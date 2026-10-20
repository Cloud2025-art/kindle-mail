const { Plugin, PluginSettingTab, Setting, SecretComponent, Notice, Modal, TFile } = require("obsidian");
const { buildEpub } = require("./core");
const nodemailer = require("./smtp");
const { safeVaultPath, createBoundedReader } = require("./safety");
const defaults = { host: "smtp.qq.com", port: "465", user: "", from: "", to: "", author: "Obsidian", secret: "", folder: "Kindle Exports", includeEmbeddedNotes: false };
const email = (s) => /^[^\s<>@,;\r\n]+@[^\s<>@,;\r\n]+\.[^\s<>@,;\r\n]+$/.test(s);
class Confirm extends Modal {
  constructor(app, details) {
    super(app);
    this.details = details;
  }
  wait() {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.open();
    });
  }
  onOpen() {
    this.contentEl.createEl("h2", { text: "确认发送到 Kindle" });
    this.contentEl.style.maxHeight = "70vh";
    this.contentEl.style.overflowY = "auto";
    for (const line of this.details) this.contentEl.createEl("p", { text: line });
    new Setting(this.contentEl).addButton((b) => b.setButtonText("取消").onClick(() => this.close())).addButton((b) => b.setButtonText("发送").setCta().onClick(() => {
      this.resolve(true);
      this.close();
    }));
  }
  onClose() {
    this.resolve(false);
    this.contentEl.empty();
  }
}
module.exports = class KindleMail extends Plugin {
  async onload() {
    this.settings = Object.assign({}, defaults, await this.loadData());
    this.busy = false;
    this.addSettingTab(new Settings(this.app, this));
    for (const [id, name, send] of [["send", "发送当前笔记到 Kindle", true], ["export", "导出当前笔记为 EPUB", false]]) this.addCommand({ id, name, checkCallback: (checking) => {
      const f = this.app.workspace.getActiveFile();
      if (!f || f.extension !== "md") return false;
      if (!checking) this.run(f, send);
      return true;
    } });
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      if (file instanceof TFile && file.extension === "md") menu.addItem((i) => i.setTitle("发送到 Kindle").setIcon("send").onClick(() => this.run(file, true)));
    }));
  }
  async save() {
    await this.saveData(this.settings);
  }
  transport(s = this.settings) {
    if (!s.host.trim() || /[\s/:]/.test(s.host) || !["465", "587"].includes(s.port)) throw new Error("请设置 SMTP 主机及端口（465 或 587）");
    if (!email(s.from) || !s.user.trim()) throw new Error("请填写有效的发件邮箱和 SMTP 用户名");
    const pass = this.app.secretStorage.getSecret(s.secret);
    if (!pass) throw new Error("请在设置中选择 SMTP 授权码秘密");
    return nodemailer.createTransport({ host: s.host.trim(), port: Number(s.port), secure: s.port === "465", requireTLS: true, auth: { user: s.user, pass }, tls: { minVersion: "TLSv1.2", rejectUnauthorized: true }, connectionTimeout: 15e3, greetingTimeout: 15e3, socketTimeout: 6e4, disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false });
  }
  async run(file, send) {
    if (this.busy) {
      new Notice("正在处理上一项任务");
      return;
    }
    this.busy = true;
    let transport;
    let sending = false;
    try {
      const s = { ...this.settings };
      if (send && !email(s.to)) throw new Error("请先设置有效的 Kindle 收件邮箱");
      const folder = typeof s.folder === "string" ? s.folder.trim().replace(/\\/g, "/") : "";
      if (!send && !safeVaultPath(folder)) throw new Error("导出目录必须是仓库内的普通文件夹");
      new Notice("正在生成 EPUB…");
      const read = createBoundedReader(this.app.vault);
      const result = await buildEpub({ title: file.basename, author: s.author, root: file.path, markdown: await read(file, false), includeEmbeddedNotes: s.includeEmbeddedNotes === true, resolve: (target, source) => this.app.metadataCache.getFirstLinkpathDest(target, source), read });
      const filename = file.basename.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 100) + ".epub";
      if (!send) {
        let current = "";
        for (const part of folder.split("/")) {
          current = current ? current + "/" + part : part;
          if (!await this.app.vault.adapter.exists(current)) await this.app.vault.createFolder(current);
        }
        let path = folder + "/" + filename;
        if (await this.app.vault.adapter.exists(path)) path = folder + "/" + filename.slice(0, -5) + "-" + Date.now() + ".epub";
        const bytes = result.buffer;
        await this.app.vault.createBinary(path, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        new Notice("已导出：" + path, 1e4);
        if (result.warnings.length) new Notice(result.warnings.join("；"), 12e3);
        return;
      }
      if (result.buffer.length > 25 * 1024 * 1024) throw new Error("EPUB 超过本插件 25 MB 发送上限");
      if (!await new Confirm(this.app, ["文章：" + file.basename, "发件人：" + s.from, "收件人：" + s.to, "SMTP 服务器：" + s.host + ":" + s.port, "附件：" + (result.buffer.length / 1024 / 1024).toFixed(2) + " MB；图片 " + result.images + " 张", "以下笔记正文和图片将发送给上述邮件服务器及收件人，请逐项核对：", ...result.notes.map(p => "笔记：" + p), ...result.imagePaths.map(p => "图片：" + p), ...result.warnings, "仅在点击发送后上传。邮件服务器接收后，Kindle 仍需时间处理。"]).wait()) return;
      sending = true;
      transport = this.transport(s);
      const info = await transport.sendMail({ from: s.from, to: s.to, subject: file.basename.replace(/[\r\n]/g, " "), text: "Sent from Obsidian Kindle Mail.", attachments: [{ filename, content: result.buffer, contentType: "application/epub+zip" }] });
      if (!info.accepted?.length) throw new Error("邮件服务器未接受收件地址");
      new Notice("邮件服务器已接收，请稍后在 Kindle 中查看。", 12e3);
    } catch (e) {
      const code = typeof e?.code === "string" ? e.code.replace(/[^A-Z0-9_-]/g, "").slice(0, 40) : "";
      const message = code === "EAUTH" ? "邮箱认证失败，请检查 SMTP 用户名、授权码及邮箱的 SMTP 设置。" : code === "ETIMEDOUT" ? "连接超时；若发生在发送阶段，请先查看 Kindle，避免重复推送。" : code ? "处理失败（" + code + "），请检查网络和邮箱设置。" : sending ? "邮件发送失败，请检查邮箱设置；不要公开授权码或原始邮件服务器响应。" : e.message;
      new Notice(message, 15e3);
    } finally {
      transport?.close();
      this.busy = false;
    }
  }
};
class Settings extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const el = this.containerEl;
    el.empty();
    const p = this.plugin, s = p.settings;
    el.createEl("h2", { text: "Kindle Mail · 邮件推送" });
    el.createEl("p", { text: "请将发件邮箱加入 Amazon 认可的个人文档发件人列表。支持密码或授权码方式的 SMTP；需要 OAuth 的邮箱账号暂不支持。" });
    new Setting(el).setName("包含嵌入笔记正文").setDesc("默认关闭，避免意外发送其他笔记。开启后会递归包含嵌入笔记；发送前请核对完整文件清单。").addToggle(t => t.setValue(s.includeEmbeddedNotes === true).onChange(async value => {
      s.includeEmbeddedNotes = value;
      await p.save();
    }));
    new Setting(el).setName("邮箱快捷配置").addDropdown((d) => d.addOptions({ custom: "选择服务商", qq: "QQ 邮箱", netease: "163 邮箱", gmail: "Gmail" }).onChange(async (v) => {
      if (v === "custom") return;
      s.host = { qq: "smtp.qq.com", netease: "smtp.163.com", gmail: "smtp.gmail.com" }[v];
      s.port = "465";
      await p.save();
      this.display();
    }));
    for (const [key, label, desc] of [["host", "SMTP 主机", "例如 smtp.qq.com"], ["user", "SMTP 用户名", "通常为完整邮箱地址"], ["from", "发件邮箱", "必须在 Amazon 认可的发件人列表中"], ["to", "Kindle 收件邮箱", "填写你平时推送时使用的 Kindle 邮箱"], ["author", "电子书作者", "显示在电子书信息中"], ["folder", "EPUB 导出目录", "仓库内文件夹，例如 Kindle Exports"]]) new Setting(el).setName(label).setDesc(desc).addText((t) => t.setValue(s[key]).onChange(async (value) => {
      s[key] = value.trim();
      await p.save();
    }));
    new Setting(el).setName("SMTP 端口").addDropdown((d) => d.addOptions({ "465": "465 · TLS", "587": "587 · STARTTLS" }).setValue(s.port).onChange(async (v) => {
      s.port = v;
      await p.save();
    }));
    new Setting(el).setName("SMTP 授权码").setDesc("在秘密存储中创建或选择授权码；普通配置文件只保存秘密名称。").addComponent((node) => new SecretComponent(this.app, node).setValue(s.secret).onChange(async (v) => {
      s.secret = v;
      await p.save();
    }));
    new Setting(el).setName("测试邮箱连接").setDesc("验证连接和认证，不发送邮件。").addButton((b) => b.setButtonText("测试连接").onClick(async () => {
      let t;
      try {
        t = p.transport();
        await t.verify();
        new Notice("SMTP 连接与认证成功；实际投递仍需发送测试。");
      } catch (e) {
        new Notice("连接或认证失败，请检查网络、主机、用户名与授权码；请勿公开原始服务器响应。", 1e4);
      } finally {
        t?.close();
      }
    }));
    el.createEl("p", { text: "仅在手动发送时上传笔记和包含的本地图片，无开发者中转服务器。远程图片不下载。SVG、PDF、Canvas、动态插件内容暂不支持；章节嵌入暂以提示代替。" });
  }
}
