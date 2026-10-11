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
    THROUGH_RUN_MUL: 1.25, throughRunMul: () => 1, rushMul: () => 1, diff: {spd: 1},
    ball: {owner: p, pos: new Vector(0, .21, 0), vel: new Vector(), shot: 0, lastTouch: 0},
    keys: {}, btn: {}, stick: {id: null, x: 0, y: 0, dash: false}, mouse: {on: false, inside: false},
    passHold: 0, passing: false, passPlayer: null, crossHold: null, crossTag: node('crossTag'), charging: false, charge: 0, chargePlayer: null, chargeHadBall: false,
    defenseButtons: new Set(), defenseHold: 0, wall: null, restartGuard: null, kickoffGuard: false,
    SK: {hist: [], last: null}, meter: node('meter'), targetRing: node('target'), throughMark: node('through'),
    cursorRing: node('cursor'), knob: node('knob'), stickEl: node('stick'), cv: node('canvas'),
    $: node, document: {querySelectorAll: () => []}, FORMATIONS: {331: {holdPlan: () => null}}, myForm: '331', teamForm: ['331', '331'],
    passingPlayer: () => c.passPlayer || c.active, shootingPlayer: () => c.chargePlayer || c.active,
    teamDir: t => t === 0 ? 1 : -1, dXZ: (a, b) => Math.hypot(a.x - b.x, a.z - b.z),
    clamp: (x, a, b) => Math.max(a, Math.min(b, x)), rnd: (a, b) => (a + b) / 2,
    sfx: {kick() {}, bounce() {}, ooh() {}, tackle() {}, whistle() {}}, addMom() {}, skillPop() {},
    frameCollide() {}, inputVec: () => ({x: 0, z: 0, m: 0}), switchPlayer() {}, setActive: p => {c.active = p;},
    firstTouch: () => false, feedReceiving: () => false, wallReceiving: () => false, topSupporting: () => false, midfieldBalanced: () => false, wingAttacking: () => false, targetAttacking: () => false, goalChargeLine: () => null, ST: {passOk: [0, 0], poss: [0, 0], tackles: [0, 0]},
    userShoot: () => {c.shots = (c.shots || 0) + 1;}, userPass: () => {c.passes = (c.passes || 0) + 1;}};
  c.Math.random = () => .5;
  vm.createContext(c);
  for (const n of names) vm.runInContext(source(n), c);
  return c;
}
const controls = ['canAct', 'canKick', 'press', 'release', 'cancelHolds', 'updateActionHolds'];

test('inline JavaScript parses', () => new vm.Script(script));
test('through receivers accelerate only after the pass and stop on reception, turnover or expiry', () => {
  const c = context(['throughRunMul']), p = c.active, carrier = player(), opponent = player(1);
  p.runUntil = c.T + 2; c.ball.owner = carrier;
  assert.equal(c.throughRunMul(p), 1);
  c.ball.owner = opponent; assert.equal(c.throughRunMul(p), 1);
  c.ball.owner = p; assert.equal(c.throughRunMul(p), 1);
  c.ball.owner = null; c.ball.passTo = p; p.receiveT = 2;
  assert.equal(c.throughRunMul(p), 1);
  p.throughBoostUntil = c.T + 2;
  assert.equal(c.throughRunMul(p), 1.25);
  for (const owner of [carrier, opponent, p]) {
    c.ball.owner = owner; assert.equal(c.throughRunMul(p), 1);
  }
  c.ball.owner = null;
  c.T += 2; assert.equal(c.throughRunMul(p), 1);
  c.T -= 2; p.receiveT = 0; assert.equal(c.throughRunMul(p), 1);
  p.receiveT = 2; c.ball.passTo = carrier; assert.equal(c.throughRunMul(p), 1);
});
test('through pass arrival uses boosted speed and wings can use shorter open runs', () => {
  const c = context(['throughPlan']), q = player(0, 'FW');
  c.players.push(q); c.ball.pos.x = -8;
  c.throughRoll = () => ({t: 1, v: 20, ok: true}); c.longLoftTime = () => 1.5;
  c.LOFT_THROUGH_DIST = 22; c.LOFT_PENALTY = 0; c.throughLaneClear = () => true;
  assert.ok(c.throughPlan(c.active, null, 20));
  c.THROUGH_RUN_MUL = 1; assert.equal(c.throughPlan(c.active, null, 20), null);
  c.THROUGH_RUN_MUL = 1.25; q.wing = true; q.pos.x = 8; c.ball.pos.x = 0;
  c.throughLaneClear = tx => tx - q.pos.x < 4;
  const plan = c.throughPlan(c.active, null); assert.ok(plan); assert.ok(plan.tx - q.pos.x < 4);
  c.throughLaneClear = () => false; assert.equal(c.throughPlan(c.active, null), null);
});
test('2-4-1 builds wide outlets, central support and coordinated cross runs in either half', () => {
  for (const team of [0, 1]) for (const halfDirection of [1, -1]) for (const side of [-1, 1]) {
    const c = context(['wingAttacking', 'formTarget', 'crossRuns', 'fieldAI', 'guard', 'seek']);
    c.teamDir = t => (t === 0 ? 1 : -1) * halfDirection; c.teamForm = ['241', '241'];
    const d = c.teamDir(team), carrier = player(team, 'DF'); carrier.pos.set(0, 0, 0);
    const make = (role, x, z, wing = false) => {
      const p = player(team, role); p.base = {x, z}; p.seed = 0; p.wing = wing; p.pos.set(x * d, 0, z * d); return p;
    };
    const wings = [-1, 1].map(s => make('MF', -8, s * 14.5, true));
    const fw = make('FW', -2.5, 0), mids = [-4, 4].map(z => make('MF', -13, z)), df = make('DF', -20, 6);
    c.players = [carrier, ...wings, fw, ...mids, df]; c.active = carrier; c.ball.owner = carrier;
    c.ball.pos.set(0, .21, 0); c.waitingForGkKick = () => false; c.gkForwardSpot = () => null;
    for (const w of wings) {
      const f = c.formTarget(w); assert.ok(f.x * d > 0 && Math.abs(f.z) >= 14);
      const out = new Vector(); c.fieldAI(w, out, 1 / 60); assert.ok(out.x * d > 0);
    }
    for (const m of mids) assert.ok(c.formTarget(m).x * d < 0);
    const near = wings.find(w => Math.sign(w.base.z) === side), far = wings.find(w => w !== near);
    near.pos.set(20 * d, 0, side * 15 * d); c.ball.owner = near; c.ball.pos.set(near.pos.x, .21, near.pos.z);
    const f = c.formTarget(fw), g = c.formTarget(far);
    assert.ok(f.x * d >= 24 && Math.abs(f.z) < c.GW);
    assert.ok(g.x * d >= 24 && Math.abs(g.z) < c.GW && Math.sign(g.z) === -side * d);
    for (const m of mids) assert.ok(c.formTarget(m).x * d < near.pos.x * d - 5);
    assert.ok(c.formTarget(df).x * d <= 3);
    c.ball.owner = null; c.ball.kicker = carrier; c.ball.passTo = near; c.ball.lastTouch = team;
    assert.equal(!!c.wingAttacking(fw), true);
    c.roles = [{}, {}]; const out = new Vector(); c.fieldAI(fw, out, 1 / 60);
    assert.ok(out.x * d > 0 && Math.abs(out.length() - c.SPRINT) < 1e-9);
    c.crossRuns(near, fw); assert.ok(far.boxRun && far.boxRun.x * d > 24);
    assert.equal(mids.filter(m => m.boxRun).length, 1);
    c.ball.owner = player(1 - team); assert.equal(!!c.wingAttacking(fw), false);
  }
});

