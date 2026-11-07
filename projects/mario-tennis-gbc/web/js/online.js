// ONLINE: two phones, one match. Both run the same game, from power-on, in step (lockstep): the game is deterministic, so the same start
// and the same buttons each frame give the same play on both, and only the buttons cross the network (one byte a player a frame).
//   host   HOST on the ONLINE panel: a room code to give the friend (full.html?online=host). Its buttons are the game's (the menus,
//          the near player); its save (the cartridge's battery RAM) and its rules are the session's.
//   guest  JOIN with the code (full.html?online=join&room=CODE). It plays the opponent in an exhibition match: the port's engine reads
//          its buttons for character 1 (input source 4, the far side's link seat: engine/chars.js, E.remote), elsewhere it watches.
// The connection: WebRTC between the two (PeerJS, js/vendor/peerjs.min.js, MIT), found through PeerJS's public broker by the room
// code (?peerhost=&peerport= another broker: the tests run one). The handshake: each side's version, game (ROM SHA-1); the host's settings
// and save; the input delay from the measured round trip; then both start at frame 0 together.
// Each frame F needs both sides' buttons for F; each side's buttons are taken DELAY frames ahead (for F + DELAY) and sent at once, so
// while the round trip is under DELAY frames nobody waits. The host's record also carries its CAMPUS PATHS state (the 3D view's paths,
// a game setting). Every 120 frames both send the picture's hash: a difference stops the session ("out of step").
// What can't be the same on both phones is off in an online session (full.js): the menu ball wheel, mods and created looks, Tour+'s
// extras, the partner commands, rematch, the analog stick, instant replay, turbo, and no save is written on either phone.
export const NET_VERSION = "0.36.26";                                  // both phones must run the same build (release.sh keeps it)
const PREFIX = "mtenn3d-", CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function onlineParams(q) {
  const role = q.get("online"); if (role !== "host" && role !== "join") return null;
  return { role: role === "host" ? "host" : "guest", room: (q.get("room") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8),
    public: role === "host" && q.get("public") === "1", name: (q.get("name") || "").slice(0, 12) };   // (public: listed in the lobby, lobby.js)
}
export const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), b => CODE_CHARS[b % CODE_CHARS.length]).join("");
const b64 = u8 => { let s = ""; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export function loadPeerJs() {
  if (window.Peer) return Promise.resolve(window.Peer);
  return new Promise((ok, fail) => { const s = document.createElement("script"); s.src = new URL("./vendor/peerjs.min.js", import.meta.url).href; s.onload = () => ok(window.Peer); s.onerror = () => fail(new Error("could not load the connection library")); document.head.appendChild(s); });
}

// the broker: PeerJS's public one, or ?peerhost=&peerport=&peerpath=&peersecure=1 another (the tests run one)
export const peerOptions = q => (q.get("peerhost") ? { host: q.get("peerhost"), port: +(q.get("peerport") || 9000), path: q.get("peerpath") || "/", secure: q.get("peersecure") === "1" } : {});

export class OnlineSession {
  // q: the page's URLSearchParams; romHash: this phone's game; ui: { status(text, kind) } (the chip over the game)
  constructor(params, q, { romHash, ui }) {
    Object.assign(this, params); this.q = q; this.romHash = romHash; this.ui = ui;
    if (this.role === "host" && !this.room) this.room = newCode();
    this.delay = 4; this.F = 0; this.local = new Map(); this.remote = new Map(); this.hashes = new Map();
    this.started = false; this.stopped = null; this.waitingSince = 0; this.rtt = 0; this.prevGuest = 0; this.conn = null;
    this.remotePad = { bits: 0 };                                       // full.js: port.remote (E.remote)
  }
  get isHost() { return this.role === "host"; }
  // ---- the connection ----
  async open() {
    const Peer = await loadPeerJs(), q = this.q, opts = peerOptions(q);
    this.ui.status(this.isHost ? (this.public ? `ONLINE · your game is in the lobby (code ${this.room}) · waiting for someone to join…` : `ONLINE · your code: ${this.room} · waiting for your friend to join…`) : `ONLINE · joining ${this.room}…`, "wait");
    const peer = this.peer = new Peer(this.isHost ? PREFIX + this.room : undefined, { ...opts, debug: 0 });
    const conn = await new Promise((ok, fail) => {
      peer.on("error", e => fail(new Error(e.type === "unavailable-id" ? "that code is in use: host again for a new one" : e.type === "peer-unavailable" ? "no game with that code (check it, or ask your friend to host again)" : (e.message || e.type))));
      if (this.isHost) { peer.on("open", () => this.onListening && this.onListening()); peer.on("connection", c => { if (this.conn) { c.close(); return; } c.on("open", () => ok(c)); }); }   // (onListening: full.js lists a public game then)
      else peer.on("open", () => { const c = peer.connect(PREFIX + this.room, { reliable: true, serialization: "json" }); c.on("open", () => ok(c)); });
    });
    this.conn = conn; this.inbox = []; this.waiters = [];
    const lag = +(q.get("netlag") || 0);                                 // (tests: ?netlag=MS, each message held that long, a slow connection)
    conn.on("data", m => { if (lag) setTimeout(() => this.receive(m), lag); else this.receive(m); });
    conn.on("close", () => this.stop("your friend left the game"));
    conn.on("error", e => { console.warn("online", e); this.stop("the connection was lost"); });
    return this;
  }
  send(m) { try { this.conn.send(m); } catch (e) { console.warn("online send", e); this.stop("the connection was lost"); } }
  next(type) {                                                          // the next message of a kind (the handshake)
    const i = this.inbox.findIndex(m => m.t === type); if (i >= 0) return Promise.resolve(this.inbox.splice(i, 1)[0]);
    return new Promise(ok => this.waiters.push({ type, ok }));
  }
  receive(m) {
    if (!m || typeof m !== "object") return;
    if (m.t === "i") { this.remote.set(m.f, m.r); return; }            // a frame's buttons
    if (m.t === "h") { this.checkHash(m.f, m.h, false); return; }
    if (m.t === "ping") { this.send({ t: "pong", at: m.at }); return; }
    if (m.t === "bye") { this.stop(m.why || "your friend left the game"); return; }
    const w = this.waiters.findIndex(x => x.type === m.t); if (w >= 0) { this.waiters.splice(w, 1)[0].ok(m); return; }
    this.inbox.push(m);
  }
  async measure() {                                                     // the round trip, the median of 6
    const times = [];
    for (let i = 0; i < 6; i++) { const at = performance.now(); this.send({ t: "ping", at }); const r = await this.next("pong"); times.push(performance.now() - r.at); }
    times.sort((a, b) => a - b); return times[3];
  }
  // ---- the handshake: host -> { setup }, guest -> { ready }, host -> { go } ----
  // host: settings() gives its settings and save, once the guest is there. Returns { settings, sram } (the guest: the host's)
  async handshake(settings) {
    this.send({ t: "hello", v: NET_VERSION, rom: this.romHash, role: this.role, name: this.name || onlineName() });
    const hello = await this.next("hello"); this.peerName = String(hello.name || "your friend").slice(0, 12);
    if (hello.v !== NET_VERSION) throw new Error(`your friend has version ${hello.v}, you have ${NET_VERSION}: update both apps`);
    if (hello.rom !== this.romHash) throw new Error("your friend's game file is a different one (both need Mario Tennis USA)");
    if (this.isHost) {
      this.ui.status("ONLINE · your friend is here · measuring the connection…", "wait");
      this.rtt = await this.measure();
      this.delay = Math.max(2, Math.min(15, Math.ceil(this.rtt / 2 / 16.74) + 2));
      const s = settings();
      const save = b64(s.sram), N = 12000, parts = Math.ceil(save.length / N);   // (the save in pieces: a JSON message is at most 16 KB)
      for (let i = 0; i < parts; i++) this.send({ t: "save", i, d: save.slice(i * N, (i + 1) * N) });
      this.send({ t: "setup", delay: this.delay, rtt: this.rtt, settings: s.settings, parts });
      await this.next("ready");
      this.send({ t: "go" });
      return s;
    }
    this.ui.status("ONLINE · connected · getting the game ready…", "wait");
    const setup = await this.next("setup"), pieces = [];
    for (let i = 0; i < setup.parts; i++) { const p = await this.next("save"); pieces[p.i] = p.d; }
    this.delay = setup.delay; this.rtt = setup.rtt;
    this.send({ t: "ready" });
    await this.next("go");
    return { settings: setup.settings, sram: unb64(pieces.join("")) };
  }
  begin() {
    for (let f = 0; f < this.delay; f++) { this.local.set(f, this.isHost ? [0, 0] : 0); this.remote.set(f, this.isHost ? 0 : [0, 0]); }
    this.started = true; this.waitingSince = 0;
    this.ui.status(`ONLINE · vs ${this.peerName} · ${this.isHost ? "you host" : "you play the opponent in exhibition matches"} · ping ${Math.round(this.rtt)} ms`, "ok");
  }
  // ---- the frames ----
  canStep() { return this.started && !this.stopped && this.remote.has(this.F); }
  // stalled: no frame for a while (the chip says so)
  stalled(now) {
    if (this.canStep() || !this.started || this.stopped) { if (this.waitingSince) { this.waitingSince = 0; this.ui.status(`ONLINE · ping ${Math.round(this.rtt)} ms`, "ok"); } return; }
    if (!this.waitingSince) this.waitingSince = now;
    else if (now - this.waitingSince > 600) this.ui.status("ONLINE · waiting for your friend's phone…", "wait");
  }
  // this frame's buttons for both: local = this phone's (host: [mask, paths], guest: mask) for frame F + delay; returns
  // { host: mask, paths, guestBits } for frame F (the frame about to run)
  step(local) {
    const F = this.F, ahead = F + this.delay;
    this.local.set(ahead, local); this.send({ t: "i", f: ahead, r: local });
    const mine = this.local.get(F), theirs = this.remote.get(F);
    const host = this.isHost ? mine : theirs, guest = this.isHost ? theirs : mine;
    this.local.delete(F); this.remote.delete(F); this.F = F + 1;
    // the friend's buttons as the game's character input: the d-pad held | A / B newly pressed (as ReadCharPadInput 08:7855)
    const g = guest & 0xFF, bits = (g & 0xF0) | (g & ~this.prevGuest & 0x03); this.prevGuest = g;
    this.remotePad.bits = bits;
    return { host: host[0] & 0xFF, paths: !!host[1] };
  }
  // after frame F ran: every 120 frames the picture's hash goes over, and is compared with the friend's
  afterFrame(hash) { const f = this.F; if (f % 120 === 0) { this.send({ t: "h", f, h: hash }); this.checkHash(f, hash, true); } }
  checkHash(f, h, mine) {
    const k = this.hashes.get(f) || {}; k[mine ? "me" : "them"] = h; this.hashes.set(f, k);
    if (k.me && k.them) { this.hashes.delete(f); if (k.me !== k.them) this.stop(`the two games went out of step (frame ${f}): leave and start again`); }
  }
  stop(why) {
    if (this.stopped) return; this.stopped = why;
    this.ui.status(`ONLINE · ${why}`, "stop");
    try { if (this.conn && this.conn.open) this.conn.send({ t: "bye", why: "your friend left the game" }); } catch (e) { /* closed */ }
  }
  leave() { this.stop("you left"); try { this.conn && this.conn.close(); this.peer && this.peer.destroy(); } catch (e) { /* closed */ } }
}

// the chip over the game: the session's state, and LEAVE
export function onlineChip(onLeave) {
  const el = document.createElement("div"); el.id = "onlinechip";
  el.style.cssText = "position:fixed;left:50%;top:max(8px,env(safe-area-inset-top));transform:translateX(-50%);z-index:40;display:flex;gap:10px;align-items:center;padding:6px 8px 6px 14px;border-radius:18px;background:rgba(14,18,34,.88);color:#fff;font:600 13px Itim,system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.4);max-width:92vw";
  const text = document.createElement("span"), btn = document.createElement("button");
  btn.textContent = "LEAVE"; btn.style.cssText = "border:0;border-radius:12px;padding:5px 10px;background:#c8202c;color:#fff;font:700 12px system-ui,sans-serif";
  btn.addEventListener("pointerdown", e => { e.stopPropagation(); onLeave(); });
  el.append(text, btn); document.body.appendChild(el);
  let fade = 0;
  return { status(t, kind) { text.textContent = t; el.style.opacity = "1"; el.style.borderLeft = `4px solid ${kind === "ok" ? "#3ccf6a" : kind === "stop" ? "#ff5a5a" : "#ffcf3a"}`; clearTimeout(fade); if (kind === "ok") fade = setTimeout(() => { el.style.opacity = ".55"; }, 4000); }, el };
}

// the ONLINE panel (the button bar's ONLINE): your name, the lobby's OPEN GAMES (tap one to join it), HOST A PUBLIC GAME (it appears there for
// everyone), HOST WITH A CODE (only whoever you give the code to), or JOIN with a friend's code. q: the page's URLSearchParams (a test's broker)
export const NAME_KEY = "mt-online-name";
export function onlineName() {
  try { const n = localStorage.getItem(NAME_KEY); if (n) return n; } catch (e) { /* private mode */ }
  return "Player " + (10 + Math.floor(Math.random() * 90));
}
export function onlinePanel(q = new URLSearchParams(location.search)) {
  const d = document.createElement("div"); d.id = "onlinepanel";
  d.style.cssText = "position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:rgba(5,8,18,.72)";
  const B = (bg, fg) => `border:0;border-radius:12px;background:${bg};color:${fg};font:700 15px system-ui,sans-serif`;
  d.innerHTML = `<div style="width:min(460px,94vw);max-height:92dvh;overflow:auto;box-sizing:border-box;padding:16px 18px;border-radius:18px;background:#141a33;border:3px solid #ffcf3a;color:#f0f2fa;font:15px Itim,system-ui,sans-serif">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><div style="font:700 21px system-ui,sans-serif;color:#ffcf3a;flex:1">PLAY ONLINE</div>
      <label style="opacity:.8">Your name <input data-a="name" maxlength="12" style="width:8.5em;padding:6px 8px;border-radius:9px;border:2px solid #555c80;background:#0d1124;color:#fff;font:700 14px system-ui,sans-serif"></label></div>
    <div style="display:flex;align-items:baseline;gap:8px"><b style="color:#ffcf3a">OPEN GAMES</b><small data-a="lstat" style="opacity:.7">connecting to the lobby…</small></div>
    <div data-a="rooms" style="margin:6px 0 12px;display:flex;flex-direction:column;gap:6px;min-height:52px"></div>
    <div style="display:flex;gap:8px;margin-bottom:8px"><button data-a="public" style="flex:1;padding:11px;${B("#ffcf3a", "#141a33")}">HOST A PUBLIC GAME</button>
      <button data-a="host" style="flex:1;padding:11px;${B("#2c3456", "#fff")}">HOST WITH A CODE</button></div>
    <div style="display:flex;gap:8px"><input data-a="code" maxlength="8" placeholder="FRIEND'S CODE" autocapitalize="characters" style="flex:1;min-width:0;padding:10px;border-radius:12px;border:2px solid #555c80;background:#0d1124;color:#fff;font:700 16px system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase">
      <button data-a="join" style="padding:10px 16px;${B("#3c82eb", "#fff")}">JOIN</button></div>
    <div style="opacity:.75;font-size:13px;margin-top:10px">The host picks EXHIBITION and a match against the computer: the player who joins plays that opponent.</div>
    <button data-a="close" style="margin-top:10px;width:100%;padding:8px;border:1px solid #555c80;border-radius:12px;background:transparent;color:#ccd;font:15px system-ui,sans-serif">CLOSE</button></div>`;
  const $ = a => d.querySelector(`[data-a="${a}"]`), nameEl = $("name");
  nameEl.value = onlineName();
  const name = () => { const n = nameEl.value.trim().slice(0, 12) || "Player"; try { localStorage.setItem(NAME_KEY, n); } catch (e) { /* private mode */ } return n; };
  let lobby = null;
  const go = (role, room, extra = {}) => {
    const u = new URL(location.href); u.searchParams.set("online", role);
    if (room) u.searchParams.set("room", room); else u.searchParams.delete("room");
    for (const [k, v] of Object.entries({ name: name(), ...extra })) u.searchParams.set(k, v);
    if (lobby) lobby.stop(); location.href = u.href;
  };
  const close = () => { if (lobby) lobby.stop(); d.remove(); };
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const show = (rooms, players) => {
    const box = $("rooms"); box.innerHTML = "";
    $("lstat").textContent = `${players} ${players === 1 ? "player" : "players"} in the lobby`;
    if (!rooms.length) { box.innerHTML = `<div style="opacity:.7;padding:10px 4px">No open games right now. Host a public game and it shows here for everyone.</div>`; return; }
    for (const r of rooms) {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:12px;background:#1d2547";
      row.innerHTML = `<div style="flex:1;min-width:0"><b>${esc(r.name)}</b><div style="opacity:.7;font-size:13px">${esc(r.rules || "exhibition")}</div></div><button style="padding:8px 14px;${B("#3ccf6a", "#0d1124")}">JOIN</button>`;
      row.querySelector("button").addEventListener("click", () => go("join", r.code));
      box.appendChild(row);
    }
  };
  show([], 1); $("lstat").textContent = "connecting to the lobby…";
  import("./lobby.js").then(({ Lobby }) => { if (!d.isConnected) return; lobby = new Lobby(q, { name: name(), onRooms: show, onStatus: t => { if (t !== "in the lobby") $("lstat").textContent = t; } }); window.__lobby = lobby; return lobby.start(); })
    .catch(e => { $("lstat").textContent = "the lobby is unreachable: " + e.message; });
  d.addEventListener("pointerdown", e => { if (e.target === d) close(); });
  $("public").addEventListener("click", () => go("host", null, { public: "1" }));
  $("host").addEventListener("click", () => go("host"));
  $("join").addEventListener("click", () => { const c = $("code").value.toUpperCase().replace(/[^A-Z0-9]/g, ""); if (c.length >= 4) go("join", c); });
  $("close").addEventListener("click", close);
  addEventListener("pagehide", () => { if (lobby) lobby.stop(); });
  document.body.appendChild(d);
  return d;
}
