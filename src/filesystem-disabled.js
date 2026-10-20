// Bundled mail dependencies cannot open, create or delete operating-system files.
function denied() {
  const error = new Error("Direct filesystem access is disabled in Kindle Mail");
  error.code = "EFILEACCESS";
  throw error;
}
module.exports = Object.freeze({ createReadStream: denied, createWriteStream: denied, unlink: denied });
