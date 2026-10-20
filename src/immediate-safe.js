// JSZip needs a scheduler, never a string-to-code compatibility fallback.
if (typeof globalThis.setImmediate !== "function") {
  globalThis.setImmediate = function(callback, ...args) {
    if (typeof callback !== "function") throw new TypeError("A function callback is required");
    return setTimeout(callback, 0, ...args);
  };
  globalThis.clearImmediate = clearTimeout;
}
