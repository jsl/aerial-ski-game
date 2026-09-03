# Fable probe (267 boundary): rest-asset leg profile vs the left boot from the GLB (glTF y-up; +z = forward/toe). Run with Blender python: ~/opt/blender-5.2.1-linux-x64/5.2/python/bin/python3.13 tools/glb_leg_profile.py assets/athlete_body.glb
import struct, json, numpy as np, sys
d=open(sys.argv[1] if len(sys.argv)>1 else 'assets/athlete_body.glb','rb').read()
L=struct.unpack('<I',d[12:16])[0]; js=json.loads(d[20:20+L]); off=20+L+8; bin_=d[off:off+struct.unpack('<I',d[20+L:24+L])[0]]
def acc(i):
    a=js['accessors'][i]; bv=js['bufferViews'][a['bufferView']]; st=bv.get('byteOffset',0)+a.get('byteOffset',0)
    n=a['count']; comp={5126:('f4',4),5123:('u2',2),5121:('u1',1),5125:('u4',4)}[a['componentType']]; k={'VEC3':3,'VEC4':4,'SCALAR':1,'MAT4':16}[a['type']]
    stride=bv.get('byteStride',comp[1]*k); assert stride==comp[1]*k
    return np.frombuffer(bin_[st:st+stride*n],dtype=comp[0]).reshape(n,k)
skin=js['skins'][0]; names=[js['nodes'][j]['name'] for j in skin['joints']]
def meshverts(nm):
    for nd in js['nodes']:
        if nd['name']==nm and 'mesh' in nd:
            m=js['meshes'][nd['mesh']]; P=[];J=[];Wt=[]
            for pr in m['primitives']:
                P.append(acc(pr['attributes']['POSITION']))
                if 'JOINTS_0' in pr['attributes']: J.append(acc(pr['attributes']['JOINTS_0'])); Wt.append(acc(pr['attributes']['WEIGHTS_0']))
            return np.vstack(P),(np.vstack(J) if J else None),(np.vstack(Wt) if Wt else None)
bP,bJ,bW=meshverts('athleteBody'); bootP,_,_=meshverts('athleteBootL')
li=names.index('lowerLegL')
print('boot L: x %.3f..%.3f y %.3f..%.3f z %.3f..%.3f'%(bootP[:,0].min(),bootP[:,0].max(),bootP[:,1].min(),bootP[:,1].max(),bootP[:,2].min(),bootP[:,2].max()))
cx=bootP[:,0].mean(); cz=(bootP[:,2].min()+bootP[:,2].max())/2; y0=bootP[:,1].min()
w=(bW*(bJ==li)).sum(1); near=np.abs(bP[:,0]-cx)<0.14
print('lowerLegL-dominant verts:',int((w>0.5).sum()))
for h in np.arange(0,0.65,0.05):
    s=near&(bP[:,1]>=y0+h)&(bP[:,1]<y0+h+0.05)
    if s.sum(): print(' h %.2f  n %4d  z-cz mean %+.3f  min %+.3f max %+.3f   x-cx %+.3f  wLL %.2f'%(h,s.sum(),(bP[s,2]-cz).mean(),(bP[s,2]-cz).min(),(bP[s,2]-cz).max(),(bP[s,0]-cx).mean(),w[s].mean()))
ibm=acc(skin['inverseBindMatrices'])
for nm in ['upperLegL','hlpKneeL','lowerLegL']:
    i=names.index(nm); M=np.array(ibm[i],dtype=float).reshape(4,4).T; pos=np.linalg.inv(M)[:3,3]; print(nm,'rest head',np.round(pos,3),' rel boot centre z %+.3f'%(pos[2]-cz))
