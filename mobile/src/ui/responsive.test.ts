import { getCompactLayoutMetrics } from "./responsive-metrics";

describe("getCompactLayoutMetrics", () => {
  it("shrinks spacing and controls for very short narrow screens", () => {
    expect(getCompactLayoutMetrics(320, 568)).toMatchObject({
      isNarrow: true,
      isShort: true,
      isVeryShort: true,
      horizontalPadding: 18,
      topPadding: 12,
      sectionGap: 16,
      buttonHeight: 48,
      qrSize: 200,
      numPadKeySize: 58,
      numPadRowGap: 8,
      numPadColGap: 14,
      pinDotGap: 12,
    });
  });

  it("uses medium compact sizes for short but not very short screens", () => {
    expect(getCompactLayoutMetrics(360, 640)).toMatchObject({
      isNarrow: true,
      isShort: true,
      isVeryShort: false,
      horizontalPadding: 18,
      topPadding: 20,
      sectionGap: 20,
      buttonHeight: 52,
      qrSize: 220,
      numPadKeySize: 64,
      numPadRowGap: 10,
      numPadColGap: 18,
      pinDotGap: 18,
    });
  });

  it("keeps default roomy layout on taller screens", () => {
    expect(getCompactLayoutMetrics(390, 844)).toMatchObject({
      isNarrow: false,
      isShort: false,
      isVeryShort: false,
      horizontalPadding: 24,
      topPadding: 32,
      sectionGap: 28,
      buttonHeight: 52,
      qrSize: 240,
      numPadKeySize: 72,
      numPadRowGap: 14,
      numPadColGap: 22,
      pinDotGap: 18,
    });
  });
});