test('2-4-1 AI uses wing through balls, stays wide while carrying, and crosses to reachable forwards', () => {
  for (const team of [0, 1]) for (const side of [-1, 1]) {
    const c = context(['ownerAI', 'crossPlan']), d = c.teamDir(team), wing = player(team), fw = player(team, 'FW'), passer = player(team, 'DF');
    c.teamForm = ['241', '241']; c.diff = {spd: 1, react: .55, err: 1}; c.active = null;
    wing.wing = true; wing.base = {x: -8, z: side * 14.5}; wing.aiT = 1;
    wing.pos.set(10 * d, 0, side * 15.5 * d); c.players = [passer, wing, fw]; c.ball.owner = wing;
    const out = new Vector(); c.ownerAI(wing, out, 1 / 60);
    assert.ok(out.x * d > 0); assert.equal(out.z, 0); assert.ok(out.length() > c.RUN);
    passer.pos.set(-8 * d, 0, 0); passer.aiT = 0; c.ball.owner = passer;
    const plan = {q: wing, margin: .1}; c.throughPlan = (p, pref, extra, aim, only) => {assert.ok(only(wing)); assert.equal(!!only(fw), false); return plan;};
    c.throughPass = (p, pl) => {c.sent = pl;}; c.ownerAI(passer, out, 1 / 60); assert.equal(c.sent, plan);
    wing.aiT = 0; wing.pos.set(22 * d, 0, side * 12 * d); fw.pos.set(25 * d, 0, 0);
    c.ball.owner = wing; c.ball.pos.set(wing.pos.x, .21, wing.pos.z); c.sent = null;
    c.shoot = () => {throw new Error('reachable cross should be preferred over a narrow-angle shot');};
    c.ownerAI(wing, out, 1 / 60); assert.ok(c.sent && c.sent.cross); assert.equal(c.sent.q, fw);
  }
});

test('2-4-1 wing preference keeps explicit passing direction and other formations intact', () => {
  const c = context(['bestPassTarget']), p = c.active, wing = player(), central = player();
  wing.wing = true; wing.pos.set(10, 0, 10); central.pos.set(10, 0, 0); c.players = [p, central, wing];
  c.passChoice = (p, q) => ({lx: q.pos.x, lz: q.pos.z, dist: Math.hypot(q.pos.x, q.pos.z), risk: 0});
  c.teamForm[0] = '241'; assert.equal(c.bestPassTarget(p, null), wing);
  assert.equal(c.bestPassTarget(p, {x: 1, z: 0}), central);
  c.teamForm[0] = '331'; assert.equal(c.bestPassTarget(p, null), central);
});

test('cross area includes the expanded boundary on both wings and attack directions', () => {
  for (const team of [0, 1]) for (const side of [-1, 1]) {
    const c = context(['crossPlan']), p = player(team), q = player(team, 'FW'), d = c.teamDir(team);
    c.players = [p, q]; q.pos.set((c.HL - 6) * d, 0, 0);
    p.pos.set((c.HL - 14) * d, 0, (c.HW - 10) * side);
    const plan = c.crossPlan(p); assert.ok(plan && plan.cross); assert.equal(plan.q, q);
    p.pos.x = (c.HL - 14 - .01) * d; assert.equal(c.crossPlan(p), null);
    p.pos.x = (c.HL - 14) * d; p.pos.z = (c.HW - 10 - .01) * side;
    assert.equal(c.crossPlan(p), null);
    p.pos.set((c.HL - 10) * d, 0, (c.HW - 7) * side); assert.ok(c.crossPlan(p));
  }
});
test('crosses target the goal mouth even when the receiver is wide or behind', () => {
  for (const team of [0, 1]) for (const side of [-1, 1]) {
    const c = context(['crossPlan']), p = player(team), q = player(team, 'FW'), d = c.teamDir(team);
    c.players = [p, q]; p.pos.set((c.HL - 12) * d, 0, (c.HW - 8) * side);
    c.ball.pos.set(p.pos.x, c.BR, p.pos.z);
    for (const [x, z] of [[-8, 16], [29, -17], [22, 0]]) {
      q.pos.set(x * d, 0, z * side);
      const plan = c.crossPlan(p); assert.ok(plan); assert.equal(plan.q, q);
      const goalDistance = c.HL - plan.tx * d;
      assert.equal(goalDistance, 4);
      assert.ok(Math.abs(plan.tz) < c.GW);
      if (z === 0) assert.equal(Math.abs(plan.tz), 0);
    }
  }
});
test('through passes start receiver boost but crosses do not', () => {
  const c = context(['throughPass']), q = player(); c.players.push(q);
  c.kick = () => {c.ball.owner = null;}; c.longLoftTime = () => 1.2; c.loftSpeed = () => 20;
  c.countPass = c.banner = c.crossRuns = () => {}; c.landTime = () => 1.5;
  const plan = {q, tx: 18, tz: 0, loft: true}; c.throughPass(c.active, plan);
  assert.equal(c.ball.passTo, q); assert.equal(q.throughBoostUntil, c.T + q.receiveT);
  c.throughPass(c.players[0], {...plan, cross: true}); assert.equal(q.throughBoostUntil, 0);
});

