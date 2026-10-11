const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function source(name) {
  const start = script.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const body = start + script.slice(start).match(/\)\s*\{/).index;
  let depth = 0;
  for (let i = script.indexOf('{', body); i < script.length; i++) {
    if (script[i] === '{') depth++;
    if (script[i] === '}' && --depth === 0) return script.slice(start, i + 1);
  }
  throw new Error(`Unclosed function: ${name}`);
}
class Vector {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { Object.assign(this, {x, y, z}); return this; }
  addScaledVector(v, t) { this.x += v.x * t; this.y += v.y * t; this.z += v.z * t; return this; }
  multiplyScalar(k) { this.x *= k; this.y *= k; this.z *= k; return this; }
  length() { return Math.hypot(this.x, this.y, this.z); }
}
const player = (team = 0, role = 'MF') => ({team, role, pos: new Vector(), vel: new Vector(), face: 0, phase: 0,
  stunT: 0, fooledT: 0, tackleT: 0, tackleCD: 0, pickupCD: 0, diveT: 0, evadeT: 0, st: {tk: 0}});
function context(names = []) {
  const nodes = new Map();
  const node = key => {
    if (!nodes.has(key)) nodes.set(key, {hidden: true, visible: false, style: {}, classList: {remove() {}, contains() {return false;}}});
    return nodes.get(key);
  };
  const p = player();
  const c = {Math: Object.create(Math), active: p, players: [p], state: 'play', paused: false, T: 1,
    HL: 30, HW: 20, GW: 3.6, GH: 2.4, BR: .21, RUN: 6.4, SPRINT: 8.6, CLOCK_RATE: 8, HALF_LEN: 1200,
    STAD: {rollK: .7, rollC: .9, bounce: .52, grip: 1}, wind: {x: 3, z: -4}, rushT: [0, 0],
    ball: {owner: p, pos: new Vector(0, .21, 0), vel: new Vector(), shot: 0, lastTouch: 0},
    keys: {}, btn: {}, stick: {id: null, x: 0, y: 0, dash: false}, mouse: {on: false, inside: false},
    passHold: 0, passing: false, passPlayer: null, charging: false, charge: 0, chargePlayer: null, chargeHadBall: false,
    defenseButtons: new Set(), defenseHold: 0, wall: null, restartGuard: null, kickoffGuard: false,
    SK: {hist: [], last: null}, meter: node('meter'), targetRing: node('target'), throughMark: node('through'),
    cursorRing: node('cursor'), knob: node('knob'), stickEl: node('stick'), cv: node('canvas'),
    $: node, document: {querySelectorAll: () => []}, FORMATIONS: {331: {holdPlan: () => null}}, myForm: '331',
    passingPlayer: () => c.passPlayer || c.active, shootingPlayer: () => c.chargePlayer || c.active,
    teamDir: t => t === 0 ? 1 : -1, dXZ: (a, b) => Math.hypot(a.x - b.x, a.z - b.z),
    clamp: (x, a, b) => Math.max(a, Math.min(b, x)), rnd: (a, b) => (a + b) / 2,
    sfx: {kick() {}, bounce() {}, ooh() {}, tackle() {}, whistle() {}}, addMom() {}, skillPop() {},
    frameCollide() {}, inputVec: () => ({x: 0, z: 0, m: 0}), switchPlayer() {}, setActive: p => {c.active = p;},
    firstTouch: () => false, ST: {passOk: [0, 0], poss: [0, 0], tackles: [0, 0]},
    userShoot: () => {c.shots = (c.shots || 0) + 1;}, userPass: () => {c.passes = (c.passes || 0) + 1;}};
  c.Math.random = () => .5;
  vm.createContext(c);
  for (const n of names) vm.runInContext(source(n), c);
  return c;
}
const controls = ['canAct', 'canKick', 'press', 'release', 'cancelHolds', 'updateActionHolds'];

