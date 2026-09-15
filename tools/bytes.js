/* byte builders for the synthetic containers used in tools/test-logic.js */
function vintSize(n) {
  if (n < 128) return [0x80 | n];
  if (n < 16384) return [0x40 | (n >> 8), n & 0xff];
  if (n < 2097152) return [0x20 | (n >> 16), (n >> 8) & 0xff, n & 0xff];
  return [0x10 | (n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}
function bytes(str) { return Array.from(str).map(c => c.charCodeAt(0)); }
function eb(id, payload) {
  const idb = [];
  for (let i = 0; i < id.length; i += 2) idb.push(parseInt(id.substr(i, 2), 16));
  return idb.concat(vintSize(payload.length), payload);
}
function ebStr(id, s) { return eb(id, bytes(s)); }
function f64(v) {
  const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v, false);
  return Array.from(b);
}
function u(n, len) {
  const out = [];
  for (let i = len - 1; i >= 0; i--) out.push(Math.floor(n / Math.pow(256, i)) & 0xff);
  return out;
}
function ascii4(s) { return bytes((s + "    ").slice(0, 4)); }
/* one ISO-BMFF box */
function box(type, payload) {
  const body = payload || [];
  return u(8 + body.length, 4).concat(ascii4(type), body);
}
module.exports = { vintSize, eb, ebStr, f64, u, ascii4, box, bytes };
