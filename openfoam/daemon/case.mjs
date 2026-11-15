// An OpenFOAM case directory, as a map of relative path → file text, from a
// run's setup and its hull's measurements. Pure: nothing here touches the
// disk or OpenFOAM, so the tests read the case it would write.
//
// Two analyses, both with the hull fixed at its attitude, kOmegaSST, and
// Spalding's wall function (valid at any y+, so the mesh presets don't have
// to hit a y+ band):
//
//   double-body   simpleFoam, steady. The waterplane z = 0 is a symmetry
//                 plane, so there are no waves: the viscous drag, the form
//                 drag and the flow round the hull. The recipe of the
//                 motorBike tutorial (SIMPLEC, linearUpwind).
//   free-surface  interFoam with local time stepping (LTS) to a steady
//                 state: waves, and their drag. The recipe of the DTCHull
//                 tutorial (ESI v2606: tutorials/multiphase/interFoam/RAS/DTCHull).
//
// Both mesh with blockMesh + snappyHexMesh. The domain and its refinement
// come from setup.js's domainFor(), in hull lengths. A symmetric hull is cut
// at y = 0 (half model, y ≤ 0) unless the setup asks for the full domain.

import { createHash } from "node:crypto";
import { normalizeSetup, waterProperties, domainForHull, hullExtent, isHalfModel, AIR, G } from "../src/setup.js";

const HEADER = (cls, object, location) => `/*--------------------------------*- C++ -*----------------------------------*\\
  Written by patchwork openfoam (daemon/case.mjs)
\\*---------------------------------------------------------------------------*/
FoamFile
{
    version     2.0;
    format      ascii;
    class       ${cls};${location ? `\n    location    "${location}";` : ""}
    object      ${object};
}
`;

/** A number as OpenFOAM reads it: finite, no exponent surprises. */
export const f = (v, digits = 6) => {
  if (!Number.isFinite(v)) throw new Error(`not a finite number: ${v}`);
  const s = Number(v.toPrecision(digits)).toString();
  return s === "-0" ? "0" : s;
};
const vec = (v) => `(${v.map((x) => f(x)).join(" ")})`;

/**
 * Inflow turbulence: 1% intensity, and an eddy-viscosity ratio of 10, the
 * usual choice for a body in a quiet stream (k = 1.5 (I V)², ω = k / (10 ν)).
 */
export function inflowTurbulence(V, nu) {
  const k = 1.5 * (0.01 * V) ** 2;
  const omega = k / (10 * nu);
  return { k, omega, nut: k / omega };
}

export const isHalf = isHalfModel;

/** Everything about a run's case the daemon and the results reader agree on. */
export function caseGeometry(setupIn, info) {
  const setup = normalizeSetup(setupIn);
  const { half, dom } = domainForHull(setup, info);
  const hull = hullExtent(info);
  const water = waterProperties(setup.water, setup.temperature);
  const V = setup.speed;
  const draft = Math.max(info.draft || 0, 0.01 * dom.L);
  const halfBeam = Math.max(info.halfBeamWl || hull.yMax, 0.01 * dom.L);
  const bowX = Number.isFinite(info.wlXMax) ? info.wlXMax : hull.xMax;
  const sternX = Number.isFinite(info.wlXMin) ? info.wlXMin : hull.xMin;
  // the moment reference: mid-length on the waterline
  const cofr = [(hull.xMin + hull.xMax) / 2, 0, 0];
  // streamline seeds: a grid in a plane just ahead of the bow, across the
  // half-breadth and down the draft (y ≤ 0 side; a full model seeds both)
  const seeds = [];
  const ys = [0.12, 0.38, 0.64, 0.9].map((k) => -k * halfBeam * 1.2);
  const zs = [0.1, 0.35, 0.6, 0.85].map((k) => -k * draft);
  const xs = bowX + 0.08 * dom.L;
  for (const y of half ? ys : [...ys, ...ys.map((v) => -v)]) for (const z of zs) seeds.push([xs, y, z]);
  return {
    setup,
    half,
    dom,
    water,
    V,
    draft,
    halfBeam,
    bowX,
    sternX,
    cofr,
    seeds,
    wakeX: sternX - 0.05 * dom.L,
    turbulence: inflowTurbulence(V, water.nu),
    solver: setup.mode === "free-surface" ? "interFoam" : "simpleFoam",
  };
}