test('CPU crosses retain the target at head height for the receiver without arming user input', () => {
  const c = context(['kick', 'throughPass']), p = player(1), q = player(1, 'FW');
  c.players = [p, q]; c.countPass = c.crossRuns = () => {}; c.landTime = () => 1.5;
  const plan = {q, tx: -26, tz: 0, cross: true}; c.throughPass(p, plan);
  assert.equal(c.ball.cross.team, 1); assert.equal(c.ball.cross.arm, null);
  assert.equal(c.ball.cross.tx, plan.tx); assert.equal(c.ball.passTo, q);
  const declaration = script.match(/const crossSpot=p=>[^;]+;/)[0]; vm.runInContext(declaration, c);
  assert.equal(vm.runInContext('crossSpot(ball.passTo).x', c), plan.tx);
  c.T = c.ball.cross.at + .2; assert.equal(vm.runInContext('crossSpot(ball.passTo)', c), null);
});
test('cross direction selects near, centre and far on either wing with keys or touch', () => {
  for (const side of [-1, 1]) for (const device of ['keys', 'touch']) {
    const c = context(['crossPlan', 'inputVec']), p = c.active, q = player(0, 'FW');
    c.camF = new Vector(0, 0, -1); c.players.push(q); p.pos.set(20, 0, side * 14);
    q.pos.set(24, 0, 0);
    assert.equal(c.crossPlan(p).crossAim, '中央'); assert.equal(c.crossPlan(p).tz, 0);
    for (const [direction, label] of [[side, 'ニア'], [-side, 'ファー']]) {
      if (device === 'keys') {c.keys.KeyW = direction < 0; c.keys.KeyS = direction > 0;}
      else c.stick.y = direction;
      const plan = c.crossPlan(p); assert.equal(plan.crossAim, label);
      assert.equal(Math.sign(plan.tz), direction);
    }
  }
});
test('mouse cross selection aims at the goal rather than relative to the passer', () => {
  for (const side of [-1, 1]) {
    const c = context(['crossPlan']), p = c.active; c.players.push(player(0, 'FW'));
    p.pos.set(20, 0, side * 14); c.mouse = {on: true, inside: true, x: 24, z: 0};
    assert.equal(c.crossPlan(p).crossAim, '中央');
    c.mouse.z = side * 2; assert.equal(c.crossPlan(p).crossAim, 'ニア');
    c.mouse.z = -side * 2; assert.equal(c.crossPlan(p).crossAim, 'ファー');
    c.mouse.inside = false; assert.equal(c.crossPlan(p).crossAim, '中央');
  }
});
test('long cross hold stays locked outside the area and clears on release, cancel or loss', () => {
  for (const finish of ['release', 'cancel', 'loss']) {
    const c = context([...controls, 'crossPlan', 'wingThroughPlan']), p = c.active;
    c.players.push(player(0, 'FW')); p.pos.set(20, 0, 14); c.myForm = '241';
    c.FORMATIONS['241'] = {holdPlan: () => c.wingThroughPlan(), holdKick: (p, plan) => {c.kicked = plan;}};
    c.press('pass'); c.updateActionHolds(.2); assert.equal(c.crossHold, null);
    c.updateActionHolds(.03); assert.equal(c.crossHold.p, p);
    p.pos.set(10, 0, -2); c.inputVec = () => ({x: 0, z: -1, m: 1});
    assert.equal(c.crossPlan(p), null); assert.equal(c.wingThroughPlan().crossAim, 'ファー');
    c.crossTag.hidden = false;
    if (finish === 'release') {c.release('pass'); assert.equal(c.kicked.crossAim, 'ファー');}
    else if (finish === 'cancel') c.cancelHolds();
    else {c.ball.owner = player(1); c.updateActionHolds(0); c.release('pass'); assert.equal(c.kicked, undefined);}
    assert.equal(c.crossHold, null); assert.equal(c.crossTag.hidden, true);
    c.ball.owner = p; c.press('pass'); c.updateActionHolds(.1); c.release('pass');
    assert.equal(c.passes, 1);
  }
});
test('automatic and controlled receivers get the same movement boost', () => {
  for (const controlled of [false, true]) {
    const c = context(['throughRunMul', 'updatePlayers']), p = c.active;
    c.active = controlled ? p : null; c.ball.owner = null; c.ball.passTo = p;
    p.receiveT = 2; p.throughBoostUntil = c.T + 2;
    c.tmpV = new Vector(); c.computeRoles = () => {}; c.lerpAngle = a => a;
    c.userControl = c.fieldAI = (p, out) => out.set(c.SPRINT, 0, 0);
    c.updatePlayers(1 / 60);
    assert.ok(Math.abs(p.vel.x - c.SPRINT * 1.25 * (1 - Math.exp(-11 / 60))) < 1e-9);
  }
});
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
test('held defensive switch selects a defender ahead, including the original active player', () => {
  for (const button of ['pass', 'switch']) {
    const c = context([...controls, 'defenseCharging', 'updateDefenseHold', 'defCost', 'bestDefender', 'switchPlayer']);
    const front = c.active, behind = player(), opponent = player(1);
    front.pos.x = -6; behind.pos.x = .5; opponent.vel.x = -4;
    c.players = [front, behind, opponent]; c.ball.owner = opponent;
    c.press(button); assert.equal(c.active, behind);
    c.updateDefenseHold(.2); assert.equal(c.active, behind);
    c.updateDefenseHold(.03); assert.equal(c.active, front);
    // Once charging, retain the chosen player even after they reach the carrier.
    front.pos.x = .6; behind.pos.x = -1;
    c.updateDefenseHold(.1); assert.equal(c.active, front);
  }
});
test('charge selection follows the carrier direction and falls back to attack direction at rest', () => {
  const c = context(['defCost', 'bestDefender']); const opponent = player(1), behind = c.active, front = player();
  c.players = [behind, front, opponent]; c.ball.owner = opponent;
  for (const [vx, vz, x, z] of [[-4, 0, -6, 0], [4, 0, 6, 0], [0, 4, 0, 6], [0, 0, -6, 0]]) {
    opponent.vel.set(vx, 0, vz); front.pos.set(x, 0, z); behind.pos.set(-x / 12, 0, -z / 12);
    assert.equal(c.bestDefender(null, true)[0], front);
  }
});

