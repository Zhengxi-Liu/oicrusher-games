/**
 * mergeStatic(root, opts) - fewer draw calls, the same picture.
 *
 * Every Mesh is a draw call (two with shadows on: the main pass and the shadow pass), and the models here are built from hundreds of small
 * parts (a plane ~200, a carrier ~250, an airfield ~250). On a slow computer the per-call cost of WebGL - not the triangles - is what makes the
 * game lag. This bakes sibling meshes that can never move or change apart from each other into one mesh per material:
 *   - only leaf meshes (no children) under the same parent, so anything that moves (a control surface, the prop, a gear leg, a gun mount)
 *     still moves: its own parts merge together under it and ride along
 *   - the same material object and the same shadow / render flags, so the look is identical (the material is shared, not copied)
 *   - never: transparent materials (their draw order matters), instanced / skinned / morphing meshes, invisible meshes, meshes with a name or
 *     userData (code finds those), meshes referenced from `keep` (code toggles or moves those)
 * Returns {saved: draw calls saved, undo()}: undo() puts the original parts back (the crash break-up flies an aircraft's real parts apart).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Every Object3D reachable from the plain objects / arrays of `src` (a model's handle object, a scene builder's fields). */
export function referenced(src, out = new Set(), depth = 0, seen = new Set()) {
  if (!src || typeof src !== 'object' || seen.has(src) || depth > 5) return out;
  seen.add(src);
  if (src.isObject3D || src.isMaterial) { out.add(src); return out; }
  if (src.isTexture || src.isBufferGeometry || ArrayBuffer.isView(src)) return out;
  for (const v of Array.isArray(src) ? src : Object.values(src)) if (v && typeof v === 'object') referenced(v, out, depth + 1, seen);
  return out;
}

/** What a material looks like (byLook: two materials built with the same settings draw the same, so their meshes can share one). */
const LOOK = ['type', 'roughness', 'metalness', 'opacity', 'transparent', 'side', 'flatShading', 'vertexColors', 'alphaTest', 'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits',
  'depthWrite', 'depthTest', 'fog', 'wireframe', 'envMapIntensity', 'toneMapped', 'blending', 'emissiveIntensity', 'shininess', 'clearcoat', 'sheen', 'transmission', 'dithering', 'visible'];
const MAPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap', 'bumpMap', 'envMap', 'lightMap', 'specularMap', 'displacementMap'];
function lookKey(m) {
  if (m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile || m.defines && Object.keys(m.defines).length || m.isShaderMaterial || m.clippingPlanes) return m.uuid;
  let k = LOOK.map(p => m[p]).join('|');
  for (const c of ['color', 'emissive', 'specular', 'sheenColor']) if (m[c] && m[c].isColor) k += '|' + m[c].r.toFixed(5) + ',' + m[c].g.toFixed(5) + ',' + m[c].b.toFixed(5);
  for (const t of MAPS) k += '|' + (m[t] ? m[t].uuid : '');
  if (m.normalScale) k += '|' + m.normalScale.x + ',' + m.normalScale.y;
  return k;
}
const attrSig = g => Object.keys(g.attributes).sort().map(k => k + g.attributes[k].itemSize + (g.attributes[k].normalized ? 'n' : '')).join(',') + (g.index ? '|i' : '|n') + '|' + Object.keys(g.morphAttributes).length;

export function mergeStatic(root, { keep = new Set(), byLook = false } = {}) {
  let saved = 0; const undo = [];
  const parents = [];
  root.traverse(o => { if (o.children.length > 1) parents.push(o); });
  for (const p of parents) {
    const groups = new Map();
    for (const m of p.children) {
      if (!m.isMesh || m.isInstancedMesh || m.isSkinnedMesh || m.children.length || !m.visible || keep.has(m) || m.name || Object.keys(m.userData).length
          || Array.isArray(m.material) || m.material.transparent || m.morphTargetInfluences || m.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender
          || !m.geometry.attributes.position || m.geometry.groups.length > 1 || !m.matrixAutoUpdate && !m.matrix) continue;
      const k = (byLook && !keep.has(m.material) ? lookKey(m.material) : m.material.uuid) + '|' + m.castShadow + m.receiveShadow + '|' + m.renderOrder + '|' + m.layers.mask + '|' + m.frustumCulled + '|' + attrSig(m.geometry);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(m);
    }
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const geos = list.map(m => { m.updateMatrix(); const g = m.geometry.clone(); g.applyMatrix4(m.matrix); g.groups.length = 0; return g; });
      let merged = null;
      try { merged = mergeGeometries(geos, false); } catch (e) { merged = null; }
      geos.forEach(g => g.dispose());
      if (!merged) continue;
      const a = list[0], mesh = new THREE.Mesh(merged, a.material);
      mesh.castShadow = a.castShadow; mesh.receiveShadow = a.receiveShadow; mesh.renderOrder = a.renderOrder; mesh.layers.mask = a.layers.mask; mesh.frustumCulled = a.frustumCulled;
      const at = p.children.indexOf(a);
      for (const m of list) p.remove(m);
      p.add(mesh); p.children.splice(p.children.length - 1, 1); p.children.splice(Math.min(at, p.children.length), 0, mesh);
      saved += list.length - 1;
      undo.push(() => { if (mesh.parent !== p) return; p.remove(mesh); for (const m of list) p.add(m); merged.dispose(); });
    }
  }
  return { saved, undo: () => { while (undo.length) undo.pop()(); } };
}

/**
 * fixDoubleSided(root) - the same picture without three.js re-validating shaders every frame.
 * three.js draws a transparent DoubleSide material in two passes (back faces, then front), flipping material.side and setting needsUpdate
 * each time: every such object re-runs the program lookup twice a frame (CPU time and garbage). Here:
 *   - additive blending (order does not matter) and flat geometry (a plane / disc / ribbon cannot overlap itself): one pass draws exactly the same
 *   - anything else (a closed glass canopy): the mesh itself draws the back faces and a child copy draws the front faces right after it
 *     (same position, same render order, a later id: the renderer's sort puts it straight after) - what the two passes did, without the flips
 */
const FLAT = new Set(['PlaneGeometry', 'CircleGeometry', 'RingGeometry', 'ShapeGeometry']);
export function fixDoubleSided(root) {
  const split = new Map(), todo = [];
  root.traverse(o => {
    const m = o.material;
    if (!o.isMesh || !m || Array.isArray(m) || !m.transparent || m.side !== THREE.DoubleSide || m.forceSinglePass || o.userData.dsFront) return;
    if (m.blending === THREE.AdditiveBlending || FLAT.has(o.geometry.type) || o.userData.flat) { m.forceSinglePass = true; return; }
    todo.push(o);
  });
  for (const o of todo) {
    const m = o.material;
    if (!split.has(m)) { const b = m.clone(), f = m.clone(); b.side = THREE.BackSide; f.side = THREE.FrontSide; split.set(m, [b, f]); }
    const [b, f] = split.get(m), front = new THREE.Mesh(o.geometry, f);
    front.userData.dsFront = true; front.castShadow = o.castShadow; front.receiveShadow = o.receiveShadow; front.renderOrder = o.renderOrder; front.frustumCulled = o.frustumCulled;
    o.material = b; o.add(front);
  }
  return todo.length;
}
