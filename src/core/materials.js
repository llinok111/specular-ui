/**
 * specular-ui · material registry
 *
 * A material is a design decision, not a knob. Each entry fixes what the surface
 * is physically made of and how much it is allowed to bend light. The CSS layer
 * (styles/materials.css) reads `[data-material]`; this table only supplies the
 * numbers the JS layer needs to build the refractive filter.
 *
 * `family` drives the fallback logic:
 *   refractive — depends on a displacement filter; degrades to a tinted plate
 *   opaque     — never uses the backdrop; degrades to a flat gradient
 */

export const MATERIALS = {
  liquid: {
    id: "liquid",
    label: "液态玻璃",
    labelEn: "Liquid glass",
    family: "refractive",
    note: "Rounded-rect lens with wavelength-split rim.",
    refraction: { profile: "lens", scale: 58, aberration: 0.55, chromatic: false },
  },
  metal: {
    id: "metal",
    label: "拉丝金属",
    labelEn: "Brushed metal",
    family: "opaque",
    note: "Anisotropic conic band rotated by the light azimuth.",
    refraction: null,
  },
  frost: {
    id: "frost",
    label: "磨砂玻璃",
    labelEn: "Ground glass",
    family: "refractive",
    note: "Heavy blur, fine noise tooth, shallow bend.",
    refraction: { profile: "lens-soft", scale: 22, aberration: 0.18, chromatic: false },
  },
  holo: {
    id: "holo",
    label: "全息膜",
    labelEn: "Holographic film",
    family: "refractive",
    note: "Interference spectrum over a dark substrate.",
    refraction: { profile: "lens-tight", scale: 34, aberration: 0.4, chromatic: false },
  },
};

export const MATERIAL_IDS = Object.keys(MATERIALS);
export const DEFAULT_MATERIAL = "liquid";

export function isMaterial(id) {
  return Object.prototype.hasOwnProperty.call(MATERIALS, id);
}

/** Coerce anything to a valid material id. Unknown values fall back, not throw. */
export function resolveMaterial(id) {
  return isMaterial(id) ? id : DEFAULT_MATERIAL;
}

export function refractionSpec(id) {
  return MATERIALS[resolveMaterial(id)].refraction;
}

/** Ambience presets — duplicated in tokens.css, mirrored here for the API/JS. */
export const AMBIENCES = {
  dusk: { id: "dusk", label: "黄昏工作室", labelEn: "Dusk" },
  studio: { id: "studio", label: "冷调影棚", labelEn: "Studio" },
  neon: { id: "neon", label: "霓虹夜", labelEn: "Neon" },
  paper: { id: "paper", label: "纸本", labelEn: "Paper" },
};

export const AMBIENCE_IDS = Object.keys(AMBIENCES);

/** Apply an ambience to a root element. */
export function applyAmbience(id, root) {
  const el = root || (typeof document !== "undefined" ? document.documentElement : null);
  if (!el) return null;
  const next = AMBIENCES[id] ? id : "dusk";
  el.dataset.spAmbience = next;
  return next;
}