test('goal-front charge selection favours the shooting lane even during sideways dribbling in either half', () => {
  for (const halfDirection of [1, -1]) for (const side of [-1, 1]) {
    const c = context(['goalChargeLine', 'defCost', 'bestDefender']), opponent = player(1), blocker = player(), sideways = player();
    c.teamDir = t => (t === 0 ? 1 : -1) * halfDirection;
    opponent.pos.set(-21 * halfDirection, 0, side * 6); opponent.vel.z = side * 4;
    const lane = c.goalChargeLine(opponent, 0);
    blocker.pos.set(opponent.pos.x + lane.x * 3, 0, opponent.pos.z + lane.z * 3);
    sideways.pos.set(opponent.pos.x, 0, opponent.pos.z + side);
    c.players = [sideways, blocker, opponent]; c.ball.owner = opponent;
    assert.equal(c.bestDefender(null, true)[0], blocker);
    opponent.pos.x = 0; assert.equal(c.goalChargeLine(opponent, 0), null);
  }
});

test('goal-front charge aligns with the goal-carrier line before attempting a steal', () => {
  for (const halfDirection of [1, -1]) for (const side of [-1, 1]) {
    const c = context(['goalChargeLine', 'userControl']), defender = c.active, opponent = player(1);
    c.teamDir = t => (t === 0 ? 1 : -1) * halfDirection;
    opponent.pos.set(-22 * halfDirection, 0, side * 5); c.ball.owner = opponent;
    c.defenseCharging = () => true; let attempts = 0, target;
    c.shoulderCharge = () => {attempts++;}; c.seek = (p, x, z) => {target = {x, z};};
    const lane = c.goalChargeLine(opponent, 0), out = new Vector();
    for (const [along, across] of [[1, 1], [-.8, 0], [1, 0]]) {
      defender.pos.set(opponent.pos.x + lane.x * along - lane.z * across, 0, opponent.pos.z + lane.z * along + lane.x * across);
      c.userControl(defender, out, 1 / 60);
      const dx = target.x - opponent.pos.x, dz = target.z - opponent.pos.z;
      assert.ok(Math.abs(dx * lane.z - dz * lane.x) < 1e-9, 'approach target lies on the shooting lane');
      assert.ok(dx * lane.x + dz * lane.z > 0, 'approach stays on the goal side');
      assert.equal(attempts, along === 1 && across === 0 ? 1 : 0);
    }
  }
});

test('held charge moves into the shooting lane and closes from the goal side', () => {
  const c = context(['goalChargeLine', 'userControl', 'guard', 'seek', 'updatePlayers']), p = c.active, opponent = player(1);
  opponent.pos.set(-22, 0, 5); c.ball.owner = opponent; c.defenseCharging = () => true;
  const lane = c.goalChargeLine(opponent, 0);
  p.pos.set(opponent.pos.x + lane.x * 3 - lane.z * 3, 0, opponent.pos.z + lane.z * 3 + lane.x * 3);
  c.players = [p]; c.tmpV = new Vector(); c.computeRoles = () => {}; c.lerpAngle = a => a;
  let attempts = 0; c.shoulderCharge = () => {attempts++;};
  for (let i = 0; i < 180; i++) c.updatePlayers(1 / 60);
  const dx = p.pos.x - opponent.pos.x, dz = p.pos.z - opponent.pos.z;
  assert.ok(dx * lane.x + dz * lane.z > 0);
  assert.ok(Math.abs(dx * lane.z - dz * lane.x) < .55);
  assert.ok(Math.hypot(dx, dz) < 1.4 && attempts > 0);
});
test('charge falls back to an available defender when no one ahead can act', () => {
  const c = context(['defCost', 'bestDefender']); const opponent = player(1), front = player(), behind = c.active;
  front.pos.x = -6; behind.pos.x = .5; c.players = [front, behind, opponent]; c.ball.owner = opponent;
  for (const state of ['stunT', 'fooledT', 'tackleT', 'diveT', 'locked']) {
    front[state] = state === 'locked' ? true : .1;
    assert.equal(c.bestDefender(null, true)[0], behind);
    front[state] = state === 'locked' ? false : 0;
  }
  c.players = [behind, opponent]; assert.equal(c.bestDefender(null, true)[0], behind);
  behind.stunT = .1; assert.equal(c.bestDefender(null, true)[0], null);
});

test('3-3-1 midfield and defence advance to support a lone striker in either half', () => {
  for (const team of [0, 1]) for (const halfDirection of [1, -1]) {
    const c = context(['topSupporting', 'midfieldBalanced', 'formTarget', 'fieldAI', 'guard', 'seek', 'updatePlayers']);
    c.teamDir = t => (t === 0 ? 1 : -1) * halfDirection;
    c.teamForm = ['331', '331']; const d = c.teamDir(team), fw = player(team, 'FW');
    fw.pos.set(20 * d, 0, 0); c.ball.owner = fw; c.ball.pos.set(20 * d, .21, 0);
    const supports = ['MF', 'DF'].flatMap(role => [-12, 0, 12].map(z => {
      const p = player(team, role); p.base = {x: role === 'MF' ? -10 : -19, z}; p.seed = 0;
      p.pos.set(p.base.x * d, 0, z * d); p.runUntil = c.T + 10; return p;
    }));
    c.players = supports; c.active = null; c.tmpV = new Vector(); c.computeRoles = () => {};
    c.waitingForGkKick = () => false; c.gkForwardSpot = () => null; c.lerpAngle = a => a;
    for (const p of supports) {
      const target = c.formTarget(p), x = target.x * d;
      assert.equal(x, p.role === 'DF' ? 3 : p.base.z === 0 ? 12 : p.base.z > 0 ? 21.5 : 15);
      const out = new Vector(); c.fieldAI(p, out, 1 / 60);
      assert.ok(out.x * d > 0);
      assert.ok(Math.abs(out.length() - c.SPRINT) < 1e-9);
    }
    for (let i = 0; i < 180; i++) {c.T += 1 / 60; c.updatePlayers(1 / 60);}
    for (const p of supports) assert.ok(p.pos.x * d > 0, `${p.role} should join the attack beyond halfway`);
    const central = supports.find(p => p.role === 'MF' && p.base.z === 0);
    assert.ok(central.pos.x * d < fw.pos.x * d, 'central midfielder remains a passing option behind the striker');
  }
});

