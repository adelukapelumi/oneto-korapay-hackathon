export interface CompactLayoutMetrics {
  readonly width: number;
  readonly height: number;
  readonly isNarrow: boolean;
  readonly isShort: boolean;
  readonly isVeryShort: boolean;
  readonly horizontalPadding: number;
  readonly topPadding: number;
  readonly sectionGap: number;
  readonly buttonHeight: number;
  readonly qrSize: number;
  readonly numPadKeySize: number;
  readonly numPadRowGap: number;
  readonly numPadColGap: number;
  readonly pinDotGap: number;
}

export function getCompactLayoutMetrics(
  width: number,
  height: number,
): CompactLayoutMetrics {
  const isNarrow = width <= 360;
  const isShort = height <= 650;
  const isVeryShort = height <= 590;

  return {
    width,
    height,
    isNarrow,
    isShort,
    isVeryShort,
    horizontalPadding: isNarrow ? 18 : 24,
    topPadding: isVeryShort ? 12 : isShort ? 20 : 32,
    sectionGap: isVeryShort ? 16 : isShort ? 20 : 28,
    buttonHeight: isVeryShort ? 48 : 52,
    qrSize: isVeryShort ? 200 : isShort ? 220 : 240,
    numPadKeySize: isVeryShort ? 58 : isShort ? 64 : 72,
    numPadRowGap: isVeryShort ? 8 : isShort ? 10 : 14,
    numPadColGap: isVeryShort ? 14 : isShort ? 18 : 22,
    pinDotGap: isVeryShort ? 12 : 18,
  };
}
