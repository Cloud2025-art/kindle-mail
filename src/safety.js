const MiB = 1024 * 1024;
function safeVaultPath(path) {
  return typeof path === "string" && path.length > 0 && !/[\\<>:"|?*\x00-\x1f]/.test(path) &&
    path.split("/").every(part => part && part !== ".." && !part.startsWith("."));
}

// All reads go through the vault. Check fresh metadata before allocating file contents,
// then check actual bytes again in case a file changed between stat and read.
function createBoundedReader(vault) {
  let noteBytes = 0, imageBytes = 0, notes = 0, images = 0;
  return async (file, binary = false) => {
    if (!file || !safeVaultPath(file.path) || vault.getAbstractFileByPath(file.path) !== file) {
      throw new Error("拒绝读取仓库外、隐藏或无效的文件");
    }
    const extension = file.extension?.toLowerCase();
    if (binary ? !["png", "jpg", "jpeg", "gif"].includes(extension) : extension !== "md") {
      throw new Error("不支持读取此文件类型");
    }
    const used = binary ? imageBytes : noteBytes;
    const totalLimit = (binary ? 20 : 5) * MiB;
    const singleLimit = (binary ? 10 : 5) * MiB;
    if ((binary ? images : notes) >= 100) throw new Error("读取文件数量超过 100 个限制");
    const stat = await vault.adapter.stat(file.path);
    if (!stat || stat.type !== "file" || !Number.isSafeInteger(stat.size) || stat.size < 0) {
      throw new Error("无法确认文件大小，已停止读取");
    }
    if (stat.size > singleLimit || used + stat.size > totalLimit) {
      throw new Error(binary ? "图片过大：单张最多 10 MiB，总计最多 20 MiB" : "笔记过大：总计最多 5 MiB Markdown");
    }
    const content = binary ? await vault.readBinary(file) : await vault.read(file);
    const actual = binary ? content.byteLength : Buffer.byteLength(content, "utf8");
    if (!Number.isSafeInteger(actual) || actual > singleLimit || used + actual > totalLimit) {
      throw new Error("文件在读取时超过大小限制，已停止处理");
    }
    if (binary) { imageBytes += actual; images++; }
    else { noteBytes += actual; notes++; }
    return content;
  };
}
module.exports = { safeVaultPath, createBoundedReader };