test('3-3-1 midfield keeps one forward option and two deeper supports as the ball changes sides', () => {
  for (const team of [0, 1]) for (const halfDirection of [1, -1]) {
    const c = context(['midfieldBalanced', 'formTarget', 'fieldAI', 'guard', 'seek']);
    c.teamDir = t => (t === 0 ? 1 : -1) * halfDirection; c.teamForm = ['331', '331'];
    const d = c.teamDir(team), mids = [-12, 0, 12].map(z => {
      const p = player(team); p.base = {x: -10, z}; p.seed = 0; p.runUntil = c.T + 10; return p;
    });
    c.players = mids; c.waitingForGkKick = () => false; c.gkForwardSpot = () => null;
    for (const carrierRole of ['FW', 'MF', 'DF']) for (const side of [-1, 1]) {
      const carrier = player(team, carrierRole); carrier.pos.set(24 * d, 0, side * 10 * d);
      c.ball.owner = carrier; c.ball.pos.set(carrier.pos.x, .21, carrier.pos.z);
      const targets = mids.map(p => c.formTarget(p));
      const near = mids.findIndex(p => Math.sign(p.base.z) === side), far = mids.findIndex(p => Math.sign(p.base.z) === -side);
      assert.ok(targets[near].x * d > carrier.pos.x * d);
      assert.ok(targets[far].x * d < carrier.pos.x * d);
      assert.ok(targets[1].x * d < targets[far].x * d);
      assert.ok(targets[1].x * d <= 12 && Math.abs(targets[1].z) <= 5, 'central midfielder guards the centre');
      const out = new Vector(); c.fieldAI(mids[near], out, 1 / 60);
      assert.equal(mids[near].nextRunT, undefined, 'balanced midfielder does not start random forward runs');
    }
    c.teamForm[team] = '241'; assert.equal(!!c.midfieldBalanced(mids[0]), false);
  }
});

test('3-3-1 midfield keeps the nearest presser while the others recover after a turnover', () => {
  for (const team of [0, 1]) for (const halfDirection of [1, -1]) {
    const c = context(['midfieldBalanced', 'formTarget', 'fieldAI', 'guard', 'seek', 'computeRoles']);
    c.teamDir = t => (t === 0 ? 1 : -1) * halfDirection; c.teamForm = ['331', '331'];
    const d = c.teamDir(team), rival = player(1 - team, 'FW'); rival.pos.set(10 * d, 0, 12 * d); rival.gotT = c.T;
    c.ball.owner = rival; c.ball.pos.set(rival.pos.x, .21, rival.pos.z);
    const mids = [-12, 0, 12].map(z => {
      const p = player(team); p.base = {x: -10, z}; p.seed = 0; p.pos.set(15 * d, 0, z * d); return p;
    });
    c.players = mids; c.active = null; c.roles = [{}, {}]; c.computeRoles();
    c.waitingForGkKick = () => false; c.gkForwardSpot = () => null;
    assert.equal(c.roles[team].presser, mids[2]);
    for (const p of mids.filter(p => p !== c.roles[team].presser)) {
      const out = new Vector(); c.fieldAI(p, out, 1 / 60);
      assert.ok(out.x * d < 0, 'non-pressing midfielder returns toward their own goal');
      assert.ok(Math.abs(out.length() - c.SPRINT) < 1e-9, 'distant midfielder sprints back');
    }
    const centre = c.formTarget(mids[1]);
    assert.ok(centre.x * d <= 2 && Math.abs(centre.z) <= 5);
  }
});

test('lone-striker support ends on turnover and applies only to 3-3-1 attacking possession', () => {
  const c = context(['topSupporting']), p = player(0), fw = player(0, 'FW');
  c.teamForm = ['331', '331']; c.ball.owner = fw; fw.pos.x = 10;
  assert.equal(!!c.topSupporting(p), true);
  c.ball.owner = player(1, 'FW'); assert.equal(!!c.topSupporting(p), false);
  c.ball.owner = fw; fw.pos.x = -1; assert.equal(!!c.topSupporting(p), false);
  fw.pos.x = 10; fw.locked = true; assert.equal(!!c.topSupporting(p), false);
  fw.locked = false; fw.role = 'MF'; assert.equal(!!c.topSupporting(p), false);
  fw.role = 'FW'; c.teamForm[0] = '241'; assert.equal(!!c.topSupporting(p), false);
  c.teamForm[0] = '331'; c.state = 'kickoff'; assert.equal(!!c.topSupporting(p), false);
});

function wallContext(team = 0, distance = 6) {
  const c = context(['kick', 'wallReturn', 'wallReceiving', 'guard', 'seek', 'userControl', 'fieldAI', 'tryPickup']);
  const from = player(team), partner = player(team), rival = player(1 - team), d = c.teamDir(team);
  c.teamForm = ['331', '331']; c.players = [rival, partner, from]; c.active = from;
  partner.pos.x = distance * d; c.ball.pos.x = partner.pos.x; c.ball.owner = partner;
  c.wall = {from, to: partner, tx: 8 * d, tz: 0, until: c.T + 4};
  c.throughSpeed = () => 12; c.countPass = () => {c.passCount = (c.passCount || 0) + 1;};
  c.passTo = (p, q) => {c.kick(p, -d, 0, 8, 0); c.ball.passTo = q; q.receiveT = 2; c.countPass();};
  return {c, from, partner, rival};
}