const PATCHES = (g) => {
  const free = g.setup.mode === "free-surface";
  return {
    inlet: "patch",
    outlet: "patch",
    bottom: "symmetryPlane",
    side: "symmetryPlane",
    [g.half ? "midPlane" : "otherSide"]: "symmetryPlane",
    [free ? "atmosphere" : "waterplane"]: free ? "patch" : "symmetryPlane",
  };
};

function blockMeshDict(g) {
  const [x0, y0, z0] = g.dom.min;
  const [x1, y1, z1] = g.dom.max;
  const [nx, ny, nz] = g.dom.cells;
  const free = g.setup.mode === "free-surface";
  const top = free ? "atmosphere" : "waterplane";
  const yHigh = g.half ? "midPlane" : "otherSide";
  return `${HEADER("dictionary", "blockMeshDict")}
scale 1;

vertices
(
    ${vec([x0, y0, z0])}
    ${vec([x1, y0, z0])}
    ${vec([x1, y1, z0])}
    ${vec([x0, y1, z0])}
    ${vec([x0, y0, z1])}
    ${vec([x1, y0, z1])}
    ${vec([x1, y1, z1])}
    ${vec([x0, y1, z1])}
);

blocks
(
    hex (0 1 2 3 4 5 6 7) (${nx} ${ny} ${nz}) simpleGrading (1 1 1)
);

boundary
(
    inlet { type patch; faces ((1 2 6 5)); }
    outlet { type patch; faces ((0 4 7 3)); }
    bottom { type symmetryPlane; faces ((0 3 2 1)); }
    side { type symmetryPlane; faces ((0 1 5 4)); }
    ${yHigh} { type symmetryPlane; faces ((3 7 6 2)); }
    ${top} { type ${free ? "patch" : "symmetryPlane"}; faces ((4 5 6 7)); }
);
`;
}

function surfaceFeatureExtractDict() {
  return `${HEADER("dictionary", "surfaceFeatureExtractDict")}
hull.stl
{
    extractionMethod    extractFromSurface;
    includedAngle       150;
    subsetFeatures
    {
        nonManifoldEdges    no;
        openEdges           yes;
    }
    writeObj            no;
}
`;
}

function snappyHexMeshDict(g) {
  const d = g.dom;
  const boxes = d.boxes.map((b, i) => ({ name: `near${i}`, ...b }));
  if (d.freeSurface) {
    boxes.push({ name: "freeSurface", level: d.freeSurface.level, ...d.freeSurface.box });
    if (d.freeSurface.far) boxes.push({ name: "freeSurfaceFar", level: d.freeSurface.far.level, ...d.freeSurface.far.box });
  }
  const layers = d.layers;
  return `${HEADER("dictionary", "snappyHexMeshDict")}
castellatedMesh true;
snap            true;
addLayers       ${layers > 0 ? "true" : "false"};

geometry
{
    hull.stl
    {
        type triSurfaceMesh;
        name hull;
    }
${boxes.map((b) => `    ${b.name}\n    {\n        type searchableBox;\n        min ${vec(b.min)};\n        max ${vec(b.max)};\n    }`).join("\n")}
}

castellatedMeshControls
{
    maxLocalCells       2000000;
    maxGlobalCells      8000000;
    minRefinementCells  0;
    maxLoadUnbalance    0.10;
    nCellsBetweenLevels 3;

    features
    (
        { file "hull.eMesh"; level ${d.hullLevels[1]}; }
    );

    refinementSurfaces
    {
        hull
        {
            level (${d.hullLevels[0]} ${d.hullLevels[1]});
            patchInfo { type wall; }
        }
    }

    resolveFeatureAngle 30;

    refinementRegions
    {
${boxes.map((b) => `        ${b.name} { mode inside; levels ((1e15 ${b.level})); }`).join("\n")}
    }

    locationInMesh ${vec(d.inside)};
    allowFreeStandingZoneFaces true;
}

snapControls
{
    nSmoothPatch        3;
    tolerance           2.0;
    nSolveIter          100;
    nRelaxIter          5;
    nFeatureSnapIter    10;
    implicitFeatureSnap false;
    explicitFeatureSnap true;
    multiRegionFeatureSnap false;
}

addLayersControls
{
    relativeSizes       true;
    layers
    {
        hull { nSurfaceLayers ${Math.max(layers, 1)}; }
    }
    expansionRatio      1.3;
    finalLayerThickness 0.5;
    minThickness        0.1;
    nGrow               0;
    featureAngle        120;
    slipFeatureAngle    30;
    nRelaxIter          5;
    nSmoothSurfaceNormals 1;
    nSmoothNormals      3;
    nSmoothThickness    10;
    maxFaceThicknessRatio 0.5;
    maxThicknessToMedialRatio 0.3;
    minMedialAxisAngle  90;
    nBufferCellsNoExtrude 0;
    nLayerIter          50;
    nRelaxedIter        20;
}

meshQualityControls
{
    #includeEtc "caseDicts/meshQualityDict"
    minFaceWeight 0.02;
    nSmoothScale    4;
    errorReduction  0.75;
    relaxed { maxNonOrtho 75; }
}

mergeTolerance 1e-6;
`;
}

