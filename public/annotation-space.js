export function containedImageRect(boxWidth, boxHeight, naturalWidth, naturalHeight) {
  const width = Number(boxWidth);
  const height = Number(boxHeight);
  const sourceWidth = Number(naturalWidth);
  const sourceHeight = Number(naturalHeight);

  if (![width, height, sourceWidth, sourceHeight].every(Number.isFinite) ||
      width <= 0 || height <= 0 || sourceWidth <= 0 || sourceHeight <= 0) {
    return { x: 0, y: 0, width: Math.max(0, width || 0), height: Math.max(0, height || 0) };
  }

  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const renderedWidth = sourceWidth * scale;
  const renderedHeight = sourceHeight * scale;

  return {
    x: (width - renderedWidth) / 2,
    y: (height - renderedHeight) / 2,
    width: renderedWidth,
    height: renderedHeight
  };
}

export function stagePixelToImageNormalized(stagePoint, imageRect) {
  if (!stagePoint || !imageRect || imageRect.width <= 0 || imageRect.height <= 0) return null;
  const x = Number(stagePoint.x);
  const y = Number(stagePoint.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const right = imageRect.x + imageRect.width;
  const bottom = imageRect.y + imageRect.height;
  if (x < imageRect.x || x > right || y < imageRect.y || y > bottom) return null;

  return {
    x: Math.max(0, Math.min(1, (x - imageRect.x) / imageRect.width)),
    y: Math.max(0, Math.min(1, (y - imageRect.y) / imageRect.height))
  };
}

export function imageNormalizedToStagePixel(point, imageRect) {
  if (!point || !imageRect) return null;
  const x = Number(point.x);
  const y = Number(point.y);
  if (![x, y].every(Number.isFinite)) return null;

  return {
    x: imageRect.x + Math.max(0, Math.min(1, x)) * imageRect.width,
    y: imageRect.y + Math.max(0, Math.min(1, y)) * imageRect.height
  };
}

export function imageNormalizedBoxToStageRect(box, imageRect) {
  if (!box || !imageRect) return null;
  const values = [box.x, box.y, box.width, box.height].map(Number);
  if (!values.every(Number.isFinite)) return null;
  return {
    x: imageRect.x + box.x * imageRect.width,
    y: imageRect.y + box.y * imageRect.height,
    width: box.width * imageRect.width,
    height: box.height * imageRect.height
  };
}