test('3-3-1 passer runs automatically, then follows the return trajectory on both teams', () => {
  for (const team of [0, 1]) for (const distance of [1, 6]) {
    const {c, from, partner, rival} = wallContext(team, distance), d = c.teamDir(team);
    c.inputVec = () => ({x: -d, z: 0, m: 1});
    const out = new Vector(); c.userControl(from, out, 1 / 60);
    assert.equal(out.x * d, c.SPRINT, 'run continues despite input away from the return');
    c.wallReturn(partner); assert.equal(c.wall, null); assert.equal(c.ball.passTo, from);
    assert.equal(c.passCount, 1); assert.equal(c.wallReceiving(from), true);
    c.intercept = () => ({x: 3 * d, z: 2});
    for (const name of ['userControl', 'fieldAI']) {
      c[name](from, out, 1 / 60);
      assert.ok(out.x * d > 0 && out.z > 0);
      assert.ok(Math.abs(out.length() - c.SPRINT * 1.12) < 1e-9);
    }
    c.ball.owner = rival; assert.equal(!!c.wallReceiving(from), false);
    c.ball.owner = null; c.T = c.ball.wallUntil; assert.equal(!!c.wallReceiving(from), false);
    c.T = 1; c.ball.lastTouch = rival.team; assert.equal(!!c.wallReceiving(from), false);
    c.ball.lastTouch = team; c.teamForm[team] = '241'; assert.equal(!!c.wallReceiving(from), false);
  }
});

test('one-two return wins a reachable contest, keeps possession, and respects explicit first touch', () => {
  for (const team of [0, 1]) for (const request of [false, true]) {
    const {c, from, partner, rival} = wallContext(team);
    c.wallReturn(partner); c.T += .2; c.ball.pos.set(10, .21, 0); c.ball.vel.set(1, 0, 0);
    from.pos.set(11, 0, 0); rival.pos.set(10, 0, 0); c.ball.touchReq = request ? 1 : 0;
    let touches = 0; c.firstTouch = () => {touches++; return false;};
    c.tryPickup(); assert.equal(c.ball.owner, from); assert.equal(touches, request ? 1 : 0);
    assert.equal(from.feedShieldUntil, undefined); assert.equal(!!c.wallReceiving(from), false);
  }
  const {c, from, partner, rival} = wallContext(); c.wallReturn(partner); c.T += .2;
  c.ball.pos.set(10, .21, 0); c.ball.vel.set(1, 0, 0); from.pos.set(12, 0, 0); rival.pos.set(10, 0, 0);
  c.tryPickup(); assert.equal(c.ball.owner, rival, 'automatic reception does not reach a distant ball');
  c.kick(partner, 1, 0, 10, 0); assert.equal(c.ball.wallUntil, 0);
});

test('3-2-2 supplies a strong front pair and surrounds the receiver with forward and deeper options', () => {
  for (const team of [0, 1]) for (const halfDirection of [1, -1]) {
    const c = context(['targetAttacking', 'formTarget', 'fieldAI', 'guard', 'seek']);
    c.teamDir = t => (t === 0 ? 1 : -1) * halfDirection; c.teamForm = ['322', '322'];
    const d = c.teamDir(team), make = (role, x, z) => {
      const p = player(team, role); p.base = {x, z}; p.seed = 0; p.pos.set(x * d, 0, z * d); return p;
    };
    const df = make('DF', -20, 0), fw = make('FW', -3, -5), partner = make('FW', -3, 5);
    const mids = [-5, 5].map(z => make('MF', -11, z)); c.players = [df, fw, partner, ...mids];
    c.ball.owner = df; c.ball.pos.set(df.pos.x, .21, 0);
    for (const m of mids) {
      const f = c.formTarget(m); assert.ok(f.x * d > df.pos.x * d && f.x * d < fw.pos.x * d);
    }
    fw.pos.set(18 * d, 0, -5 * d); c.ball.owner = fw; c.ball.pos.set(fw.pos.x, .21, fw.pos.z);
    const next = c.formTarget(partner); assert.ok(next.x * d > fw.pos.x * d); assert.ok(next.z * d > 0);
    for (const m of mids) {
      const f = c.formTarget(m); assert.ok(f.x * d < fw.pos.x * d && f.x * d > 0);
    }
    c.ball.owner = null; c.ball.kicker = df; c.ball.passTo = fw; c.ball.lastTouch = team; c.roles = [{}, {}];
    c.waitingForGkKick = () => false; c.gkForwardSpot = () => null;
    assert.equal(!!c.targetAttacking(partner), true);
    const out = new Vector(); c.fieldAI(partner, out, 1 / 60); assert.ok(out.x * d > 0 && Math.abs(out.length() - c.SPRINT) < 1e-9);
    c.ball.owner = player(1 - team); assert.equal(!!c.targetAttacking(partner), false);
  }
});

test('3-2-2 gives FW passing preference without overriding an explicit direction', () => {
  const c = context(['bestPassTarget']), p = c.active, fw = player(0, 'FW'), mid = player();
  fw.pos.set(10, 0, 8); mid.pos.set(10, 0, 0); c.players = [p, mid, fw]; c.teamForm[0] = '322';
  c.passChoice = (p, q) => ({lx: q.pos.x, lz: q.pos.z, dist: Math.hypot(q.pos.x, q.pos.z), risk: 0});
  assert.equal(c.bestPassTarget(p, null), fw); assert.equal(c.bestPassTarget(p, {x: 1, z: 0}), mid);
  c.passChoice = (p, q) => ({lx: q.pos.x, lz: q.pos.z, dist: Math.hypot(q.pos.x, q.pos.z), risk: q === fw ? 4 : 0});
  assert.equal(c.bestPassTarget(p, null), mid, 'FW preference still accounts for interception risk');
});

test('3-2-2 AI supplies the FW and lays the ball off to midfield under pressure', () => {
  for (const team of [0, 1]) {
    const c = context(['ownerAI']), d = c.teamDir(team), df = player(team, 'DF'), fw = player(team, 'FW'), mid = player(team), rival = player(1 - team);
    c.active = null; c.teamForm = ['322', '322']; c.diff = {spd: 1, react: .55, err: 1};
    df.pos.x = -15 * d; df.aiT = 0; c.players = [df, fw, mid]; c.ball.owner = df;
    const plan = {q: fw, margin: .1}; c.feedPlan = () => plan; c.longFeed = (p, pl) => {c.feed = pl;};
    const out = new Vector(); c.ownerAI(df, out, 1 / 60); assert.equal(c.feed, plan);
    fw.pos.set(5 * d, 0, 0); mid.pos.set(0, 0, 0); rival.pos.set(6 * d, 0, 0); fw.aiT = 0;
    c.players.push(rival); c.ball.owner = fw; c.bestPassTarget = () => mid; c.autoLoft = () => false;
    c.passTo = (p, q) => {c.layoff = q;}; c.ownerAI(fw, out, 1 / 60); assert.equal(c.layoff, mid);
  }
});

