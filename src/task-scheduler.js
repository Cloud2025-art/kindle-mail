// Function-only scheduler for lie's Promise fallback. No DOM or code generation.
module.exports = function schedule(task) {
  if (typeof task !== "function") throw new TypeError("A function callback is required");
  if (typeof queueMicrotask === "function") queueMicrotask(task);
  else setTimeout(task, 0);
};