function meshQualityDict() {
  return `${HEADER("dictionary", "meshQualityDict")}
#includeEtc "caseDicts/meshQualityDict"
`;
}

function decomposeParDict(n) {
  return `${HEADER("dictionary", "decomposeParDict")}
numberOfSubdomains ${n};
method             scotch;
`;
}

/** The function objects: forces every iteration, residuals, and at the last write the surfaces and streamlines. */
function functions(g) {
  const free = g.setup.mode === "free-surface";
  const resFields = free ? "(U p_rgh k omega alpha.water)" : "(U p k omega)";
  const sampled = free ? "(p p_rgh U wallShearStress alpha.water)" : "(p U wallShearStress)";
  const [xb0, yb0, zb0] = g.dom.min;
  const [xb1, yb1, zb1] = g.dom.max;
  // the wake plane, cropped to the hull's neighbourhood
  const wakeMin = [g.wakeX - 1, Math.max(yb0, -4 * g.halfBeam), Math.max(zb0, -3 * g.draft)];
  const wakeMax = [g.wakeX + 1, Math.min(yb1, g.half ? 0 : 4 * g.halfBeam), free ? Math.min(zb1, 0.5 * g.draft) : 0];
  const surfaces = [
    `        hull { type patch; patches (hull); interpolate true; }`,
    g.half
      ? `        centreplane { type patch; patches (midPlane); interpolate true; }`
      : `        centreplane { type cuttingPlane; point (0 0 0); normal (0 1 0); interpolate true; }`,
    free
      ? `        freeSurface { type isoSurface; isoField alpha.water; isoValue 0.5; interpolate true; regularise true; }`
      : `        waterplane { type patch; patches (waterplane); interpolate true; }`,
    `        wake { type cuttingPlane; point ${vec([g.wakeX, 0, 0])}; normal (1 0 0); interpolate true; bounds ${vec(wakeMin)} ${vec(wakeMax)}; }`,
  ];
  if (free) surfaces.push(`        depth { type cuttingPlane; point ${vec([0, 0, -0.5 * g.draft])}; normal (0 0 1); interpolate true; }`);
  return `functions
{
    forces
    {
        type            forces;
        libs            (forces);
        patches         (hull);
        ${free ? "rho             rho;" : "rho             rhoInf;"}
        rhoInf          ${f(g.water.rho)};
        CofR            ${vec(g.cofr)};
        writeControl    timeStep;
        writeInterval   1;
        log             false;
    }

    solverInfo
    {
        type            solverInfo;
        libs            (utilityFunctionObjects);
        fields          ${resFields};
        writeResidualFields no;
    }

    yPlus
    {
        type            yPlus;
        libs            (fieldFunctionObjects);
        writeControl    writeTime;
        log             false;
    }

    wallShearStress
    {
        type            wallShearStress;
        libs            (fieldFunctionObjects);
        patches         (hull);
        writeControl    writeTime;
        log             false;
    }

    surfaces
    {
        type            surfaces;
        libs            (sampling);
        writeControl    writeTime;
        surfaceFormat   vtk;
        formatOptions   { vtk { format ascii; legacy true; precision 7; } }
        fields          ${sampled};
        interpolationScheme cellPoint;
        surfaces
        {
${surfaces.join("\n")}
        }
    }

    streamLines
    {
        type            streamLine;
        libs            (fieldFunctionObjects);
        writeControl    writeTime;
        setFormat       vtk;
        formatOptions   { vtk { format ascii; legacy true; precision 7; } }
        direction       forward;
        fields          (U p);
        U               U;
        lifeTime        10000;
        nSubCycle       5;
        cloud           particleTracks;
        seedSampleSet
        {
            type        cloud;
            axis        xyz;
            points
            (
${g.seeds.map((p) => `                ${vec(p)}`).join("\n")}
            );
        }
    }
}
`;
}