test('3-2-2 FW charge strength persists outside the reception window and stays formation-specific', () => {
  for (const team of [0, 1]) {
    const c = context(['shoulderCharge']), fw = player(team, 'FW'), rival = player(1 - team);
    c.teamForm = ['322', '322']; c.ball.owner = fw; rival.pos.set(1, 0, 0); c.Math.random = () => .2; c.shake = () => {};
    c.shoulderCharge(rival, fw, .1); assert.equal(c.ball.owner, fw);
    c.teamForm[team] = '331'; c.shoulderCharge(rival, fw, .1); assert.equal(c.ball.owner, rival);
  }
});

test('stronger long feeds arrive sooner at the intended spot across distances and kick heights', () => {
  for (const team of [0, 1]) for (const distance of [9, 20, 35, 46]) for (const height of [.21, 1.05]) {
    const c = context(['kick', 'longFeedTime', 'longFeed', 'updateBall']), p = player(team, 'DF'), q = player(team, 'FW');
    c.longLoftTime = d => c.clamp(.55 + d * .028, .75, 1.5); c.countPass = c.banner = () => {};
    c.players = [p, q]; c.ball.owner = p; c.ball.pos.set(-distance / 2, height, 0);
    const targetX = distance / 2, oldTime = c.longLoftTime(distance);
    c.longFeed(p, {q, tx: targetX, tz: 0});
    assert.ok(c.ball.vel.x > distance * .94 / oldTime);
    assert.ok(c.longFeedTime(distance) < oldTime);
    const step = 1 / 240, flight = c.longFeedTime(distance); let elapsed = 0;
    while (elapsed + step < flight) {c.updateBall(step); elapsed += step;}
    c.updateBall(flight - elapsed); elapsed = flight;
    assert.ok(c.ball.pos.y <= c.BR + .01, 'ball descends to the receiving height');
    assert.ok(Math.abs(c.ball.pos.x - targetX) < .15, `distance ${distance}, height ${height}: feed should land at its target`);
    assert.ok(elapsed < oldTime, 'ball arrives before the old feed would');
  }
});

function feedContext(team = 0) {
  const c = context(['kick', 'longFeedTime', 'longFeed', 'feedReceiving', 'feedReceiveSpot', 'landTime', 'ballFuture', 'guard', 'seek', 'userControl', 'fieldAI', 'tryPickup', 'shoulderCharge']);
  const passer = player(team, 'DF'), fw = player(team, 'FW'), rival = player(1 - team, 'DF');
  c.teamForm = ['322', '322']; c.players = [rival, passer, fw]; c.active = fw;
  c.countPass = c.banner = () => {}; c.longLoftTime = () => 1.5; c.ball.owner = passer;
  c.longFeed(passer, {q: fw, tx: c.teamDir(team) * 15, tz: 0});
  return {c, passer, fw, rival};
}

test('3-2-2 feed receivers automatically approach the ball while shielding it on both teams', () => {
  for (const team of [0, 1]) {
    const {c, passer, fw, rival} = feedContext(team), d = c.teamDir(team);
    c.ballFuture = () => ({x: d * 15, z: 0}); rival.pos.set(d * 17, 0, 0);
    const spot = c.feedReceiveSpot(fw); assert.equal(spot.x, d * 15.35);
    c.inputVec = () => ({x: -d, z: 0, m: 1});
    for (const name of ['userControl', 'fieldAI']) {
      const out = new Vector(); c[name](fw, out, 1 / 60);
      assert.equal(out.x * d, c.SPRINT * 1.12);
    }
    assert.equal(c.feedReceiving(fw), true);
    for (const change of [() => {c.T = c.ball.feedUntil;}, () => {c.ball.owner = rival;},
      () => {c.ball.lastTouch = rival.team;}, () => {c.ball.passTo = passer;},
      () => {c.teamForm[team] = '331';}, () => {fw.role = 'MF';}]) {
      c.T = 1; c.ball.owner = null; c.ball.lastTouch = team; c.ball.passTo = fw; c.teamForm[team] = '322'; fw.role = 'FW';
      change(); assert.equal(!!c.feedReceiving(fw), false);
    }
  }
});

test('feed receiver wins reachable falling-ball contests but cannot collect distant or rising balls', () => {
  for (const team of [0, 1]) {
    const {c, fw, rival} = feedContext(team);
    c.ball.pos.set(10, .21, 0); c.ball.vel.set(0, -1, 0); fw.pos.set(11, 0, 0); rival.pos.set(10, 0, 0);
    c.firstTouch = () => {throw new Error('automatic feed reception must keep possession');};
    c.tryPickup(); assert.equal(c.ball.owner, fw); assert.equal(fw.feedShieldUntil, c.T + .9);
    for (const [height, vy, distance] of [[2.1, -1, 1], [2.1, 1, 1], [2.2, -1, 1], [2.1, -1, 1.3]]) {
      const setup = feedContext(team), b = setup.c.ball;
      setup.rival.pos.x = 30; setup.passer.pos.x = -30;
      b.pos.set(10, height, 0); b.vel.set(0, vy, 0); setup.fw.pos.set(10 + distance, 0, 0);
      setup.c.tryPickup(); assert.equal(b.owner === setup.fw, height === 2.1 && vy < 0 && distance === 1);
    }
  }
});

test('feed keep resists shoulder charges briefly and clears on a new kick', () => {
  const {c, fw, rival} = feedContext(); c.ball.owner = fw; fw.feedShieldUntil = c.T + .9;
  c.shake = () => {};
  fw.pos.set(0, 0, 0); rival.pos.set(1, 0, 0); c.Math.random = () => .1;
  c.shoulderCharge(rival, fw, .1); assert.equal(c.ball.owner, fw);
  c.T += 1; c.shoulderCharge(rival, fw, .1); assert.equal(c.ball.owner, rival);
  fw.feedShieldUntil = c.T + .9; c.kick(fw, 1, 0, 10, 0);
  assert.equal(fw.feedShieldUntil, 0); assert.equal(c.ball.feedUntil, 0);
});

