// Fable probe (267 boundary): skinned-vertex leg-axis vs boot along the ski axis. Run: DRIVE_PORT=8395 node tools/probe_leg_axis.js
// +along = the athlete's forward (verified: goggles − head centre is along +fwd). Reads getPositionData(true,true) — NOT bounding info (stale on skinned meshes).
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 900, height: 900 } });
  await p.goto('http://127.0.0.1:' + (process.env.DRIVE_PORT || 8393) + '/index.html?mode=realistic&nc=' + Date.now());
  await p.waitForTimeout(9000);
  const out = await p.evaluate(() => {
    const scene = BABYLON.EngineStore.LastCreatedScene;
    const ski = scene.meshes.find(m => m.name === 'skiL');
    const bb = ski.getBoundingInfo().boundingBox; const c = bb.vectorsWorld; let best = 0, fwd = new BABYLON.Vector3(0,0,1);
    for (let i = 1; i < 8; i++) { const d = c[i].subtract(c[0]); d.y = 0; if (d.length() > best) { best = d.length(); fwd = d.normalize(); } }
    const lat = new BABYLON.Vector3(-fwd.z, 0, fwd.x);
    const W = m => { const pos = m.getPositionData(true, true), wm = m.getWorldMatrix(), r = []; for (let i = 0; i < pos.length; i += 3) r.push(BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(pos[i], pos[i+1], pos[i+2]), wm)); return r; };
    const body = scene.meshes.filter(m => /^athleteBody/.test(m.name) && m.skeleton).flatMap(W);
    const res = { fwd: fwd.asArray().map(v => +v.toFixed(3)), skiTipAlong: null };
    // ski tip vs tail: which end of the ski is forward along fwd? use the ski's own extent sign: tips are the +fwd end by construction of fwd? report both ends
    const skiV = W(ski).map(v => BABYLON.Vector3.Dot(v, fwd)); res.skiAlong = [+Math.min(...skiV).toFixed(2), +Math.max(...skiV).toFixed(2)];
    for (const side of ['L', 'R']) {
      const boots = scene.meshes.filter(m => m.name.startsWith('athleteBoot' + side)).flatMap(W);
      const A = v => BABYLON.Vector3.Dot(v, fwd), Lt = v => BABYLON.Vector3.Dot(v, lat);
      const bAl = boots.map(A), bLat = boots.map(Lt), bY = boots.map(v => v.y);
      const cLat = bLat.reduce((a, b) => a + b, 0) / bLat.length, topY = Math.max(...bY), botY = Math.min(...bY);
      const bootMin = Math.min(...bAl), bootMax = Math.max(...bAl);
      // cuff opening: boot verts within 3 cm of the top
      const cuff = boots.filter(v => v.y > topY - 0.03); const cuffAl = cuff.map(A);
      const cuffC = cuffAl.reduce((a, b) => a + b, 0) / cuffAl.length;
      // shin at the cuff-top height band, near this boot laterally
      const shin = body.filter(v => Math.abs(Lt(v) - cLat) < 0.12 && v.y > topY - 0.03 && v.y < topY + 0.06 && A(v) > bootMin - 0.4 && A(v) < bootMax + 0.4);
      const shAl = shin.map(A); const shC = shAl.reduce((a, b) => a + b, 0) / (shAl.length || 1);
      // lowest body verts near this boot (the foot/sock), band 0..6 cm above boot bottom
      const foot = body.filter(v => Math.abs(Lt(v) - cLat) < 0.12 && v.y < botY + 0.08 && A(v) > bootMin - 0.4 && A(v) < bootMax + 0.4);
      const ftAl = foot.map(A); const ftC = ftAl.reduce((a, b) => a + b, 0) / (ftAl.length || 1);
      res[side] = { boot: { alongMin: +bootMin.toFixed(3), alongMax: +bootMax.toFixed(3), len: +(bootMax - bootMin).toFixed(3), topY: +topY.toFixed(3), botY: +botY.toFixed(3), cuffCentreAlong: +cuffC.toFixed(3), cuffAlongRange: [+Math.min(...cuffAl).toFixed(3), +Math.max(...cuffAl).toFixed(3)] },
        shinAtCuff: { n: shin.length, centreAlong: +shC.toFixed(3), range: shAl.length ? [+Math.min(...shAl).toFixed(3), +Math.max(...shAl).toFixed(3)] : null },
        footLow: { n: foot.length, centreAlong: +ftC.toFixed(3), range: ftAl.length ? [+Math.min(...ftAl).toFixed(3), +Math.max(...ftAl).toFixed(3)] : null },
        shinMinusCuff: +(shC - cuffC).toFixed(3), footCentreMinusBootCentre: +(ftC - (bootMin + bootMax) / 2).toFixed(3) };
    }
    return res;
  });
  console.log(JSON.stringify(out));
  await b.close();
})();
