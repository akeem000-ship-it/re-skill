// Text panels of the 3D layers (the replay's tag, the close-call review, the big moments' titles): drawn once with a canvas into a
// texture, laid over the view with the HUD's program. Hand-made, nothing from the game.
const cache = new Map();
export function label(sc, text, { size = 28, fg = "#fff", bg = "rgba(0,0,0,0.55)", stroke = "#000", pad = 10, font = "bold" } = {}) {
  const key = text + "|" + size + fg + bg;
  let L = cache.get(key);
  if (L && L.gl === sc.gl) return L;
  const cv = document.createElement("canvas"), g = cv.getContext("2d"), f = `${font} ${size}px system-ui, sans-serif`;
  g.font = f; const lines = text.split("\n"), w = Math.ceil(Math.max(...lines.map(l => g.measureText(l).width))) + pad * 2, h = lines.length * Math.round(size * 1.2) + pad * 2;
  cv.width = w; cv.height = h; g.font = f; g.textBaseline = "top";
  if (bg) { g.fillStyle = bg; const r = Math.min(12, h / 3); g.beginPath(); g.roundRect ? g.roundRect(0, 0, w, h, r) : g.rect(0, 0, w, h); g.fill(); }
  lines.forEach((l, i) => { const y = pad + i * Math.round(size * 1.2); if (stroke) { g.lineWidth = Math.max(2, size / 7); g.strokeStyle = stroke; g.strokeText(l, pad, y); } g.fillStyle = fg; g.fillText(l, pad, y); });
  const gl = sc.gl, tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  L = { tex, w, h, gl }; cache.set(key, L);
  if (cache.size > 60) { const k = cache.keys().next().value; sc.gl.deleteTexture(cache.get(k).tex); cache.delete(k); }
  return L;
}
// draw a label: (cx, cy) its centre as parts of the view (0..1 from the top left), hFrac its height as a part of the view's height
export function drawLabel(sc, text, cx, cy, hFrac, opts = {}, alpha = 1) {
  const L = label(sc, text, opts), gl = sc.gl, c = sc.canvas, p = sc.P.hud;
  const h = hFrac, w = h * (L.w / L.h) * (c.height / c.width);
  gl.useProgram(p.p); gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, L.tex); gl.uniform1i(p.u.uTex, 0);
  gl.uniform4fv(p.u.uRect, [cx - w / 2, cy - h / 2, w, h]); gl.uniform1f(p.u.uAlpha, alpha);
  gl.bindVertexArray(sc.emptyVao); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.enable(gl.DEPTH_TEST);
}