function controlDict(g) {
  const n = g.setup.iterations;
  return `${HEADER("dictionary", "controlDict")}
application     ${g.solver};
startFrom       latestTime;
startTime       0;
stopAt          endTime;
endTime         ${n};
deltaT          1;
writeControl    timeStep;
writeInterval   ${n};
purgeWrite      0;
writeFormat     binary;
writePrecision  8;
writeCompression off;
timeFormat      general;
timePrecision   8;
runTimeModifiable yes;

${functions(g)}`;
}

function fvSchemes(g) {
  if (g.setup.mode === "free-surface")
    return `${HEADER("dictionary", "fvSchemes")}
ddtSchemes { default localEuler; }
gradSchemes
{
    default         Gauss linear;
    limitedGrad     cellLimited Gauss linear 1;
}
divSchemes
{
    div(rhoPhi,U)   Gauss linearUpwind grad(U);
    div(phi,alpha)  Gauss vanLeer;
    div(phirb,alpha) Gauss linear;
    div(phi,k)      Gauss linearUpwind limitedGrad;
    div(phi,omega)  Gauss linearUpwind limitedGrad;
    div(((rho*nuEff)*dev2(T(grad(U))))) Gauss linear;
}
laplacianSchemes { default Gauss linear corrected; }
interpolationSchemes { default linear; }
snGradSchemes { default corrected; }
wallDist { method meshWave; }
`;
  return `${HEADER("dictionary", "fvSchemes")}
ddtSchemes { default steadyState; }
gradSchemes
{
    default         Gauss linear;
    grad(U)         cellLimited Gauss linear 1;
}
divSchemes
{
    default         none;
    div(phi,U)      bounded Gauss linearUpwindV grad(U);
    turbulence      bounded Gauss upwind;
    div(phi,k)      $turbulence;
    div(phi,omega)  $turbulence;
    div((nuEff*dev2(T(grad(U))))) Gauss linear;
}
laplacianSchemes { default Gauss linear corrected; }
interpolationSchemes { default linear; }
snGradSchemes { default corrected; }
wallDist { method meshWave; }
`;
}

function fvSolution(g) {
  if (g.setup.mode === "free-surface")
    return `${HEADER("dictionary", "fvSolution")}
solvers
{
    "alpha.water.*"
    {
        nAlphaCorr      2;
        nAlphaSubCycles 1;
        cAlpha          1;
        icAlpha         0;
        MULESCorr       yes;
        nLimiterIter    10;
        alphaApplyPrevCorr yes;
        solver          smoothSolver;
        smoother        symGaussSeidel;
        tolerance       1e-8;
        relTol          0;
        minIter         1;
    }
    "pcorr.*"
    {
        solver          PCG;
        preconditioner { preconditioner GAMG; smoother GaussSeidel; tolerance 1e-5; relTol 0; }
        tolerance       1e-5;
        relTol          0;
    }
    p_rgh
    {
        solver          GAMG;
        smoother        DIC;
        tolerance       1e-7;
        relTol          0.01;
    }
    p_rghFinal { $p_rgh; relTol 0; }
    "(U|k|omega).*"
    {
        solver          smoothSolver;
        smoother        symGaussSeidel;
        nSweeps         1;
        tolerance       1e-7;
        relTol          0.1;
        minIter         1;
    }
}
PIMPLE
{
    momentumPredictor   no;
    nOuterCorrectors    1;
    nCorrectors         2;
    nNonOrthogonalCorrectors 0;
    maxCo               10;
    maxAlphaCo          5;
    rDeltaTSmoothingCoeff 0.05;
    rDeltaTDampingCoeff 0.5;
    nAlphaSpreadIter    0;
    nAlphaSweepIter     0;
    maxDeltaT           1;
}
relaxationFactors { equations { ".*" 1; } }
cache { grad(U); }
`;
  return `${HEADER("dictionary", "fvSolution")}
solvers
{
    p
    {
        solver          GAMG;
        smoother        GaussSeidel;
        tolerance       1e-7;
        relTol          0.01;
    }
    "(U|k|omega)"
    {
        solver          smoothSolver;
        smoother        GaussSeidel;
        tolerance       1e-8;
        relTol          0.1;
        nSweeps         1;
    }
}
SIMPLE
{
    nNonOrthogonalCorrectors 0;
    consistent      yes;
    residualControl
    {
        p               1e-5;
        U               1e-6;
        "(k|omega)"     1e-6;
    }
}
relaxationFactors
{
    equations
    {
        U               0.9;
        k               0.7;
        omega           0.7;
    }
}
cache { grad(U); }
`;
}

