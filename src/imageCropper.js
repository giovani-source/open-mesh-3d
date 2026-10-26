/**
 * Forge3D - Detector Inteligente de Poses e Personagens (Turnaround Sheet)
 * Detecta automaticamente se a imagem enviada contém múltiplas vistas (Frente, Costas, Perfil)
 * e isola o personagem frontal para reconstrução 3D neural perfeita.
 */

export class CharacterSheetDetector {
  /**
   * Analisa a imagem e identifica se há múltiplas poses/personagens lado a lado
   */
  static detectCharacters(imgElement) {
    const canvas = document.createElement('canvas');
    const w = imgElement.naturalWidth || imgElement.width || 300;
    const h = imgElement.naturalHeight || imgElement.height || 300;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(imgElement, 0, 0);

    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    // Detectar cores de fundo: bordas externas e cor predominante de papel/fundo
    const colorBins = new Map();
    for (let i = 0; i < w * h; i++) {
      if (data[i * 4 + 3] < 40) continue;
      const r = Math.floor(data[i * 4] / 20) * 20;
      const g = Math.floor(data[i * 4 + 1] / 20) * 20;
      const b = Math.floor(data[i * 4 + 2] / 20) * 20;
      const key = `${r},${g},${b}`;
      colorBins.set(key, (colorBins.get(key) || 0) + 1);
    }

    const sortedBins = Array.from(colorBins.entries()).sort((a, b) => b[1] - a[1]);
    const bgCandidates = [];

    // Amostrar bordas externas
    let bgR = 0, bgG = 0, bgB = 0, sampleCount = 0;
    const addSample = (x, y) => {
      const idx = (y * w + x) * 4;
      if (data[idx + 3] > 40) {
        bgR += data[idx];
        bgG += data[idx + 1];
        bgB += data[idx + 2];
        sampleCount++;
      }
    };
    for (let x = 0; x < w; x += 3) {
      addSample(x, 0);
      addSample(x, h - 1);
    }
    for (let y = 0; y < h; y += 3) {
      addSample(0, y);
      addSample(w - 1, y);
    }

    if (sampleCount > 0) {
      bgCandidates.push({ r: bgR / sampleCount, g: bgG / sampleCount, b: bgB / sampleCount, tol: 38 });
    }

    // Cores dominantes (> 15%) de papel claro ou fundo
    for (let [key, count] of sortedBins.slice(0, 3)) {
      if (count > (w * h) * 0.15) {
        const [r, g, b] = key.split(',').map(Number);
        const brightness = (r + g + b) / 3;
        if (brightness > 190 || brightness < 45 || count > (w * h) * 0.35) {
          const exists = bgCandidates.some(c => Math.sqrt((c.r - r)**2 + (c.g - g)**2 + (c.b - b)**2) < 35);
          if (!exists) {
            bgCandidates.push({ r, g, b, tol: 40 });
          }
        }
      }
    }

    const isForeground = (x, y) => {
      const idx = (y * w + x) * 4;
      const alpha = data[idx + 3];
      if (alpha < 40) return false;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      for (let cand of bgCandidates) {
        const dist = Math.sqrt((r - cand.r) ** 2 + (g - cand.g) ** 2 + (b - cand.b) ** 2);
        if (dist <= cand.tol) return false;
      }
      return true;
    };

    // Histograma horizontal de colunas com pixels visíveis
    const colDensity = new Int32Array(w);
    for (let x = 0; x < w; x++) {
      let count = 0;
      for (let y = 0; y < h; y++) {
        if (isForeground(x, y)) count++;
      }
      colDensity[x] = count;
    }

    // Segmentar colunas ativas separadas por espaços em branco
    const threshold = Math.max(4, Math.round(h * 0.05));
    const segments = [];
    let inSegment = false;
    let segStart = 0;

    for (let x = 0; x < w; x++) {
      if (colDensity[x] >= threshold) {
        if (!inSegment) {
          inSegment = true;
          segStart = x;
        }
      } else {
        if (inSegment) {
          inSegment = false;
          if (x - segStart > w * 0.06) {
            segments.push({ startX: segStart, endX: x });
          }
        }
      }
    }
    if (inSegment && (w - segStart > w * 0.06)) {
      segments.push({ startX: segStart, endX: w });
    }

    // Se detectou 2 a 4 figuras separadas (Turnaround de personagem: Costas, Frente, Lado)
    if (segments.length >= 2 && segments.length <= 4) {
      const views = segments.map((seg, idx) => {
        let minY = h, maxY = 0;
        for (let x = seg.startX; x < seg.endX; x++) {
          for (let y = 0; y < h; y++) {
            if (isForeground(x, y)) {
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }

        if (minY >= maxY) {
          minY = 0;
          maxY = h;
        }

        // Adiciona 12% de margem suave para não cortar orelhas ou pés
        const segW = seg.endX - seg.startX;
        const segH = maxY - minY;
        const padX = Math.round(segW * 0.12);
        const padY = Math.round(segH * 0.12);

        const cropX = Math.max(0, seg.startX - padX);
        const cropY = Math.max(0, minY - padY);
        const cropW = Math.min(w - cropX, segW + padX * 2);
        const cropH = Math.min(h - cropY, segH + padY * 2);

        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = cropW;
        cropCanvas.height = cropH;
        const cropCtx = cropCanvas.getContext('2d');
        
        // Fundo limpo
        cropCtx.fillStyle = `rgb(${Math.round(bgR)}, ${Math.round(bgG)}, ${Math.round(bgB)})`;
        cropCtx.fillRect(0, 0, cropW, cropH);
        cropCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

        let label = `Pose ${idx + 1}`;
        let isRecommended = false;

        if (segments.length === 3) {
          if (idx === 0) label = 'Costas';
          else if (idx === 1) { label = 'Frente'; isRecommended = true; }
          else if (idx === 2) label = 'Perfil (Lado)';
        } else if (segments.length === 2) {
          if (idx === 0) { label = 'Frente'; isRecommended = true; }
          else if (idx === 1) label = 'Perfil';
        }

        return {
          id: idx,
          label,
          isRecommended,
          canvas: cropCanvas,
          dataUrl: cropCanvas.toDataURL('image/png'),
          cropRect: { x: cropX, y: cropY, width: cropW, height: cropH }
        };
      });

      return {
        hasMultiple: true,
        count: views.length,
        views
      };
    }

    return {
      hasMultiple: false,
      count: 1,
      views: []
    };
  }
}
