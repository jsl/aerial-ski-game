const { chromium } = require('/home/justin/Code/aerial-ski-game/node_modules/playwright');
const { spawn } = require('child_process');
const S = 'OUT_DIR';
(async () => {
  const srv = spawn('python3', ['-m','http.server','8096','--bind','127.0.0.1','--directory','/home/justin/Code/aerial-ski-game'], {stdio:'ignore'});
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox','--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 220 } });
  await page.goto('http://127.0.0.1:8096/index.html');
  await page.waitForFunction(() => window._characterMeshes && window._bodyLinked && window._surfacesApplied !== undefined, null, {timeout: 60000});
  await page.waitForTimeout(2000);
  await page.evaluate(() => { for (const el of document.querySelectorAll('body > *')) if (el.id !== 'renderCanvas') el.style.display = 'none'; });
  await page.setViewportSize({ width: 1100, height: 850 });
  await page.evaluate(() => BABYLON.EngineStore.LastCreatedScene.getEngine().resize());
  await page.waitForTimeout(400);
  const measure = (label) => page.evaluate((label) => {
    const scene = BABYLON.EngineStore.LastCreatedScene; const V = BABYLON.VertexBuffer;
    const parts = scene.meshes.filter(m => m.name && m.name.startsWith('athleteBody') && m.skeleton);
    const sk = parts[0].skeleton; const byIdx = {}; for (const b of sk.bones) byIdx[b.getIndex()] = b.name;
    const out = { label, groups: {}, landmarks: {} };
    let lo = [1e9,1e9,1e9], hi = [-1e9,-1e9,-1e9]; let rlo=[1e9,1e9,1e9], rhi=[-1e9,-1e9,-1e9];
    const shoulderBand = { raw: [0,0], sk: [0,0] }; // max |x|, max |z| for y in [0.05,0.28]
    for (const p of parts) {
      const raw = p.getVerticesData(V.PositionKind), skd = p.getPositionData(true, false);
      const idx = p.getVerticesData(V.MatricesIndicesKind), w = p.getVerticesData(V.MatricesWeightsKind);
      for (let i = 0; i < raw.length/3; i++) {
        let best=0,bw=-1; for (let k=0;k<4;k++) if (w[i*4+k]>bw){bw=w[i*4+k];best=idx[i*4+k];}
        const name = byIdx[best] || ('idx'+best); const g = out.groups[name] ||= {n:0, d:[0,0,0], rawC:[0,0,0], skC:[0,0,0]};
        g.n++; for (let c=0;c<3;c++){ g.d[c]+=skd[i*3+c]-raw[i*3+c]; g.rawC[c]+=raw[i*3+c]; g.skC[c]+=skd[i*3+c]; lo[c]=Math.min(lo[c],skd[i*3+c]); hi[c]=Math.max(hi[c],skd[i*3+c]); rlo[c]=Math.min(rlo[c],raw[i*3+c]); rhi[c]=Math.max(rhi[c],raw[i*3+c]); }
        const ry = raw[i*3+1], sy = skd[i*3+1];
        if (ry > 0.05 && ry < 0.28) { shoulderBand.raw[0]=Math.max(shoulderBand.raw[0],Math.abs(raw[i*3])); shoulderBand.raw[1]=Math.max(shoulderBand.raw[1],Math.abs(raw[i*3+2])); }
        if (sy > 0.05 && sy < 0.28) { shoulderBand.sk[0]=Math.max(shoulderBand.sk[0],Math.abs(skd[i*3])); shoulderBand.sk[1]=Math.max(shoulderBand.sk[1],Math.abs(skd[i*3+2])); }
      }
    }
    for (const g of Object.values(out.groups)) { for (let c=0;c<3;c++){ g.d[c]=+(g.d[c]/g.n).toFixed(3); g.rawC[c]=+(g.rawC[c]/g.n).toFixed(3); g.skC[c]=+(g.skC[c]/g.n).toFixed(3);} g.disp=+Math.hypot(...g.d).toFixed(3); }
    out.landmarks = { rawBBox:[rlo.map(v=>+v.toFixed(3)), rhi.map(v=>+v.toFixed(3))], skinnedBBox:[lo.map(v=>+v.toFixed(3)), hi.map(v=>+v.toFixed(3))], shoulderBandMaxAbs_xz: {raw: shoulderBand.raw.map(v=>+v.toFixed(3)), skinned: shoulderBand.sk.map(v=>+v.toFixed(3))} };
    const body = parts[0]; const wm = body.getWorldMatrix(); const s=new BABYLON.Vector3(),q=new BABYLON.Quaternion(),t=new BABYLON.Vector3(); wm.decompose(s,q,t);
    out.bodyWorld = { parent: body.parent && body.parent.name, grand: body.parent && body.parent.parent && body.parent.parent.name, rotDeg: q.toEulerAngles().asArray().map(v=>+(v*180/Math.PI).toFixed(1)), scale: s.asArray().map(v=>+v.toFixed(2)), pos: t.asArray().map(v=>+v.toFixed(2)) };
    // camera as in look.spec
    let blo=null,bhi=null; for (const p of parts){ p.computeWorldMatrix(true); const b=p.getBoundingInfo().boundingBox; blo=blo?BABYLON.Vector3.Minimize(blo,b.minimumWorld):b.minimumWorld.clone(); bhi=bhi?BABYLON.Vector3.Maximize(bhi,b.maximumWorld):b.maximumWorld.clone(); }
    const cam = scene.activeCamera; cam.lowerRadiusLimit=0.05; cam.upperRadiusLimit=200; cam.setTarget(blo.add(bhi).scale(0.5)); cam.radius=2.4; cam.fov=0.8; cam.beta=Math.PI/2.35; cam.alpha=Math.PI*1.30;
    return out;
  }, label);
  const before = await measure('before');
  await page.waitForTimeout(800); await page.screenshot({ path: S + '/fix_before.png' });
  // FIX EXPERIMENT: make every bone's bind matrix equal its driver's local matrix (bind == driver exactly, roll included)
  const fixInfo = await page.evaluate(() => {
    const scene = BABYLON.EngineStore.LastCreatedScene;
    const parts = scene.meshes.filter(m => m.name && m.name.startsWith('athleteBody') && m.skeleton); const sk = parts[0].skeleton;
    const done = [];
    for (const b of sk.bones) { const tn = b.getTransformNode && b.getTransformNode(); if (!tn) continue; tn.computeWorldMatrix(true);
      const lm = tn.getLocalMatrix ? tn.getLocalMatrix().clone() : tn._localMatrix.clone(); b.setBindMatrix(lm); done.push(b.name); }
    sk._markAsDirty && sk._markAsDirty(); sk.prepare && sk.prepare(true);
    return done;
  });
  await page.waitForTimeout(800);
  const after = await measure('after');
  await page.screenshot({ path: S + '/fix_after.png' });
  // also a front view after
  await page.evaluate(() => { const cam = BABYLON.EngineStore.LastCreatedScene.activeCamera; cam.alpha = Math.PI * 0.30; });
  await page.waitForTimeout(600); await page.screenshot({ path: S + '/fix_after_front.png' });
  console.log(JSON.stringify({ before, fixInfo, after }));
  await browser.close(); srv.kill();
})().catch(e => { console.error(e); process.exit(1); });