const longKickMovement = ['kick', 'longKick', 'landTime', 'ballFuture', 'gkForwardSpot', 'guard', 'seek', 'userControl', 'defenseCharging'];
function longKickContext() {
  const c = context(longKickMovement);
  c.countPass = c.banner = () => {}; c.sprinting = () => false;
  return c;
}
test('unplanned GK long kicks select the closest available teammate and start their run', () => {
  for (const team of [0, 1]) {
    const c = longKickContext(), gk = player(team, 'GK'), receiver = player(team, 'MF'), fw = player(team, 'FW'), stunned = player(team);
    const d = c.teamDir(team); gk.pos.x = -25 * d; receiver.pos.x = 5 * d; fw.pos.x = -5 * d;
    stunned.pos.x = 10 * d; stunned.stunT = .4;
    c.players = [gk, fw, stunned, receiver]; c.ball.owner = gk; c.ball.pos.x = gk.pos.x;
    c.longKick(gk, 25 * d, 0, .5);
    assert.equal(c.ball.passTo, receiver); assert.ok(receiver.receiveT > 0);
    assert.ok(c.gkForwardSpot(receiver)); assert.equal(c.gkForwardSpot(fw), null);
    if (team === 0) {
      assert.equal(c.active, receiver);
      const out = new Vector(); c.userControl(receiver, out, 1 / 60); assert.ok(out.x * d > 0);
    } else {
      vm.runInContext(source('fieldAI'), c); c.diff = {spd: 1}; c.waitingForGkKick = () => false;
      const out = new Vector(); c.fieldAI(receiver, out, 1 / 60); assert.ok(out.x * d > 0);
    }
  }
});
test('planned long kick receivers can move manually and resume automatic pursuit without input', () => {
  const c = longKickContext(), gk = player(0, 'GK'), receiver = player(0, 'DF'), out = new Vector();
  c.players = [gk, receiver]; c.ball.owner = gk;
  c.longKick(gk, 20, 0, .5, {q: receiver});
  assert.equal(c.ball.passTo, receiver); assert.equal(c.active, receiver);
  c.inputVec = () => ({x: 0, z: -1, m: 1});
  c.userControl(receiver, out, 1 / 60); assert.equal(out.x, 0); assert.equal(out.z, -c.RUN);
  c.sprinting = () => true; c.userControl(receiver, out, 1 / 60); assert.equal(out.z, -c.SPRINT);
  c.inputVec = () => ({x: 0, z: 0, m: 0});
  c.userControl(receiver, out, 1 / 60); assert.ok(out.x > 0); assert.equal(out.z, 0);
  c.ball.owner = receiver; assert.equal(c.gkForwardSpot(receiver), null);
  c.userControl(receiver, out, 1 / 60); assert.equal(out.length(), 0);
});
test('long kick without an available teammate leaves manual movement available', () => {
  const c = longKickContext(), gk = player(0, 'GK'), out = new Vector();
  c.active.stunT = .4; c.players = [gk, c.active]; c.ball.owner = gk;
  c.longKick(gk, 20, 0, .5); assert.equal(c.ball.passTo, null);
  c.active.stunT = 0; c.inputVec = () => ({x: 0, z: 1, m: 1});
  c.userControl(c.active, out, 1 / 60); assert.equal(out.z, c.RUN);
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
test('GK cannot cover near to far immediately, in either goal or direction', () => {
  for (const team of [0, 1]) for (const side of [-1, 1]) for (const hz of [60, 120]) {
    const c = context(['gkAI', 'guard', 'seek', 'updatePlayers']), p = player(team, 'GK'), d = c.teamDir(team);
    const targetZ = -side * 3;
    p.pos.set(-c.HL * d + d * .9, 0, side * 3); p.vel.z = side * c.RUN * .6;
    c.players = [p]; c.active = null; c.ball.owner = null; c.ball.pos.set(p.pos.x + d * 5, .21, targetZ);
    c.ball.vel.x = -d * 20; c.tmpV = new Vector(); c.computeRoles = () => {};
    c.waitingForGkKick = () => false; c.intercept = () => ({x: p.pos.x, z: targetZ});
    c.lerpAngle = a => a;
    let elapsed = 0;
    c.gkShotArrival = () => ({t: .5 - elapsed, z: targetZ, y: 1});
    const out = new Vector(); c.gkAI(p, out, 1 / hz);
    assert.ok(Math.abs(out.z) <= c.RUN * .6);
    c.updatePlayers(1 / hz); elapsed += 1 / hz;
    assert.ok(p.vel.z * side > 0, 'reversing direction takes time');
    for (let i = 1; i < hz / 2; i++) {
      c.updatePlayers(1 / hz); elapsed += 1 / hz;
      assert.ok(Math.abs(p.vel.z) <= 7, 'dive speed is bounded');
    }
    assert.ok(Math.abs(p.pos.z - targetZ) > 1.45, 'far shot remains outside the diving save radius');
  }
});

test('GK keeps forward sprint speed when chasing a loose ball', () => {
  for (const team of [0, 1]) {
    const c = context(['gkAI', 'guard', 'seek']), p = player(team, 'GK'), d = c.teamDir(team);
    p.pos.set(-c.HL * d + d, 0, 0); c.players = [p]; c.ball.owner = null;
    c.ball.pos.set(p.pos.x + d * 5, .21, 0); c.waitingForGkKick = () => false;
    c.intercept = () => ({x: c.ball.pos.x, z: 0});
    const out = new Vector(); c.gkAI(p, out, 1 / 60);
    assert.equal(out.x * d, c.SPRINT); assert.equal(out.z, 0);
  }
});

test('restart taker recovers from previous tackle, dive and feint states', () => {
  const c = context([...controls, 'setupRestart']); const p = c.active;
  Object.assign(p, {stunT: .5, tackleT: .3, diveT: .6, fooledT: .4, spinT: .2, evadeT: .3, boostT: .4, pkHold: 9, tackleMiss: true});
  c.banner = () => {}; c.TEAMS = [{name: 'home'}, {name: 'away'}]; c.RESTART_NAME = {kickin: 'kickin'};
  c.setupRestart('kickin', 0, 4, 19.75);
  assert.equal(c.ball.owner, p); assert.equal(c.canKick(p), true); assert.equal(p.diveT, 0);
  assert.equal(p.spinT, 0); assert.equal(p.pkHold, 0); assert.equal(p.tackleMiss, false);
});
