// Type declarations for the math/detector functions reused from the copied
// apriltag-projector module (apriltag-core.js). Only the exports the host uses
// are declared here; the module's own Tool/DOM/plugins go unused.

export const DETECT_INTERVAL_MS: number;
export const DETECT_MAX_DIM: number;
export const BOARD_MARGIN: number;

export type Point = [number, number];
export type CameraSize = { w: number; h: number };
export type Box = { x: number; y: number; w: number; h: number };

export interface CoreDocState {
  box: Box;
  mode: string;
  gridSize: 4 | 9;
  pairs: Record<string, unknown>;
  homographyCamToBoard: number[] | null;
  homographyBoardToCam: number[] | null;
  cameraCalibrationSize: CameraSize | null;
  activeTargetId: string;
  testMarkers: { board: Point; camera: Point }[];
}

export function makeDefaultDocState(doc: unknown): CoreDocState;
export function normalizeCameraSize(value: unknown): CameraSize | null;

export function solveHomography(srcPts: Point[], dstPts: Point[]): number[] | null;
export function applyHomography(H: number[], point: Point): Point | null;
export function invertHomography(H: number[]): number[] | null;
export function gaussianSolve(A: number[][], b: number[]): number[] | null;

export function getCalibrationTargets(
  gridSize: number,
): { id: string; label: string; board: Point }[];

export function cameraPointToBoard(
  docState: { homographyCamToBoard: number[] | null; cameraCalibrationSize?: CameraSize | null },
  cameraPoint: Point,
  liveSize: CameraSize | null,
): Point | null;

export function boardPointToCamera(
  docState: { homographyBoardToCam: number[] | null; cameraCalibrationSize?: CameraSize | null },
  boardPoint: Point,
  liveSize: CameraSize | null,
): Point | null;

export function projectBoardToStage(box: Box, board: Point): Point;

export function clonePoint(point: Point): Point;
export function cloneSize(size: CameraSize | null): CameraSize | null;

export type CalibrationTarget = { id: string; label: string; board: Point };

export function countCapturedTargets(
  targets: CalibrationTarget[],
  pairs: Record<string, unknown>,
): number;
export function nextIncompleteTargetId(
  targets: CalibrationTarget[],
  pairs: Record<string, unknown>,
  afterId: string,
): string;
export function chooseCalibrationSize(
  targets: CalibrationTarget[],
  pairs: Record<string, unknown>,
  preferredSize: CameraSize | null,
): CameraSize | null;
export function scalePoint(
  point: Point,
  fromSize: CameraSize | null,
  toSize: CameraSize | null,
): Point;
export function solveCameraToBoardHomography(
  targets: CalibrationTarget[],
  pairs: Record<string, unknown>,
  calibrationSize: CameraSize | null,
): number[] | null;
export function computeMeanReprojectionErrorPx(
  targets: CalibrationTarget[],
  pairs: Record<string, unknown>,
  boardToCam: number[] | null,
  calibrationSize: CameraSize | null,
): number | null;