function physicalProperties(g) {
  const files = {};
  files["constant/turbulenceProperties"] = `${HEADER("dictionary", "turbulenceProperties")}
simulationType RAS;
RAS
{
    RASModel        kOmegaSST;
    turbulence      on;
    printCoeffs     on;
}
`;
  if (g.setup.mode === "free-surface") {
    files["constant/transportProperties"] = `${HEADER("dictionary", "transportProperties")}
phases (water air);
water { transportModel Newtonian; nu ${f(g.water.nu)}; rho ${f(g.water.rho)}; }
air { transportModel Newtonian; nu ${f(AIR.nu)}; rho ${f(AIR.rho)}; }
sigma 0;
`;
    files["constant/g"] = `${HEADER("uniformDimensionedVectorField", "g")}
dimensions [0 1 -2 0 0 0 0];
value (0 0 ${f(-G)});
`;
    files["constant/hRef"] = `${HEADER("uniformDimensionedScalarField", "hRef")}
dimensions [0 1 0 0 0 0 0];
value 0;
`;
  } else {
    files["constant/transportProperties"] = `${HEADER("dictionary", "transportProperties")}
transportModel Newtonian;
nu ${f(g.water.nu)};
`;
  }
  return files;
}

/** The initial fields (0/), written after snappyHexMesh has made the hull patch. */
export function zeroFiles(g) {
  const free = g.setup.mode === "free-surface";
  const V = g.V;
  const t = g.turbulence;
  const top = free ? "atmosphere" : null;
  const field = (cls, name, dims, internal, bcs) => `${HEADER(cls, name, "0")}
dimensions      ${dims};
internalField   ${internal};
boundaryField
{
    #includeEtc "caseDicts/setConstraintTypes"
${Object.entries(bcs)
  .map(([patch, body]) => `    ${patch}\n    {\n${body.map((l) => `        ${l}`).join("\n")}\n    }`)
  .join("\n")}
}
`;
  const U0 = `uniform (${f(-V)} 0 0)`;
  const files = {};
  const wallTurb = (wf) => [`type ${wf};`, "value $internalField;"];
  const outletIO = ["type inletOutlet;", "inletValue $internalField;", "value $internalField;"];
  files["0/U"] = field("volVectorField", "U", "[0 1 -1 0 0 0 0]", U0, {
    inlet: ["type fixedValue;", "value $internalField;"],
    outlet: free
      ? ["type outletPhaseMeanVelocity;", "alpha alpha.water;", `Umean ${f(V)};`, "value $internalField;"]
      : ["type inletOutlet;", "inletValue uniform (0 0 0);", "value $internalField;"],
    hull: ["type noSlip;"],
    ...(top ? { [top]: ["type pressureInletOutletVelocity;", "value uniform (0 0 0);"] } : {}),
  });
  if (free) {
    files["0/p_rgh"] = field("volScalarField", "p_rgh", "[1 -1 -2 0 0 0 0]", "uniform 0", {
      inlet: ["type fixedFluxPressure;", "value $internalField;"],
      outlet: ["type zeroGradient;"],
      atmosphere: ["type totalPressure;", "p0 uniform 0;"],
      hull: ["type fixedFluxPressure;", "value $internalField;"],
    });
    files["0/alpha.water"] = field("volScalarField", "alpha.water", "[0 0 0 0 0 0 0]", "uniform 0", {
      inlet: ["type fixedValue;", "value $internalField;"],
      outlet: ["type variableHeightFlowRate;", "lowerBound 0;", "upperBound 1;", "value $internalField;"],
      atmosphere: ["type inletOutlet;", "inletValue $internalField;", "value $internalField;"],
      hull: ["type zeroGradient;"],
    });
  } else {
    files["0/p"] = field("volScalarField", "p", "[0 2 -2 0 0 0 0]", "uniform 0", {
      inlet: ["type zeroGradient;"],
      outlet: ["type fixedValue;", "value $internalField;"],
      hull: ["type zeroGradient;"],
    });
  }
  const turbBC = (wf) => ({
    inlet: ["type fixedValue;", "value $internalField;"],
    outlet: outletIO,
    hull: wallTurb(wf),
    ...(top ? { [top]: outletIO } : {}),
  });
  files["0/k"] = field("volScalarField", "k", "[0 2 -2 0 0 0 0]", `uniform ${f(t.k)}`, turbBC("kqRWallFunction"));
  files["0/omega"] = field("volScalarField", "omega", "[0 0 -1 0 0 0 0]", `uniform ${f(t.omega)}`, turbBC("omegaWallFunction"));
  files["0/nut"] = field("volScalarField", "nut", "[0 2 -1 0 0 0 0]", `uniform ${f(t.nut)}`, {
    inlet: ["type calculated;", "value $internalField;"],
    outlet: ["type calculated;", "value $internalField;"],
    hull: ["type nutUSpaldingWallFunction;", "value $internalField;"],
    ...(top ? { [top]: ["type calculated;", "value $internalField;"] } : {}),
  });
  return files;
}

