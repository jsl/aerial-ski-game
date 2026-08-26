const { chromium } = require('/home/justin/Code/aerial-ski-game/node_modules/playwright');
const { spawn } = require('child_process');
(async () => {
  const srv = spawn('python3', ['-m','http.server','8097','--bind','127.0.0.1','--directory','/home/justin/Code/aerial-ski-game'], {stdio:'ignore'});
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox','--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 220 } });
  await page.goto('http://127.0.0.1:8097/index.html');
  await page.waitForFunction(() => window._characterMeshes && window._bodyLinked, null, {timeout: 60000});
  await page.waitForTimeout(2500);
  const out = await page.evaluate(() => {
    const scene = BABYLON.EngineStore.LastCreatedScene;
    const V = BABYLON.VertexBuffer;
    const parts = scene.meshes.filter(m => m.name && m.name.startsWith('athleteBody') && m.skeleton);
    const body = parts[0]; const sk = body.skeleton;
    const res = { babylon: BABYLON.Engine.Version, parts: parts.map(p=>p.name), bones: {}, perBone: {} };
    const dec = (m) => { const s=new BABYLON.Vector3(), q=new BABYLON.Quaternion(), t=new BABYLON.Vector3(); m.decompose(s,q,t);
      const e=q.toEulerAngles(); return { t:[t.x,t.y,t.z].map(v=>+v.toFixed(3)), rDeg:[e.x,e.y,e.z].map(v=>+(v*180/Math.PI).toFixed(1)), s:[s.x,s.y,s.z].map(v=>+v.toFixed(3)) }; };
    sk.computeAbsoluteMatrices ? sk.computeAbsoluteMatrices(true) : sk.computeAbsoluteTransforms(true);
    for (const b of sk.bones) {
      const bind = b.getBindMatrix ? b.getBindMatrix() : b.getBaseMatrix();
      const local = b.getLocalMatrix();
      const abs = b.getAbsoluteMatrix ? b.getAbsoluteMatrix() : b.getAbsoluteTransform();
      // final skinning matrix = inverseBind(absolute) * absolute; if identity, rest == runtime
      const skinM = b.getAbsoluteInverseBindMatrix ? b.getAbsoluteInverseBindMatrix().multiply(abs) : b.getInvertedAbsoluteTransform().multiply(abs);
      res.bones[b.name] = { bind: dec(bind), local: dec(local), skin: dec(skinM), parent: b.getParent() ? b.getParent().name : null };
    }
    // per-bone: displacement of dominant vertices, raw vs skinned
    for (const p of parts) {
      const raw = p.getVerticesData(V.PositionKind);
      const skinned = p.getPositionData ? p.getPositionData(true, false) : null;
      const idx = p.getVerticesData(V.MatricesIndicesKind); const w = p.getVerticesData(V.MatricesWeightsKind);
      if (!raw || !skinned || !idx) continue;
      const acc = {};
      for (let i = 0; i < raw.length/3; i++) {
        let best=0, bw=-1; for (let k=0;k<4;k++) if (w[i*4+k]>bw){bw=w[i*4+k];best=idx[i*4+k];}
        const name = sk.bones[best].name; const a = acc[name] ||= {n:0, d:[0,0,0], rawY:[1e9,-1e9], skY:[1e9,-1e9], rawX:0, skX:0};
        a.n++; for (let c=0;c<3;c++) a.d[c] += skinned[i*3+c]-raw[i*3+c];
        a.rawY=[Math.min(a.rawY[0],raw[i*3+1]),Math.max(a.rawY[1],raw[i*3+1])]; a.skY=[Math.min(a.skY[0],skinned[i*3+1]),Math.max(a.skY[1],skinned[i*3+1])];
        a.rawX += raw[i*3]; a.skX += skinned[i*3];
      }
      for (const [k,a] of Object.entries(acc)) res.perBone[p.name+':'+k] = { n:a.n, meanDelta:a.d.map(v=>+(v/a.n).toFixed(3)), rawY:a.rawY.map(v=>+v.toFixed(3)), skinnedY:a.skY.map(v=>+v.toFixed(3)), rawXmean:+(a.rawX/a.n).toFixed(3), skinnedXmean:+(a.skX/a.n).toFixed(3) };
    }
    return res;
  });
  console.log(JSON.stringify(out));
  await browser.close(); srv.kill();
})().catch(e => { console.error(e); process.exit(1); });
