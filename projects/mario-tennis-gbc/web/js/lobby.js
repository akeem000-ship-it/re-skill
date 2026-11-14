// THE ONLINE LOBBY: the open games anyone can join (ONLINE > OPEN GAMES), as well as the friend codes. There is no server of the game's
// own, so the list is kept by one of the players: the first app to reach the lobby on PeerJS's broker takes the lobby's name
// (LOBBY_ID, one per build: only players who can play each other see each other) and keeps the list; every other app connects to it.
// When that app goes away the others notice the connection close and one of them takes the name over (whoever gets it first; the rest
// connect to it), and every host announces its game again, so the list carries on.
//   announce(room)   a public host's game { code, name, rules } while it waits for someone (again every 10 s: an entry not heard of
//                    for 30 s is dropped, and at once when its host's connection closes); withdraw() when the game starts or ends
//   onRooms(list, players)   the open games (newest first) and how many apps are in the lobby, whenever they change
// Messages (JSON): to the keeper { t: "hello", name } | { t: "announce", room } | { t: "withdraw" }; from it { t: "rooms", rooms, players }.
import { NET_VERSION, loadPeerJs, peerOptions } from "./online.js";

export const LOBBY_ID = () => "mtenn3d-lobby-" + NET_VERSION.replace(/\./g, "-");
const EXPIRE = 30000, REANNOUNCE = 10000;

export class Lobby {
  constructor(q, { name = "", onRooms = () => {}, onStatus = () => {} } = {}) {
    this.q = q; this.name = name; this.onRooms = onRooms; this.onStatus = onStatus;
    this.mine = null; this.closed = false; this.keeper = null; this.conn = null; this.peer = null; this.tries = 0;
  }
  async start() { await loadPeerJs(); this.join(); setInterval(() => this.tick(), 5000); return this; }
  // ---- finding the keeper, or becoming it ----
  join() {
    if (this.closed) return;
    this.onStatus("connecting to the lobby…");
    const Peer = window.Peer, opts = { ...peerOptions(this.q), debug: 0 };
    const peer = this.peer = new Peer(undefined, opts);
    peer.on("error", e => {
      if (e.type === "peer-unavailable") { peer.destroy(); this.becomeKeeper(); }           // nobody keeps the lobby: this app will
      else if (e.type !== "unavailable-id") { this.onStatus("the lobby is unreachable (" + (e.type || e.message) + "): retrying…"); peer.destroy(); this.retry(); }
    });
    peer.on("open", () => {
      const c = peer.connect(LOBBY_ID(), { reliable: true, serialization: "json" });
      c.on("open", () => { this.conn = c; this.tries = 0; this.onStatus("in the lobby"); c.send({ t: "hello", name: this.name }); if (this.mine) c.send({ t: "announce", room: this.mine }); });
      c.on("data", m => { if (m && m.t === "rooms") this.onRooms(m.rooms || [], m.players || 0); });
      c.on("close", () => { if (this.conn === c) { this.conn = null; peer.destroy(); this.retry(); } });
    });
  }
  becomeKeeper() {
    if (this.closed) return;
    const Peer = window.Peer, peer = this.peer = new Peer(LOBBY_ID(), { ...peerOptions(this.q), debug: 0 });
    peer.on("error", e => { peer.destroy(); if (e.type === "unavailable-id") this.retry(200); else { this.onStatus("the lobby is unreachable: retrying…"); this.retry(); } });   // (another app just took it)
    peer.on("open", () => {
      this.keeper = { rooms: new Map(), clients: new Set() }; this.tries = 0; this.onStatus("in the lobby");
      if (this.mine) this.keeper.rooms.set(this.mine.code, { room: this.mine, owner: null, at: Date.now() });
      this.publish();
      peer.on("connection", c => {
        c.on("open", () => { this.keeper.clients.add(c); this.publish(c); });
        c.on("data", m => this.keeperGot(c, m));
        c.on("close", () => { this.keeper.clients.delete(c); for (const [k, v] of this.keeper.rooms) if (v.owner === c) this.keeper.rooms.delete(k); this.publish(); });
      });
      peer.on("disconnected", () => { try { peer.reconnect(); } catch (e) { /* gone */ } });   // (the broker dropped us: keep the name)
    });
  }
  retry(ms) { if (this.closed) return; this.keeper = null; const wait = ms ?? Math.min(8000, 400 + 600 * this.tries++ + Math.random() * 800); setTimeout(() => this.join(), wait); }
  // ---- the keeper's side ----
  keeperGot(c, m) {
    if (!m || typeof m !== "object") return;
    const K = this.keeper; if (!K) return;
    if (m.t === "announce" && m.room && m.room.code) { K.rooms.set(String(m.room.code).slice(0, 8), { room: clean(m.room), owner: c, at: Date.now() }); this.publish(); }
    else if (m.t === "withdraw") { for (const [k, v] of K.rooms) if (v.owner === c) K.rooms.delete(k); this.publish(); }
    else if (m.t === "hello") this.publish(c);
  }
  list() { return [...this.keeper.rooms.values()].sort((a, b) => b.at - a.at).map(v => v.room); }
  publish(only) {
    const K = this.keeper; if (!K) return;
    const msg = { t: "rooms", rooms: this.list(), players: K.clients.size + 1 };
    for (const c of only ? [only] : K.clients) { try { c.send(msg); } catch (e) { /* closing */ } }
    if (!only) this.onRooms(msg.rooms, msg.players);
  }
  tick() {
    if (this.mine && Date.now() - (this.mineAt || 0) > REANNOUNCE) this.announce(this.mine);
    const K = this.keeper; if (!K) return;
    let changed = false; for (const [k, v] of K.rooms) if (v.owner && Date.now() - v.at > EXPIRE) { K.rooms.delete(k); changed = true; }
    if (changed) this.publish();
  }
  // ---- a host's game ----
  announce(room) {
    this.mine = clean(room); this.mineAt = Date.now();
    if (this.keeper) { this.keeper.rooms.set(this.mine.code, { room: this.mine, owner: null, at: Date.now() }); this.publish(); }
    else if (this.conn) this.conn.send({ t: "announce", room: this.mine });
  }
  withdraw() {
    if (!this.mine) return; const code = this.mine.code; this.mine = null;
    if (this.keeper) { this.keeper.rooms.delete(code); this.publish(); } else if (this.conn) this.conn.send({ t: "withdraw" });
  }
  stop() { this.closed = true; try { this.withdraw(); this.peer && this.peer.destroy(); } catch (e) { /* gone */ } }
}
// what a room may say (the keeper passes on only these, short)
const clean = r => ({ code: String(r.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8), name: String(r.name || "Player").slice(0, 16),
  rules: String(r.rules || "").slice(0, 40), at: +r.at || Date.now() });
