// Compatibility shim. New code should import from surfaces.js; existing code and
// tests keep the old editor names while stored items still use `editorId`.
export {
  listWindowSurfaces as listEditors,
  surfacesFor as editorsFor,
  loadSurfaceMount as loadEditorMount,
  defaultSurfaceInlets as defaultInlets,
  mountSurface as mountEditor,
  surfaceRole as nodeRole,
  paramsAsInlets,
  effectiveInlets,
  inletDefsFor,
  outletDefsFor,
} from "./surfaces.js";
