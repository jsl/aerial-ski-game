const { chromium } = require('/home/justin/Code/aerial-ski-game/node_modules/playwright');
const { spawn } = require('child_process');
const S = 'OUT_DIR';
(async () => {
  const srv = spawn('python3', ['-m','http.server','8089','--bind','127.0.0.1','--directory','/home/justin/Code/aerial-ski-game'], {stdio:'ignore'});
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox','--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 220 } });
  await page.goto('http://127.0.0.1:8089/index.html'); page.on('console', m => { if (/error|ERR/i.test(m.text())) console.error('PAGE:', m.text().slice(0,200)); }); page.on('pageerror', e => console.error('PAGEERR:', String(e).slice(0,200))); const diag = setInterval(async () => { try { console.error('flags', JSON.stringify(await page.evaluate(() => ({cm: !!window._characterMeshes, bl: window._bodyLinked, sa: window._surfacesApplied})))); } catch(e){} }, 15000);
  await page.waitForFunction(() => window._characterMeshes && window._bodyLinked && window._surfacesApplied !== undefined, null, {timeout: 150000});
  await page.waitForTimeout(2000);
  await page.evaluate(() => { for (const el of document.querySelectorAll('body > *')) if (el.id !== 'renderCanvas') el.style.display = 'none'; });
  await page.setViewportSize({ width: 1100, height: 850 });
  await page.evaluate(() => BABYLON.EngineStore.LastCreatedScene.getEngine().resize());
  await page.waitForTimeout(300);
  const info = await page.evaluate(() => {
    const scene = BABYLON.EngineStore.LastCreatedScene; const V = BABYLON.VertexBuffer;
    const parts = scene.meshes.filter(m => m.name && m.name.startsWith('athleteBody') && m.skeleton); const sk = parts[0].skeleton;
    const M = window._characterMeshes; const root = parts[0].parent; const out = {};
    // Raw mesh: foot extents per foot (split by z sign) to see which axis the feet run along
    const p0 = parts[0]; const raw = p0.getVerticesData(V.PositionKind);
    const ext = { L:{x:[1e9,-1e9],z:[1e9,-1e9]}, R:{x:[1e9,-1e9],z:[1e9,-1e9]} };
    for (let i=0;i<raw.length/3;i++){ const y=raw[i*3+1]; if (y>-0.97) continue; const s = raw[i*3+2]>0?'L':'R'; ext[s].x=[Math.min(ext[s].x[0],raw[i*3]),Math.max(ext[s].x[1],raw[i*3])]; ext[s].z=[Math.min(ext[s].z[0],raw[i*3+2]),Math.max(ext[s].z[1],raw[i*3+2])]; }
    out.rawFootExtents = JSON.parse(JSON.stringify(ext));
    // knee direction: knee band centroid vs hip band centroid, per side
    const band = (y0,y1,side) => { let c=[0,0,0],n=0; for (let i=0;i<raw.length/3;i++){ const y=raw[i*3+1]; if (y<y0||y>y1) continue; if ((raw[i*3+2]>0)!==(side==='L')) continue; c[0]+=raw[i*3];c[2]+=raw[i*3+2];n++; } return [c[0]/n, c[2]/n].map(v=>+v.toFixed(3)); };
    out.rawKneeVsThigh_L = { knee: band(-0.66,-0.61,'L'), thigh: band(-0.50,-0.40,'L'), shin: band(-0.85,-0.75,'L') };
    // --- FIX ---  R: (x,z) -> (z,-x)  i.e. RotationY(+90deg): mesh +x (toes/chest) -> -z (game forward), mesh lateral z -> x
    const R = BABYLON.Matrix.RotationY(Math.PI/2);
    const chk = BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(1,0,0), R); out.rotMapsPlusX_to = [chk.x,chk.y,chk.z].map(v=>+v.toFixed(2));
    for (const p of parts) {
      for (const kind of [V.PositionKind, V.NormalKind]) { const d = p.getVerticesData(kind); if (!d) continue; const o = new Float32Array(d.length);
        for (let i=0;i<d.length/3;i++){ const vv=new BABYLON.Vector3(d[i*3],d[i*3+1],d[i*3+2]); const v = kind===V.PositionKind ? BABYLON.Vector3.TransformCoordinates(vv,R) : BABYLON.Vector3.TransformNormal(vv,R); o[i*3]=v.x;o[i*3+1]=v.y;o[i*3+2]=v.z; }
        p.setVerticesData(kind, o, false); }
      const tg = p.getVerticesData(V.TangentKind); if (tg) { const o=new Float32Array(tg.length); for (let i=0;i<tg.length/4;i++){ const v=BABYLON.Vector3.TransformNormal(new BABYLON.Vector3(tg[i*4],tg[i*4+1],tg[i*4+2]),R); o[i*4]=v.x;o[i*4+1]=v.y;o[i*4+2]=v.z;o[i*4+3]=tg[i*4+3]; } p.setVerticesData(V.TangentKind,o,false); }
      p.refreshBoundingInfo(true);
    }
    // relink L<->R (the build swapped sides), then bind := driver
    const mirror = n => n.endsWith('L') ? n.slice(0,-1)+'R' : n.endsWith('R') ? n.slice(0,-1)+'L' : n;
    out.relink = {};
    for (const b of sk.bones) { if (!M[b.name]) continue; const d = M[mirror(b.name)]; const node = d && d.mesh ? d.mesh : d; if (!node) continue; b.linkTransformNode(node); out.relink[b.name] = node.name; }
    for (const b of sk.bones) { const tn = b.getTransformNode(); if (!tn) continue; tn.computeWorldMatrix(true); b.setBindMatrix(tn._localMatrix.clone()); }
    // rest check: where does each bone's bind now sit vs its rotated rest geometry?  (bind translation vs centroid of w>0.95 vertices)
    const byIdx = {}; for (const b of sk.bones) byIdx[b.getIndex()] = b.name;
    const rw = p0.getVerticesData(V.PositionKind), idx = p0.getVerticesData(V.MatricesIndicesKind), w = p0.getVerticesData(V.MatricesWeightsKind);
    const acc = {}; for (let i=0;i<rw.length/3;i++){ let best=0,bw=-1; for (let k=0;k<4;k++) if (w[i*4+k]>bw){bw=w[i*4+k];best=idx[i*4+k];} if (bw<0.95) continue; const a = acc[byIdx[best]] ||= {n:0,c:[0,0,0]}; a.n++; a.c[0]+=rw[i*3];a.c[1]+=rw[i*3+1];a.c[2]+=rw[i*3+2]; }
    out.restGeometryVsBind = {}; for (const [n,a] of Object.entries(acc)) { const b = sk.bones.find(x=>x.name===n); const t = b.getBindMatrix().getTranslation(); out.restGeometryVsBind[n] = { geomCentroid: a.c.map(v=>+(v/a.n).toFixed(3)), bind: [t.x,t.y,t.z].map(v=>+v.toFixed(3)) }; }
    scene.render();
    let blo=null,bhi=null; for (const p of parts){ p.computeWorldMatrix(true); const b=p.getBoundingInfo().boundingBox; blo=blo?BABYLON.Vector3.Minimize(blo,b.minimumWorld):b.minimumWorld.clone(); bhi=bhi?BABYLON.Vector3.Maximize(bhi,b.maximumWorld):b.maximumWorld.clone(); }
    const cam = scene.activeCamera; cam.lowerRadiusLimit=0.05; cam.upperRadiusLimit=200; cam.setTarget(blo.add(bhi).scale(0.5)); cam.radius=2.4; cam.fov=0.8; cam.beta=Math.PI/2.35; cam.alpha=Math.PI*1.30; scene.render();
    window.__M = M; return out;
  });
  await page.screenshot({ path: S + '/yawfix_rest_rear.png' });
  await page.evaluate(() => { const s = BABYLON.EngineStore.LastCreatedScene; s.activeCamera.alpha = Math.PI*0.30; s.render(); });
  await page.screenshot({ path: S + '/yawfix_rest_front.png' });
  await page.evaluate(() => { const s = BABYLON.EngineStore.LastCreatedScene; s.activeCamera.alpha = Math.PI*0.5; s.activeCamera.beta = Math.PI/2; s.render(); });
  await page.screenshot({ path: S + '/yawfix_rest_side.png' });
  await page.evaluate(() => { applyPose(window.__M, 1.0, 1.0, 1.0, 0, 0, 0, false, 0, 0); for (const n of Object.keys(window.__M)) { const m = window.__M[n].mesh || window.__M[n]; m.computeWorldMatrix && m.computeWorldMatrix(true); } const s = BABYLON.EngineStore.LastCreatedScene; s.activeCamera.alpha = Math.PI*0.5; s.activeCamera.radius = 3.0; s.render(); });
  await page.screenshot({ path: S + '/yawfix_tuck_side.png' });
  console.log(JSON.stringify(info));
  await browser.close(); srv.kill();
})().catch(e => { console.error(e); process.exit(1); });
