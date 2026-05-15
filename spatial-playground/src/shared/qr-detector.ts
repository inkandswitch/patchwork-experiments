import type { Point } from '../types.ts';

export type DetectedBarcodeLike = {
  rawValue?: string;
  cornerPoints?: Point[];
};

export type MultiDetector = {
  detect(image: HTMLVideoElement): Promise<DetectedBarcodeLike[]>;
};

const SCAN_MAX_WIDTH = 1920;

export function createWasmDetector(): MultiDetector {
  const scanCanvas = document.createElement('canvas');
  const scanContext = scanCanvas.getContext('2d', { willReadFrequently: true })!;
  let scannerPromise: Promise<any> | null = null;

  return {
    async detect(source) {
      if (!source.videoWidth || !source.videoHeight) {
        return [];
      }

      const { width, height, scaleX, scaleY } = getScanGeometry(
        source.videoWidth,
        source.videoHeight,
      );

      if (scanCanvas.width !== width || scanCanvas.height !== height) {
        scanCanvas.width = width;
        scanCanvas.height = height;
      }

      scanContext.drawImage(source, 0, 0, width, height);
      const imageData = scanContext.getImageData(0, 0, width, height);

      const { getDefaultScanner, scanImageData, ZBarSymbolType, ZBarConfigType } =
        await import('@undecaf/zbar-wasm');

      if (!scannerPromise) {
        scannerPromise = (async () => {
          const scanner = await getDefaultScanner();
          scanner.setConfig(ZBarSymbolType.ZBAR_NONE, ZBarConfigType.ZBAR_CFG_ENABLE, 0);
          scanner.setConfig(ZBarSymbolType.ZBAR_QRCODE, ZBarConfigType.ZBAR_CFG_ENABLE, 1);
          scanner.setConfig(ZBarSymbolType.ZBAR_QRCODE, ZBarConfigType.ZBAR_CFG_X_DENSITY, 1);
          scanner.setConfig(ZBarSymbolType.ZBAR_QRCODE, ZBarConfigType.ZBAR_CFG_Y_DENSITY, 1);
          scanner.setConfig(ZBarSymbolType.ZBAR_QRCODE, ZBarConfigType.ZBAR_CFG_UNCERTAINTY, 1);
          return scanner;
        })();
      }

      const scanner = await scannerPromise;
      const symbols = await scanImageData(imageData, scanner);

      return symbols
        .filter((symbol: any) => symbol.type === ZBarSymbolType.ZBAR_QRCODE)
        .map((symbol: any) => ({
          rawValue: symbol.decode(),
          cornerPoints: symbol.points.map((point: any) => ({
            x: point.x * scaleX,
            y: point.y * scaleY,
          })),
        }));
    },
  };
}

function getScanGeometry(sourceWidth: number, sourceHeight: number) {
  if (sourceWidth <= SCAN_MAX_WIDTH) {
    return { width: sourceWidth, height: sourceHeight, scaleX: 1, scaleY: 1 };
  }

  const scale = SCAN_MAX_WIDTH / sourceWidth;
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  return { width, height, scaleX: sourceWidth / width, scaleY: sourceHeight / height };
}
