import type { Category, ConditionClass } from '../../shared/catalog';

// Значки рисуются на canvas: форма пиктограммы — категория, цвет — состояние,
// косая черта — препятствие (не только цветом), желтая пунктирная рамка — спорная отметка.

export const CLASS_COLOR: Record<ConditionClass, string> = {
  good: '#17805F',
  bad: '#C23A2B',
  unknown: '#6B7480',
};

const SIZE = 36;

function glyph(ctx: CanvasRenderingContext2D, category: Category) {
  ctx.strokeStyle = '#fff';
  ctx.fillStyle = '#fff';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (category === 'curb') {
    ctx.moveTo(9, 24);
    ctx.lineTo(17, 24);
    ctx.lineTo(17, 15);
    ctx.lineTo(27, 15);
    ctx.stroke();
  } else if (category === 'stairs') {
    ctx.moveTo(8, 26);
    ctx.lineTo(13, 26);
    ctx.lineTo(13, 21);
    ctx.lineTo(18, 21);
    ctx.lineTo(18, 16);
    ctx.lineTo(23, 16);
    ctx.lineTo(23, 11);
    ctx.lineTo(28, 11);
    ctx.stroke();
  } else {
    ctx.strokeRect(11, 8, 14, 20);
    ctx.beginPath();
    ctx.moveTo(18, 11);
    ctx.lineTo(15, 15);
    ctx.lineTo(21, 15);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(18, 25);
    ctx.lineTo(15, 21);
    ctx.lineTo(21, 21);
    ctx.closePath();
    ctx.fill();
  }
}

export function iconName(category: Category, cls: ConditionClass, disputed: boolean): string {
  return `${category}-${cls}-${disputed ? 'd' : 'n'}`;
}

export function drawIcon(category: Category, cls: ConditionClass, disputed: boolean, ratio: number): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE * ratio;
  canvas.height = SIZE * ratio;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(ratio, ratio);

  // основа
  ctx.beginPath();
  ctx.arc(18, 18, 15, 0, Math.PI * 2);
  ctx.fillStyle = CLASS_COLOR[cls];
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#fff';
  ctx.stroke();

  glyph(ctx, category);

  if (cls === 'bad') {
    ctx.beginPath();
    ctx.moveTo(8, 8);
    ctx.lineTo(28, 28);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  }
  if (disputed) {
    ctx.beginPath();
    ctx.arc(18, 18, 16.5, 0, Math.PI * 2);
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#FFC400';
    ctx.stroke();
  }
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}