test('inline JavaScript parses', () => new vm.Script(script));
test('stunned, tackling and fooled carriers cannot kick', () => {
  for (const state of ['stunT', 'tackleT', 'fooledT']) {
    const c = context(controls); c.active[state] = .5;
    c.press('shoot'); c.release('shoot'); c.press('pass'); c.release('pass');
    assert.equal(c.shots || 0, 0); assert.equal(c.passes || 0, 0);
  }
});
test('possession loss cancels charge, meter and pass without carrying them into a regain', () => {
  const c = context(controls); c.press('shoot'); c.updateActionHolds(.5); c.meter.hidden = false;
  c.ball.owner = null; c.updateActionHolds(0);
  assert.equal(c.charging, false); assert.equal(c.meter.hidden, true); assert.equal(c.charge, 0);
  c.ball.owner = c.active; c.release('shoot'); assert.equal(c.shots || 0, 0);
  c.press('pass'); c.updateActionHolds(.3); c.ball.owner = player(1); c.updateActionHolds(0);
  c.ball.owner = c.active; c.release('pass'); assert.equal(c.passes || 0, 0);
});
test('release during stun and switching away from the charged player cannot shoot another carrier', () => {
  const c = context(controls); c.press('shoot'); c.active.stunT = .5; c.release('shoot');
  assert.equal(c.shots || 0, 0);
  c.active.stunT = 0; c.press('shoot'); c.active = player(); c.ball.owner = c.active;
  c.updateActionHolds(0); c.release('shoot'); assert.equal(c.shots || 0, 0);
});
test('shoot pressed before a reception remains available; charge follows simulation time', () => {
  for (const fps of [20, 30, 60, 120]) {
    const c = context(controls); c.ball.owner = null; c.press('shoot'); c.updateActionHolds(.2);
    assert.equal(c.charging, true); assert.equal(c.charge, 0);
    c.ball.owner = c.active;
    for (let i = 0; i < fps / 2; i++) c.updateActionHolds(1 / fps);
    assert.ok(Math.abs(c.charge - .5 / .85) < 1e-9); c.release('shoot'); assert.equal(c.shots, 1);
  }
});
test('GK pass and shot input still act on the keeper', () => {
  const c = context(controls); const gk = player(0, 'GK'); c.ball.owner = gk;
  c.press('pass'); c.updateActionHolds(.1); c.release('pass'); assert.equal(c.passes, 1);
  c.press('shoot'); c.updateActionHolds(.2); assert.equal(c.shootingPlayer(), gk);
  c.release('shoot'); assert.equal(c.shots, 1);
});
test('focus loss clears keyboard, touch, buttons and gesture history', () => {
  const c = context([...controls, 'resetInput']); c.keys.KeyW = true; c.btn.sprint = true;
  Object.assign(c.stick, {id: 2, x: 1, y: 1, dash: true}); c.mouse.on = true;
  c.SK.hist.push({da: 1}); c.SK.last = 2; c.press('shoot'); c.resetInput();
  assert.equal(c.keys.KeyW, false); assert.equal(c.btn.sprint, false); assert.equal(c.stick.id, null);
  assert.equal(c.stick.x, 0); assert.equal(c.stick.dash, false); assert.equal(c.mouse.on, false);
  assert.equal(c.charging, false); assert.equal(c.SK.hist.length, 0);
});
test('holding pause does not repeatedly toggle pause', () => {
  const c = context(); const handlers = {}; c.addEventListener = (type, fn) => {handlers[type] = fn;};
  for (const n of ['#helpOv', '#formView', '#teamView', '#stadView']) c.$(n).hidden = true;
  c.togglePause = () => {c.toggles = (c.toggles || 0) + 1;};
  vm.runInContext(script.slice(script.indexOf("addEventListener('keydown'"), script.indexOf("addEventListener('keyup'")), c);
  for (const code of ['KeyP', 'Escape']) {
    handlers.keydown({code, repeat: false}); handlers.keydown({code, repeat: true});
  }
  assert.equal(c.toggles, 2);
});
test('cancelled touch does not kick; ordinary touch release still does', () => {
  for (const event of ['pointercancel', 'lostpointercapture', 'pointerup']) {
    const c = context(controls), handlers = {}, classes = new Set();
    const button = {dataset: {b: 'shoot'}, setPointerCapture() {}, addEventListener: (name, fn) => {handlers[name] = fn;},
      classList: {add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name)}};
    c.initAudio = () => {}; c.document.querySelectorAll = () => [button];
    vm.runInContext(script.slice(script.indexOf("\ndocument.querySelectorAll('#btns button').forEach"), script.indexOf('const CUR_IDLE=')), c);
    handlers.pointerdown({preventDefault() {}, pointerId: 1}); c.updateActionHolds(.3); handlers[event]();
    assert.equal(c.shots || 0, event === 'pointerup' ? 1 : 0); assert.equal(c.charging, false);
  }
});
test('20 FPS update subdivides fast ball pickups that would otherwise skip a receiver', () => {
  const c = context(['updateBall', 'tryPickup', 'frame']); c.ball.owner = null; c.ball.pos.x = -.875; c.ball.vel.x = 35;
  c.updateBall(.05); c.tryPickup(); assert.equal(c.ball.owner, null);
  c.ball.pos.set(-.875, .21, 0); c.ball.vel.set(35, 0, 0); c.last = 0; c.hitStop = c.slowT = 0;
  const steps = [];
  c.step = dt => {steps.push(dt); if (!c.ball.owner) {c.updateBall(dt); c.tryPickup();}};
  for (const n of ['requestAnimationFrame', 'updateVisuals', 'recordFrame', 'updateCamera', 'updateMouseWorld', 'drawRadar', 'drawMomentum', 'drawWind']) c[n] = () => {};
  c.hlPend = []; c.composer = null; c.renderer = {render() {}}; c.camera = {}; c.scene = {};
  c.frame(50); assert.equal(c.ball.owner, c.active); assert.equal(steps.length, 3);
  assert.ok(steps.every(t => t <= 1 / 60));
});
test('rollKick reaches its requested distance or reports an unreachable pass', () => {
  const c = context(['rollKick']);
  for (const [rollK, rollC] of [[.7, .9], [1.05, 1.35], [1.1, 1.5]]) {
    Object.assign(c.STAD, {rollK, rollC});
    for (const d of [4, 10, 20, 30]) {
      const r = c.rollKick(d, 5), k = rollK, a = rollC / k;
      if (r.ok) {
        const distance = (r.v + a) * (1 - Math.exp(-k * r.t)) / k - a * r.t;
        assert.ok(Math.abs(distance - d) < .0001);
      } else assert.equal(r.t, Infinity);
    }
  }
});
test('GK prediction follows curved, falling and wind-affected shots in both directions', () => {
  const c = context(['curveShot', 'updateBall', 'gkShotArrival']);
  c.kick = (p, x, z, v, vy) => {c.ball.owner = null; c.ball.vel.set(x * v, vy, z * v);};
  c.shake = c.noteShot = () => {}; c.shotInfoOf = () => ({});
  for (const side of [-1, 1]) for (const distance of [10, 18, 25]) for (const aim of [-3, 0, 3]) for (const windy of [false, true]) {
    c.STAD.wind = windy; c.ball.pos.set(side * (30 - distance), .21, 0);
    c.curveShot({team: side > 0 ? 0 : 1}, side * 30, aim, .65);
    const line = side * 29.1, predicted = c.gkShotArrival(line, -side);
    assert.ok(predicted);
    for (let i = 0; i < 480 && (c.ball.pos.x - line) * side < 0; i++) c.updateBall(1 / 240);
    assert.ok(Math.hypot(predicted.z - c.ball.pos.z, predicted.y - c.ball.pos.y) < .12);
  }
});
test('routine contact respects skill immunity and a fooled defender', () => {
  const c = context(['step', 'updateActionHolds', 'canAct', 'canKick']);
  for (const n of ['updateDefenseHold', 'updateClock', 'updateMomentum', 'updateWind', 'skillInput', 'updatePlayers', 'updateBall', 'aerialStrike', 'gkCheck', 'tryPickup', 'checkRules', 'updateButtonLabels']) c[n] = () => {};
  Object.assign(c, {clock: 0, half: 1, chain: {team: 1}, lastOwnerTeam: 1, switchTimer: 1, pendingFoul: null, manualSwitchUntil: 10});
  c.Math.random = () => 0; const opponent = player(1); c.ball.owner = opponent;
  opponent.evadeT = .3; c.step(.01); assert.equal(c.ball.owner, opponent);
  opponent.evadeT = 0; c.active.fooledT = .3; c.step(.01); assert.equal(c.ball.owner, opponent);
  c.active.fooledT = 0; c.step(.01); assert.equal(c.ball.owner, null);
});
test('movement input keeps diagonal speed consistent and follows camera orientation', () => {
  const c = context(['inputVec']); c.camF = new Vector(0, 0, -1);
  c.keys.KeyW = true; let v = c.inputVec(); assert.equal(v.m, 1); assert.equal(v.z, -1);
  c.keys.KeyD = true; v = c.inputVec(); assert.ok(Math.abs(Math.hypot(v.x, v.z) - 1) < 1e-9);
  c.camF.set(1, 0, 0); c.keys.KeyD = false; v = c.inputVec(); assert.equal(v.x, 1); assert.equal(v.z, 0);
  c.keys.KeyW = false; c.stick.x = .3; c.stick.y = .4; v = c.inputVec(); assert.equal(v.m, .5);
});
test('CPU tackle retains its launch speed on the frame it starts', () => {
  const c = context(['updatePlayers', 'startTackle']); const p = player(1); c.players = [p]; c.active = null;
  c.ball.owner = null; c.ball.pos.x = 1; c.tmpV = new Vector(); c.diff = {spd: 1}; c.rushMul = () => 1;
  c.computeRoles = () => {}; c.fieldAI = (p, out) => {out.set(1, 0, 0); c.startTackle(p, false);};
  c.updatePlayers(1 / 60); assert.equal(p.tackleT, .32); assert.equal(p.vel.x, 10);
});
test('GK reacts to high central shots and recovers from a dive after a catch', () => {
  const c = context(['gkAI']); const p = player(1, 'GK'); p.pos.x = 29.1;
  c.diff = {spd: 1}; c.waitingForGkKick = () => false; c.seek = () => {}; c.intercept = () => ({x: 29.1, z: 0});
  c.ball.owner = null; c.ball.pos.x = 27; c.ball.vel.x = 20;
  c.gkShotArrival = () => ({t: .1, z: 0, y: 2.2});
  assert.equal(c.gkAI(p, new Vector(), 1 / 60), 'nosteer'); assert.equal(p.diveT, .6);
  c.ownerAI = () => {}; c.ball.owner = p;
  for (let i = 0; i < 40; i++) c.gkAI(p, new Vector(), 1 / 60);
  assert.equal(p.diveT, 0);
});
test('restart taker recovers from previous tackle, dive and feint states', () => {
  const c = context([...controls, 'setupRestart']); const p = c.active;
  Object.assign(p, {stunT: .5, tackleT: .3, diveT: .6, fooledT: .4, spinT: .2, evadeT: .3, boostT: .4, pkHold: 9, tackleMiss: true});
  c.banner = () => {}; c.TEAMS = [{name: 'home'}, {name: 'away'}]; c.RESTART_NAME = {kickin: 'kickin'};
  c.setupRestart('kickin', 0, 4, 19.75);
  assert.equal(c.ball.owner, p); assert.equal(c.canKick(p), true); assert.equal(p.diveT, 0);
  assert.equal(p.spinT, 0); assert.equal(p.pkHold, 0); assert.equal(p.tackleMiss, false);
});