function setFieldsDict() {
  return `${HEADER("dictionary", "setFieldsDict")}
defaultFieldValues ( volScalarFieldValue alpha.water 0 );
regions
(
    boxToCell
    {
        box (-1e9 -1e9 -1e9) (1e9 1e9 0);
        fieldValues ( volScalarFieldValue alpha.water 1 );
    }
    boxToFace
    {
        box (-1e9 -1e9 -1e9) (1e9 1e9 0);
        fieldValues ( volScalarFieldValue alpha.water 1 );
    }
);
`;
}

/**
 * The inlet's conditions at this run's speed, as a changeDictionaryDict: a
 * warm start maps every field from the past run, the inlet's fixed values
 * included (mapFields maps boundary values too), so they are set back to this
 * run's speed and inflow turbulence after mapping.
 */
export function inletResetDict(g) {
  const t = g.turbulence;
  return `${HEADER("dictionary", "changeDictionaryDict")}
U { boundaryField { inlet { type fixedValue; value uniform (${f(-g.V)} 0 0); } } }
k { boundaryField { inlet { type fixedValue; value uniform ${f(t.k)}; } } }
omega { boundaryField { inlet { type fixedValue; value uniform ${f(t.omega)}; } } }
`;
}

/**
 * The case, before meshing: system/ and constant/ (the hull's STL is written
 * separately, as bytes, to constant/triSurface/hull.stl).
 * @returns {{ files: Record<string, string>, geometry: ReturnType<typeof caseGeometry> }}
 */
export function caseFiles(setup, info, { cores = 1 } = {}) {
  const g = caseGeometry(setup, info);
  const files = {
    "system/blockMeshDict": blockMeshDict(g),
    "system/surfaceFeatureExtractDict": surfaceFeatureExtractDict(),
    "system/snappyHexMeshDict": snappyHexMeshDict(g),
    "system/meshQualityDict": meshQualityDict(),
    "system/controlDict": controlDict(g),
    "system/fvSchemes": fvSchemes(g),
    "system/fvSolution": fvSolution(g),
    "system/decomposeParDict": decomposeParDict(Math.max(1, cores)),
    ...physicalProperties(g),
  };
  if (g.setup.mode === "free-surface") files["system/setFieldsDict"] = setFieldsDict();
  return { files, geometry: g, patches: PATCHES(g) };
}

/**
 * A run's recipe: every file the daemon writes to make its OpenFOAM case
 * (the dictionaries and the initial fields), kept in the run doc so the case
 * can be made again without this daemon, and a digest over them and the hull
 * STL, so two runs with the same digest were the same case (whatever their
 * titles or setups say). The STL is in the run already, so it isn't repeated.
 * @param {Record<string, string>} files  path → text
 * @param {Uint8Array} stl
 * @returns {{ digest: string, files: Uint8Array, count: number }}
 */
export function caseRecipe(files, stl) {
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const bytes = new TextEncoder().encode(JSON.stringify(sorted));
  const h = createHash("sha256");
  h.update(bytes);
  h.update(stl);
  return { digest: h.digest("hex"), files: bytes, count: Object.keys(sorted).length };
}
