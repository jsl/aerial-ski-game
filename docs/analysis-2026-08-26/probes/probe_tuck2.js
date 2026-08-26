const { chromium } = require('/home/justin/Code/aerial-ski-game/node_modules/playwright');
const { spawn } = require('child_process');
const S = 'OUT_DIR';
async function runMode(browser, mode) {
  const page = await browser.newPage({ viewport: { width: 320, height: 220 } });
  await page.goto('http://127.0.0.1:8094/index.html');
  await page.waitForFunction(() => window._characterMeshes && window._bodyLinked && window._surfacesApplied !== undefined, null, {timeout: 60000});
  await page.waitForTimeout(2000);
  await page.evaluate(() => { for (const el of document.querySelectorAll('body > *')) if (el.id !== 'renderCanvas') el.style.display = 'none'; });
  await page.setViewportSize({ width: 900, height: 700 });
  await page.evaluate(() => BABYLON.EngineStore.LastCreatedScene.getEngine().resize());
  await page.waitForTimeout(300);
  const out = await page.evaluate((mode) => {
    const scene = BABYLON.EngineStore.LastCreatedScene; const V = BABYLON.VertexBuffer;
    const parts = scene.meshes.filter(m => m.name && m.name.startsWith('athleteBody') && m.skeleton); const sk = parts[0].skeleton;
    const M = window._characterMeshes; const root = parts[0].parent;
    const info = {};
    const q2e = (n) => { const q = n.rotationQuaternion; if (q) return q.toEulerAngles().asArray().map(v=>+(v*180/Math.PI).toFixed(1)); return [n.rotation.x,n.rotation.y,n.rotation.z].map(v=>+(v*180/Math.PI).toFixed(1)); };
    info.bodyLocalRot = q2e(parts[0]); info.rootWorldRot = (()=>{const s=new BABYLON.Vector3(),q=new BABYLON.Quaternion(),t=new BABYLON.Vector3(); root.computeWorldMatrix(true); root.getWorldMatrix().decompose(s,q,t); return q.toEulerAngles().asArray().map(v=>+(v*180/Math.PI).toFixed(1));})();
    info.rootName = root.name;
    if (mode === 'bind=driver') { for (const b of sk.bones) { const tn = b.getTransformNode(); if (!tn) continue; tn.computeWorldMatrix(true); b.setBindMatrix(tn._localMatrix.clone()); } }
    if (mode === 'unyaw') { for (const p of parts) { p.rotationQuaternion = null; p.rotation.set(0,0,0); p.computeWorldMatrix(true); } }
    const measure = (tag) => {
      for (const n of Object.keys(M)) { const m = M[n] && M[n].mesh ? M[n].mesh : M[n]; m && m.computeWorldMatrix && m.computeWorldMatrix(true); }
      scene.render();
      const byIdx = {}; for (const b of sk.bones) byIdx[b.getIndex()] = b.name;
      root.computeWorldMatrix(true); const rootInv = root.getWorldMatrix().clone().invert();
      const acc = {};
      for (const p of parts) { p.computeWorldMatrix(true); const wm = p.getWorldMatrix();
        const skd = p.getPositionData(true, false); const idx = p.getVerticesData(V.MatricesIndicesKind), w = p.getVerticesData(V.MatricesWeightsKind);
        for (let i = 0; i < skd.length/3; i++) { let best=0,bw=-1; for (let k=0;k<4;k++) if (w[i*4+k]>bw){bw=w[i*4+k];best=idx[i*4+k];}
          const name = byIdx[best]; const a = acc[name] ||= {n:0,c:[0,0,0]};
          const wp = BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(skd[i*3],skd[i*3+1],skd[i*3+2]), wm);
          const lp = BABYLON.Vector3.TransformCoordinates(wp, rootInv); a.n++; a.c[0]+=lp.x; a.c[1]+=lp.y; a.c[2]+=lp.z; } }
      const res = {};
      for (const [n,a] of Object.entries(acc)) { const m = M[n] && M[n].mesh ? M[n].mesh : M[n]; if (!m) continue; const d = m.position;
        res[n] = { skinned: a.c.map(v=>+(v/a.n).toFixed(3)), driver: [d.x,d.y,d.z].map(v=>+v.toFixed(3)), err: +Math.hypot(a.c[0]/a.n-d.x, a.c[1]/a.n-d.y, a.c[2]/a.n-d.z).toFixed(3) }; }
      return res;
    };
    info.rest = measure('rest');
    applyPose(M, 1.0, 1.0, 1.0, 0, 0, 0, false, 0, 0);
    info.tuck = measure('tuck');
    // camera side view
    const cam = scene.activeCamera; cam.lowerRadiusLimit=0.05; cam.upperRadiusLimit=200; cam.setTarget(root.getAbsolutePosition().add(new BABYLON.Vector3(0,-0.25,0))); cam.radius=3.0; cam.fov=0.8; cam.beta=Math.PI/2.1; cam.alpha=Math.PI; scene.render();
    return info;
  }, mode);
  await page.screenshot({ path: `${S}/tuck_${mode.replace('=','_')}.png` });
  await page.close();
  return out;
}
(async () => {
  const srv = spawn('python3', ['-m','http.server','8094','--bind','127.0.0.1','--directory','/home/justin/Code/aerial-ski-game'], {stdio:'ignore'});
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox','--no-sandbox'] });
  const res = {}; for (const mode of ['asis','bind=driver','unyaw']) res[mode] = await runMode(browser, mode);
  console.log(JSON.stringify(res));
  await browser.close(); srv.kill();
})().catch(e => { console.error(e); process.exit(1); });
