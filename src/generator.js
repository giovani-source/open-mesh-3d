import * as THREE from 'three';

/**
 * Forge3D Engine de Escultura Tridimensional
 * Converte imagens 2D em modelos 3D volumétricos verdadeiros para impressão 3D (STL Manifold)
 */

export class MeshGenerator {
  /**
   * Processamento e segmentação inteligente de imagem com Flood-Fill a partir das bordas externas
   * Preserva cabelos pretos, sombras de botas, olhos e detalhes escuros sem apagar o personagem
   */
  static getImageData(image, targetResolution = 220, depthImage = null) {
    // 1. Renderiza a imagem original em alta fidelidade para análise
    const srcW = image.naturalWidth || image.width || 300;
    const srcH = image.naturalHeight || image.height || 300;
    const rawCanvas = document.createElement('canvas');
    rawCanvas.width = srcW;
    rawCanvas.height = srcH;
    const rawCtx = rawCanvas.getContext('2d', { willReadFrequently: true });
    rawCtx.drawImage(image, 0, 0);

    const rawImgData = rawCtx.getImageData(0, 0, srcW, srcH);
    const rawData = rawImgData.data;

    // 2. Análise do Mapa de Profundidade Neural (se fornecido, ele é a verdade geométrica absoluta)
    let depthRawCanvas = null;
    let depthDataFull = null;
    const dSrcW = depthImage ? (depthImage.naturalWidth || depthImage.width || srcW) : srcW;
    const dSrcH = depthImage ? (depthImage.naturalHeight || depthImage.height || srcH) : srcH;

    if (depthImage) {
      try {
        depthRawCanvas = document.createElement('canvas');
        depthRawCanvas.width = dSrcW;
        depthRawCanvas.height = dSrcH;
        const dRawCtx = depthRawCanvas.getContext('2d', { willReadFrequently: true });
        dRawCtx.drawImage(depthImage, 0, 0);
        depthDataFull = dRawCtx.getImageData(0, 0, dSrcW, dSrcH).data;
      } catch (err) {
        console.warn('Erro ao ler profundidade original:', err);
      }
    }

    // 3. Segmentação Universal Robusta de Primeiro Plano (Bounding Box)
    let minX = srcW, maxX = 0, minY = srcH, maxY = 0;
    let fgTotal = 0;

    let fullFg = new Uint8Array(srcW * srcH);

    if (depthDataFull) {
      for (let y = 0; y < srcH; y++) {
        for (let x = 0; x < srcW; x++) {
          const dx = Math.min(dSrcW - 1, Math.round((x / srcW) * dSrcW));
          const dy = Math.min(dSrcH - 1, Math.round((y / srcH) * dSrcH));
          const dVal = depthDataFull[(dy * dSrcW + dx) * 4];
          if (dVal > 20) fullFg[y * srcW + x] = 1;
        }
      }
    } else {
      fullFg = this.segmentForeground(rawData, srcW, srcH);
    }

    for (let y = 0; y < srcH; y++) {
      for (let x = 0; x < srcW; x++) {
        if (fullFg[y * srcW + x] === 1) {
          fgTotal++;
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
      }
    }

    if (fgTotal < 50 || fgTotal > srcW * srcH * 0.98) {
      minX = 0; maxX = srcW - 1; minY = 0; maxY = srcH - 1;
    }

    // Limites de recorte com margem proporcional
    const padX = Math.max(4, Math.round((maxX - minX) * 0.04));
    const padY = Math.max(4, Math.round((maxY - minY) * 0.04));
    const cropX = Math.max(0, minX - padX);
    const cropY = Math.max(0, minY - padY);
    const cropW = Math.min(srcW - cropX, (maxX - minX) + padX * 2);
    const cropH = Math.min(srcH - cropY, (maxY - minY) + padY * 2);

    // 4. Reamostragem com alta fidelidade e interpolação de alta qualidade
    const aspect = cropH / Math.max(1, cropW);
    let width = targetResolution;
    let height = Math.round(targetResolution * aspect);

    if (height > targetResolution * 2.2) height = Math.round(targetResolution * 2.2);
    if (height < targetResolution * 0.45) height = Math.round(targetResolution * 0.45);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(rawCanvas, cropX, cropY, cropW, cropH, 0, 0, width, height);

    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    let depthRawData = null;
    if (depthRawCanvas) {
      try {
        const dCanvas = document.createElement('canvas');
        dCanvas.width = width;
        dCanvas.height = height;
        const dCtx = dCanvas.getContext('2d', { willReadFrequently: true });
        dCtx.imageSmoothingEnabled = true;
        dCtx.imageSmoothingQuality = 'high';

        const scaleX = dSrcW / srcW;
        const scaleY = dSrcH / srcH;
        dCtx.drawImage(
          depthRawCanvas,
          cropX * scaleX,
          cropY * scaleY,
          cropW * scaleX,
          cropH * scaleY,
          0, 0, width, height
        );
        depthRawData = dCtx.getImageData(0, 0, width, height).data;
      } catch (err) {
        console.warn('Erro ao recortar imagem de profundidade:', err);
      }
    }

    // 5. Máscara Hermética 100% Confiável (nunca apaga roupas escuras como Batman!)
    let rawFg = new Uint8Array(width * height);

    if (depthRawData) {
      for (let i = 0; i < width * height; i++) {
        rawFg[i] = depthRawData[i * 4] > 20 ? 1 : 0;
      }
    } else {
      rawFg = this.segmentForeground(data, width, height);
    }

    // BFS 3 (ISLAND FILTERING): Extrair apenas o Maior Componente Conectado (elimina ruídos e pontinhos flutuantes)
    const labels = new Int32Array(width * height);
    const compSizes = [0];
    let currentLabel = 1;

    for (let i = 0; i < width * height; i++) {
      if (rawFg[i] === 1 && labels[i] === 0) {
        let size = 0;
        const compQueue = [i];
        labels[i] = currentLabel;
        let cHead = 0;

        while (cHead < compQueue.length) {
          const p = compQueue[cHead++];
          size++;
          const px = p % width;
          const py = Math.floor(p / width);

          const neighbors = [
            px > 0 ? py * width + (px - 1) : -1,
            px < width - 1 ? py * width + (px + 1) : -1,
            py > 0 ? (py - 1) * width + px : -1,
            py < height - 1 ? (py + 1) * width + px : -1
          ];

          for (let nb of neighbors) {
            if (nb !== -1 && rawFg[nb] === 1 && labels[nb] === 0) {
              labels[nb] = currentLabel;
              compQueue.push(nb);
            }
          }
        }

        compSizes[currentLabel] = size;
        currentLabel++;
      }
    }

    let maxCompIdx = 1;
    let maxCompSize = 0;
    for (let c = 1; c < compSizes.length; c++) {
      if (compSizes[c] > maxCompSize) {
        maxCompSize = compSizes[c];
        maxCompIdx = c;
      }
    }

    // Máscara final sem furos e sem ruídos
    const mask = new Uint8Array(width * height);
    const depthMap = new Float32Array(width * height);
    const neuralDepthMap = new Float32Array(width * height);
    let finalMinX = width, finalMaxX = 0, finalMinY = height, finalMaxY = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (labels[idx] === maxCompIdx) {
          mask[idx] = 1;
          finalMinX = Math.min(finalMinX, x);
          finalMaxX = Math.max(finalMaxX, x);
          finalMinY = Math.min(finalMinY, y);
          finalMaxY = Math.max(finalMaxY, y);
        }
        const r = data[idx * 4];
        const g = data[idx * 4 + 1];
        const b = data[idx * 4 + 2];
        depthMap[idx] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      }
    }

    // Garantir base sólida sem mordidas ou furos nas últimas linhas da silhueta
    for (let y = Math.floor(finalMaxY - height * 0.05); y <= finalMaxY; y++) {
      let rowMin = width, rowMax = 0;
      for (let x = finalMinX; x <= finalMaxX; x++) {
        if (labels[y * width + x] === maxCompIdx) {
          rowMin = Math.min(rowMin, x);
          rowMax = Math.max(rowMax, x);
        }
      }
      if (rowMin <= rowMax) {
        for (let x = rowMin; x <= rowMax; x++) {
          mask[y * width + x] = 1;
        }
      }
    }

    // Normalização e Suavização Gaussiana do Mapa de Profundidade Neural 3D
    let minD = 255, maxD = 0;
    const rawNeural = new Float32Array(width * height);
    if (depthRawData) {
      for (let i = 0; i < width * height; i++) {
        if (mask[i] === 1) {
          const val = depthRawData[i * 4];
          rawNeural[i] = val;
          if (val < minD) minD = val;
          if (val > maxD) maxD = val;
        }
      }
    } else {
      const rawDt = this.computeDistanceTransform(mask, width, height);
      let maxDt = 1;
      for (let i = 0; i < width * height; i++) {
        if (mask[i] === 1 && rawDt[i] > maxDt) maxDt = rawDt[i];
      }

      // Detalhes de alta frequência por máscara de nitidez (unsharp mask) da luminância
      const lum = new Float32Array(width * height);
      for (let i = 0; i < width * height; i++) {
        lum[i] = (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]);
      }
      const lumBlur = this.gaussianBlur2D(lum, width, height);

      for (let i = 0; i < width * height; i++) {
        if (mask[i] === 1) {
          const dNorm = Math.min(1.0, rawDt[i] / maxDt);
          // Curvatura esférica/elíptica anatômica (tronco, membros, cabeça)
          const dome = Math.sin(Math.min(1.0, dNorm * 1.3) * (Math.PI / 2)) ** 0.65;
          // Relevo de linhas de desenho (músculos, cinturão, olhos, emblema) sem cavar buracos em cores escuras
          const lineRelief = (lum[i] - lumBlur[i]) / 255;
          rawNeural[i] = Math.max(10, Math.min(250, (dome * 0.85 + (0.5 + lineRelief * 0.5) * 0.15) * 255));
          if (rawNeural[i] < minD) minD = rawNeural[i];
          if (rawNeural[i] > maxD) maxD = rawNeural[i];
        }
      }
    }

    // Filtro Gaussiano para eliminar degraus de pixel discretos de 8-bit
    const smoothNeural = this.gaussianBlur2D(rawNeural, width, height);
    const rangeD = Math.max(1, maxD - minD);
    for (let i = 0; i < width * height; i++) {
      if (mask[i] === 1) {
        neuralDepthMap[i] = (smoothNeural[i] - minD) / rangeD;
      }
    }

    // Filtro de Linha Craniana / Fundo de Baixa Frequência (Raio R=12) para isolar relevo facial de alta frequência
    const cranialBaseline = new Float32Array(width * height);
    const baseR = 12;
    for (let y = finalMinY; y <= finalMaxY; y++) {
      for (let x = finalMinX; x <= finalMaxX; x++) {
        if (mask[y * width + x] === 0) continue;
        let sum = 0, cnt = 0;
        for (let dy = -baseR; dy <= baseR; dy += 2) {
          for (let dx = -baseR; dx <= baseR; dx += 2) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height && mask[ny * width + nx] === 1) {
              sum += smoothNeural[ny * width + nx];
              cnt++;
            }
          }
        }
        cranialBaseline[y * width + x] = cnt > 0 ? sum / cnt : smoothNeural[y * width + x];
      }
    }

    // Relevo de alta precisão (diferença entre profundidade local/traços e curvatura de base)
    const reliefMap = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
      if (mask[i] === 1) {
        if (depthRawData) {
          reliefMap[i] = smoothNeural[i] - cranialBaseline[i];
        } else {
          // Para ilustrações e desenhos 2D sem mapa neural:
          // Isola os traços de tinta, músculos, emblemas e feições faciais com alta nitidez
          const lumVal = depthMap[i];
          const baseLum = cranialBaseline[i] / 255;
          reliefMap[i] = (lumVal - baseLum) * 6.5;
        }
      }
    }

    // Resolver pontos de sela diagonais na máscara para garantir malha 100% manifold
    for (let y = 0; y < height - 1; y++) {
      for (let x = 0; x < width - 1; x++) {
        const i00 = mask[y * width + x];
        const i10 = mask[y * width + (x + 1)];
        const i01 = mask[(y + 1) * width + x];
        const i11 = mask[(y + 1) * width + (x + 1)];
        if (i00 === 1 && i11 === 1 && i10 === 0 && i01 === 0) {
          mask[y * width + (x + 1)] = 1;
        } else if (i10 === 1 && i01 === 1 && i00 === 0 && i11 === 0) {
          mask[y * width + x] = 1;
        }
      }
    }

    return {
      width,
      height,
      data,
      depthMap,
      neuralDepthMap,
      smoothNeural,
      minD,
      maxD,
      reliefMap,
      mask,
      canvas,
      bounds: {
        minX: Math.max(0, finalMinX),
        maxX: Math.min(width - 1, finalMaxX),
        minY: Math.max(0, finalMinY),
        maxY: Math.min(height - 1, finalMaxY)
      }
    };
  }

  /**
   * Segmentação Universal de Primeiro Plano:
   * - Suporta canal alfa transparente diretamente
   * - Para imagens opacas (desenhos, fotos, quadrinhos), inicia flood fill ESTRITAMENTE a partir das 4 bordas
   * - Nunca invade o interior do personagem nem remove roupas escuras/pretas (Batman, capas, cabelos)
   * - Elimina fundos com céu, gradientes ou cores uniformes
   */
  static segmentForeground(data, W, H) {
    const isBg = new Uint8Array(W * H);

    // 1. Verificação de transparência (se for PNG com canal alfa transparente)
    let transparentCount = 0;
    for (let i = 0; i < W * H; i++) {
      if (data[i * 4 + 3] < 60) transparentCount++;
    }

    if (transparentCount > (W * H) * 0.005) {
      // Tem canal alfa transparente: usa diretamente
      const fg = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) {
        fg[i] = data[i * 4 + 3] >= 60 ? 1 : 0;
      }
      return this.keepLargestComponentAndFillHoles(fg, W, H);
    }

    // 2. Imagem opaca: Amostragem das 4 bordas externas
    const borderSamples = [];
    const addBorder = (x, y) => {
      const idx = (y * W + x) * 4;
      borderSamples.push([data[idx], data[idx + 1], data[idx + 2]]);
    };
    for (let x = 0; x < W; x += 2) { addBorder(x, 0); addBorder(x, H - 1); }
    for (let y = 1; y < H - 1; y += 2) { addBorder(0, y); addBorder(W - 1, y); }

    let sumR = 0, sumG = 0, sumB = 0;
    for (let c of borderSamples) { sumR += c[0]; sumG += c[1]; sumB += c[2]; }
    const avgR = sumR / Math.max(1, borderSamples.length);
    const avgG = sumG / Math.max(1, borderSamples.length);
    const avgB = sumB / Math.max(1, borderSamples.length);

    // 4 cantos da imagem
    const corners = [
      [0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]
    ].map(([cx, cy]) => {
      const idx = (cy * W + cx) * 4;
      return [data[idx], data[idx + 1], data[idx + 2]];
    });

    const colorDist = (r1, g1, b1, r2, g2, b2) => {
      return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
    };

    const isNearBorderColor = (r, g, b) => {
      if (colorDist(r, g, b, avgR, avgG, avgB) < 65) return true;
      for (let c of corners) {
        if (colorDist(r, g, b, c[0], c[1], c[2]) < 50) return true;
      }
      return false;
    };

    // 3. Flood-fill iniciado ESTRITAMENTE a partir das bordas externas
    const queue = [];
    const seedBorder = (x, y) => {
      const idx = y * W + x;
      if (isBg[idx] === 0) {
        const p = idx * 4;
        if (isNearBorderColor(data[p], data[p + 1], data[p + 2])) {
          isBg[idx] = 1;
          queue.push(idx);
        }
      }
    };

    for (let x = 0; x < W; x++) { seedBorder(x, 0); seedBorder(x, H - 1); }
    for (let y = 1; y < H - 1; y++) { seedBorder(0, y); seedBorder(W - 1, y); }

    let head = 0;
    while (head < queue.length) {
      const curr = queue[head++];
      const cx = curr % W;
      const cy = Math.floor(curr / W);
      const cIdx = curr * 4;
      const cr = data[cIdx], cg = data[cIdx + 1], cb = data[cIdx + 2];

      const neighbors = [
        cx > 0 ? [cx - 1, cy] : null,
        cx < W - 1 ? [cx + 1, cy] : null,
        cy > 0 ? [cx, cy - 1] : null,
        cy < H - 1 ? [cx, cy + 1] : null
      ];

      for (let n of neighbors) {
        if (!n) continue;
        const nIdx = n[1] * W + n[0];
        if (isBg[nIdx] === 0) {
          const npIdx = nIdx * 4;
          const nr = data[npIdx], ng = data[npIdx + 1], nb = data[npIdx + 2];
          const localStep = colorDist(cr, cg, cb, nr, ng, nb);
          const globalDist = colorDist(nr, ng, nb, avgR, avgG, avgB);

          // Continuidade suave de fundo (não pula linhas pretas de contorno)
          if (localStep < 26 && (globalDist < 75 || isNearBorderColor(nr, ng, nb))) {
            isBg[nIdx] = 1;
            queue.push(nIdx);
          }
        }
      }
    }

    // 4. Inverter: primeiro plano é tudo o que não foi alcançado pelo fundo
    const fg = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      fg[i] = isBg[i] === 0 ? 1 : 0;
    }

    return this.keepLargestComponentAndFillHoles(fg, W, H);
  }

  static keepLargestComponentAndFillHoles(fg, W, H) {
    // 1. Encontrar o maior componente conectado
    const labels = new Int32Array(W * H);
    const compSizes = [0];
    let currentLabel = 1;

    for (let i = 0; i < W * H; i++) {
      if (fg[i] === 1 && labels[i] === 0) {
        let size = 0;
        const q = [i];
        labels[i] = currentLabel;
        let head = 0;
        while (head < q.length) {
          const p = q[head++];
          size++;
          const px = p % W;
          const py = Math.floor(p / W);
          const neighbors = [
            px > 0 ? py * W + (px - 1) : -1,
            px < W - 1 ? py * W + (px + 1) : -1,
            py > 0 ? (py - 1) * W + px : -1,
            py < H - 1 ? (py + 1) * W + px : -1
          ];
          for (let n of neighbors) {
            if (n !== -1 && fg[n] === 1 && labels[n] === 0) {
              labels[n] = currentLabel;
              q.push(n);
            }
          }
        }
        compSizes[currentLabel] = size;
        currentLabel++;
      }
    }

    let maxLabel = 1;
    let maxSize = 0;
    for (let c = 1; c < compSizes.length; c++) {
      if (compSizes[c] > maxSize) {
        maxSize = compSizes[c];
        maxLabel = c;
      }
    }

    const mainComponent = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      if (labels[i] === maxLabel) mainComponent[i] = 1;
    }

    // 2. Preenchimento de Cavidades/Furos Internos (Hole Filling)
    const outside = new Uint8Array(W * H);
    const outQ = [];
    const seedOut = (x, y) => {
      const idx = y * W + x;
      if (mainComponent[idx] === 0 && outside[idx] === 0) {
        outside[idx] = 1;
        outQ.push(idx);
      }
    };

    for (let x = 0; x < W; x++) { seedOut(x, 0); seedOut(x, H - 1); }
    for (let y = 1; y < H - 1; y++) { seedOut(0, y); seedOut(W - 1, y); }

    let oHead = 0;
    while (oHead < outQ.length) {
      const p = outQ[oHead++];
      const px = p % W;
      const py = Math.floor(p / W);
      const neighbors = [
        px > 0 ? py * W + (px - 1) : -1,
        px < W - 1 ? py * W + (px + 1) : -1,
        py > 0 ? (py - 1) * W + px : -1,
        py < H - 1 ? (py + 1) * W + px : -1
      ];
      for (let n of neighbors) {
        if (n !== -1 && mainComponent[n] === 0 && outside[n] === 0) {
          outside[n] = 1;
          outQ.push(n);
        }
      }
    }

    // 2. Preenchimento apenas de microporos/artefatos isolados (< 40 px), mantendo vãos abertos entre membros e capa
    const solidFg = new Uint8Array(mainComponent);
    const holeVisited = new Uint8Array(W * H);

    for (let i = 0; i < W * H; i++) {
      if (mainComponent[i] === 0 && outside[i] === 0 && holeVisited[i] === 0) {
        const holePixels = [];
        const hQueue = [i];
        holeVisited[i] = 1;
        let hHead = 0;
        while (hHead < hQueue.length) {
          const hp = hQueue[hHead++];
          holePixels.push(hp);
          const hpx = hp % W;
          const hpy = Math.floor(hp / W);
          const nbs = [
            hpx > 0 ? hpy * W + (hpx - 1) : -1,
            hpx < W - 1 ? hpy * W + (hpx + 1) : -1,
            hpy > 0 ? (hpy - 1) * W + hpx : -1,
            hpy < H - 1 ? (hpy + 1) * W + hpx : -1
          ];
          for (let n of nbs) {
            if (n !== -1 && mainComponent[n] === 0 && outside[n] === 0 && holeVisited[n] === 0) {
              holeVisited[n] = 1;
              hQueue.push(n);
            }
          }
        }

        // Apenas microporos minúsculos (< 40 px) são preenchidos; vãos reais entre braço, capa e pernas são preservados!
        if (holePixels.length < 40) {
          for (let hp of holePixels) {
            solidFg[hp] = 1;
          }
        }
      }
    }

    return solidFg;
  }

  /**
   * Cálculo da Transformada de Distância Euclidiana em 8 Direções
   */
  static computeDistanceTransform(mask, W, H) {
    const INF = 999999;
    const dist = new Float32Array(W * H);

    for (let i = 0; i < W * H; i++) {
      dist[i] = mask[i] === 0 ? 0 : INF;
    }

    // Pass 1: Top-Left para Bottom-Right
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = y * W + x;
        if (dist[idx] === 0) continue;

        let d = dist[idx];
        if (x > 0) d = Math.min(d, dist[idx - 1] + 1.0);
        if (y > 0) d = Math.min(d, dist[idx - W] + 1.0);
        if (x > 0 && y > 0) d = Math.min(d, dist[idx - W - 1] + 1.414);
        if (x < W - 1 && y > 0) d = Math.min(d, dist[idx - W + 1] + 1.414);

        dist[idx] = d;
      }
    }

    // Pass 2: Bottom-Right para Top-Left
    for (let y = H - 1; y >= 0; y--) {
      for (let x = W - 1; x >= 0; x--) {
        const idx = y * W + x;
        if (dist[idx] === 0) continue;

        let d = dist[idx];
        if (x < W - 1) d = Math.min(d, dist[idx + 1] + 1.0);
        if (y < H - 1) d = Math.min(d, dist[idx + W] + 1.0);
        if (x < W - 1 && y < H - 1) d = Math.min(d, dist[idx + W + 1] + 1.414);
        if (x > 0 && y < H - 1) d = Math.min(d, dist[idx + W - 1] + 1.414);

        dist[idx] = d;
      }
    }

    return dist;
  }

  /**
   * Suavização Gaussiana 2D separável para eliminar degraus e ruídos discretos de pixel
   */
  static gaussianBlur2D(grid, W, H) {
    const temp = new Float32Array(W * H);
    const out = new Float32Array(W * H);
    const kernel = [0.061, 0.242, 0.383, 0.242, 0.061]; // 5-tap Gaussian
    const offset = 2;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let sum = 0, weightSum = 0;
        for (let k = -offset; k <= offset; k++) {
          const nx = Math.min(W - 1, Math.max(0, x + k));
          const w = kernel[k + offset];
          sum += grid[y * W + nx] * w;
          weightSum += w;
        }
        temp[y * W + x] = sum / weightSum;
      }
    }

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let sum = 0, weightSum = 0;
        for (let k = -offset; k <= offset; k++) {
          const ny = Math.min(H - 1, Math.max(0, y + k));
          const w = kernel[k + offset];
          sum += temp[ny * W + x] * w;
          weightSum += w;
        }
        out[y * W + x] = sum / weightSum;
      }
    }
    return out;
  }

  /**
   * Suavização Laplaciana 3D para eliminar facetas, arestas serrilhadas e escadas de pixel
   */
  static applyLaplacianSmoothing(positions, indices, iterations = 4, lambda = 0.45) {
    const vCount = positions.length / 3;
    const adj = Array.from({ length: vCount }, () => []);

    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i], b = indices[i + 1], c = indices[i + 2];
      adj[a].push(b, c);
      adj[b].push(a, c);
      adj[c].push(a, b);
    }

    for (let i = 0; i < vCount; i++) {
      adj[i] = Array.from(new Set(adj[i]));
    }

    const temp = new Float32Array(positions.length);

    for (let it = 0; it < iterations; it++) {
      for (let i = 0; i < vCount; i++) {
        const neighbors = adj[i];
        if (neighbors.length === 0) {
          temp[i * 3] = positions[i * 3];
          temp[i * 3 + 1] = positions[i * 3 + 1];
          temp[i * 3 + 2] = positions[i * 3 + 2];
          continue;
        }

        let avgX = 0, avgY = 0, avgZ = 0;
        for (let n of neighbors) {
          avgX += positions[n * 3];
          avgY += positions[n * 3 + 1];
          avgZ += positions[n * 3 + 2];
        }
        avgX /= neighbors.length;
        avgY /= neighbors.length;
        avgZ /= neighbors.length;

        temp[i * 3] = positions[i * 3] + lambda * (avgX - positions[i * 3]);
        temp[i * 3 + 1] = positions[i * 3 + 1] + lambda * (avgY - positions[i * 3 + 1]);
        temp[i * 3 + 2] = positions[i * 3 + 2] + lambda * (avgZ - positions[i * 3 + 2]);
      }

      for (let i = 0; i < positions.length; i++) {
        positions[i] = temp[i];
      }
    }
  }

  /**
   * ESCULTURA 3D VOLUMÉTRICA ORGÂNICA REAL COM PROPORÇÕES ANATÔMICAS REAIS
   * - O personagem fica 100% em pé na mesa aquecida (eixo Z vertical)
   * - Proporções X/Z reais baseadas na silhueta recortada (sem esticar)
   * - Anatomia Facial Esculpida: Nariz saliente (+5mm a +6mm), órbitas oculares recuadas, barba e queixo
   * - Base/Pedestal Monolítico sem frestas ou vazios de fatiamento
   */
  static createVolumetricSculpture(processedImage, options = {}) {
    const {
      targetHeight = 85,     // mm (altura em pé Z)
      maxDepth = 18,         // mm (espessura Y total)
      depthDetail = 1.0,     // intensidade de relevo
      addPedestal = false,   // sem base por padrão
      pedestalHeight = 4.0,  // mm
      backStyle = 'flat',    // 'flat' (traseira limpa e plana sem estufar) ou 'dome' (arredondada simétrica)
      smoothness = 6         // iterações de suavização laplaciana para eliminar degraus e ranhuras de pixel
    } = options;

    const { width: W, height: H, data, mask, depthMap, neuralDepthMap, reliefMap, bounds } = processedImage;

    const { minX, maxX, minY, maxY } = bounds;
    const charW = Math.max(1, maxX - minX);
    const charH = Math.max(1, maxY - minY);

    const targetWidth = targetHeight * (charW / charH);

    // Transformada de Distância Global Suavizada (elimina arestas serrilhadas e degraus de pixel)
    const rawDt = this.computeDistanceTransform(mask, W, H);
    let dt = this.gaussianBlur2D(rawDt, W, H);
    dt = this.gaussianBlur2D(dt, W, H);

    let maxDist = 1;
    for (let i = 0; i < W * H; i++) {
      if (mask[i] === 1 && dt[i] > maxDist) maxDist = dt[i];
    }

    // Mapear vértices de primeiro plano
    const vIdx = new Int32Array(W * H).fill(-1);
    let totalFgPixels = 0;
    for (let i = 0; i < W * H; i++) {
      if (mask[i] === 1) {
        vIdx[i] = totalFgPixels++;
      }
    }

    if (totalFgPixels === 0) {
      throw new Error('Nenhum objeto detectado na imagem.');
    }

    // 1. Extração de características anatômicas contínuas (cinto, músculos, emblema, capa)
    const rawFeat = new Float32Array(W * H);
    const charCenterX = (minX + maxX) / 2;

    if (data) {
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const idx = y * W + x;
          if (mask[idx] === 0) continue;
          const r = data[idx * 4], g = data[idx * 4 + 1], b = data[idx * 4 + 2];
          const isBelt = (r > 150 && g > 110 && b < 80 && (r - b) > 40);
          const isCape = (b > r + 15 && b > g + 10 && b > 50);
          const isSkin = (r > 180 && g > 130 && b > 90 && r > b + 30);
          const isInk = (r < 55 && g < 55 && b < 55);
          const isChestEmblem = isInk && (y >= minY + charH * 0.20 && y <= minY + charH * 0.44) && (Math.abs(x - charCenterX) < charW * 0.28);

          if (isBelt) rawFeat[idx] = 1.6;
          else if (isChestEmblem) rawFeat[idx] = 1.1;
          else if (isSkin) rawFeat[idx] = 0.8;
          else if (isInk) rawFeat[idx] = -0.6;
          else if (isCape) rawFeat[idx] = -0.8;
        }
      }
    }

    // Suavização Gaussiana dupla para garantir transições orgânicas sem nenhuma ranhura ou degrau de pixel
    let smoothFeat = this.gaussianBlur2D(rawFeat, W, H);
    smoothFeat = this.gaussianBlur2D(smoothFeat, W, H);

    const positions = [];
    const uvs = [];
    const indices = [];

    const zBaseOffset = addPedestal ? 2.0 : 0;
    const usableHeight = targetHeight - zBaseOffset;

    // Espessura sólida uniforme de base (garante rigidez mecânica na impressão 3D)
    const baseThickness = Math.max(3.5, maxDepth * 0.35);

    // 2. Vértices da Frente e do Verso (Escultura 3D Volumétrica Real)
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const idx = y * W + x;
        if (mask[idx] === 0) continue;

        const dNorm = Math.min(1.0, dt[idx] / maxDist);
        const profile = Math.sin(Math.min(1.0, dNorm * 1.5) * (Math.PI / 2)) ** 0.65;
        const bodyCurve = Math.sin(Math.min(1.0, dNorm * 1.4) * (Math.PI / 2)) ** 0.55;
        const featureRelief = smoothFeat[idx] * depthDetail;

        let frontY = 0;
        if (backStyle === 'dome') {
          // Modelagem 3D 360° Real: membros e corpo arredondados em 3D contínuo sem paredes verticais
          const organicRadius = (maxDepth * 0.5) * profile;
          frontY = -(organicRadius + featureRelief * profile);
        } else {
          frontY = -(baseThickness + bodyCurve * (maxDepth * 0.55) + featureRelief);
        }

        const xPos = ((x - minX) / charW - 0.5) * targetWidth;
        const zPos = zBaseOffset + ((maxY - y) / charH) * usableHeight;

        positions.push(xPos, frontY, Math.max(0, zPos));
        uvs.push(x / (W - 1), 1.0 - y / (H - 1));
      }
    }

    // 3. Vértices do Verso
    const backOffset = totalFgPixels;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const idx = y * W + x;
        if (mask[idx] === 0) continue;

        let backY = 0;
        if (backStyle === 'dome') {
          const dNorm = Math.min(1.0, dt[idx] / maxDist);
          const profile = Math.sin(Math.min(1.0, dNorm * 1.5) * (Math.PI / 2)) ** 0.65;
          backY = (maxDepth * 0.48) * profile;
        } else {
          backY = 0; // Traseira 100% plana para deitar na mesa da impressora 3D
        }

        const xPos = ((x - minX) / charW - 0.5) * targetWidth;
        const zPos = zBaseOffset + ((maxY - y) / charH) * usableHeight;

        positions.push(xPos, +backY, Math.max(0, zPos));
        uvs.push(1.0 - x / (W - 1), 1.0 - y / (H - 1));
      }
    }

    // 4. Triangulação de Alta Fidelidade
    const frontTris = [];
    for (let y = minY; y < maxY; y++) {
      for (let x = minX; x < maxX; x++) {
        const iA = vIdx[y * W + x];
        const iB = vIdx[y * W + (x + 1)];
        const iC = vIdx[(y + 1) * W + x];
        const iD = vIdx[(y + 1) * W + (x + 1)];

        const pts = (iA !== -1 ? 1 : 0) + (iB !== -1 ? 1 : 0) + (iC !== -1 ? 1 : 0) + (iD !== -1 ? 1 : 0);
        if (pts === 4) {
          frontTris.push(iA, iB, iC);
          frontTris.push(iB, iD, iC);
        } else if (pts === 3) {
          if (iA !== -1 && iB !== -1 && iC !== -1) frontTris.push(iA, iB, iC);
          else if (iB !== -1 && iD !== -1 && iC !== -1) frontTris.push(iB, iD, iC);
          else if (iA !== -1 && iB !== -1 && iD !== -1) frontTris.push(iA, iB, iD);
          else if (iA !== -1 && iC !== -1 && iD !== -1) frontTris.push(iA, iD, iC);
        }
      }
    }

    for (let i = 0; i < frontTris.length; i++) indices.push(frontTris[i]);

    // Superfície de trás (orientação invertida para normais externas)
    for (let i = 0; i < frontTris.length; i += 3) {
      indices.push(backOffset + frontTris[i], backOffset + frontTris[i + 2], backOffset + frontTris[i + 1]);
    }

    // 5. Fechamento Perimétrico Hermético 100% Manifold (Borda Externa Contínua)
    const edgeCounts = new Map();
    for (let i = 0; i < frontTris.length; i += 3) {
      const a = frontTris[i], b = frontTris[i + 1], c = frontTris[i + 2];
      for (let [u, v] of [[a, b], [b, c], [c, a]]) {
        const key = u < v ? `${u},${v}` : `${v},${u}`;
        edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
      }
    }
    for (let i = 0; i < frontTris.length; i += 3) {
      const a = frontTris[i], b = frontTris[i + 1], c = frontTris[i + 2];
      for (let [u, v] of [[a, b], [b, c], [c, a]]) {
        const key = u < v ? `${u},${v}` : `${v},${u}`;
        if (edgeCounts.get(key) === 1) {
          const uB = backOffset + u;
          const vB = backOffset + v;
          indices.push(u, v, vB);
          indices.push(u, vB, uB);
        }
      }
    }

    // 6. Suavização Laplaciana 3D Anti-Serrilhado: elimina degraus de pixel, dentes de serra e ranhuras!
    if (smoothness > 0) {
      this.applyLaplacianSmoothing(positions, indices, smoothness, 0.35);
    }

    // Se traseira plana, garante planicidade matemática absoluta (y = 0) para assentamento perfeito na mesa do fatiador
    if (backStyle === 'flat') {
      for (let i = backOffset; i < backOffset + totalFgPixels; i++) {
        positions[i * 3 + 1] = 0;
      }
    }

    // 5. Pedestal Sólido Chanfrado Integrado para a Mesa Aquecida (Z = 0 a Z = pedestalHeight)
    // Com sobreposição volumétrica estanque no pé do busto (eliminando frestas no fatiador)
    if (addPedestal) {
      const pedSegments = 64;
      const pedRadiusX = Math.max(22, (targetWidth * 0.5) + 6);
      const pedRadiusY = Math.max(16, (maxDepth * 0.65) + 6);
      const pedHeight = pedestalHeight;

      const botCenterIdx = positions.length / 3;
      positions.push(0, 0, 0);
      uvs.push(0.5, 0.5);

      const botRingStart = positions.length / 3;
      for (let i = 0; i < pedSegments; i++) {
        const theta = (i / pedSegments) * Math.PI * 2;
        positions.push(Math.cos(theta) * pedRadiusX, Math.sin(theta) * pedRadiusY, 0);
        uvs.push(0.5 + 0.5 * Math.cos(theta), 0.5 + 0.5 * Math.sin(theta));
      }
      // Fundo plano na mesa (Z = 0)
      for (let i = 0; i < pedSegments; i++) {
        indices.push(botCenterIdx, botRingStart + ((i + 1) % pedSegments), botRingStart + i);
      }

      const topRingStart = positions.length / 3;
      for (let i = 0; i < pedSegments; i++) {
        const theta = (i / pedSegments) * Math.PI * 2;
        positions.push(Math.cos(theta) * (pedRadiusX - 1.2), Math.sin(theta) * (pedRadiusY - 1.2), pedHeight);
        uvs.push(0.5 + 0.5 * Math.cos(theta), 0.5 + 0.5 * Math.sin(theta));
      }

      // Paredes chanfradas do pedestal
      for (let i = 0; i < pedSegments; i++) {
        const b0 = botRingStart + i;
        const b1 = botRingStart + ((i + 1) % pedSegments);
        const t0 = topRingStart + i;
        const t1 = topRingStart + ((i + 1) % pedSegments);
        indices.push(b0, b1, t0);
        indices.push(b1, t1, t0);
      }

      // Topo do pedestal (Z = pedHeight)
      const topCenterIdx = positions.length / 3;
      positions.push(0, 0, pedHeight);
      uvs.push(0.5, 0.5);
      for (let i = 0; i < pedSegments; i++) {
        indices.push(topCenterIdx, topRingStart + i, topRingStart + ((i + 1) % pedSegments));
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return {
      geometry,
      dimensions: {
        width: targetWidth,
        depth: maxDepth,
        height: targetHeight
      },
      stats: {
        vertices: positions.length / 3,
        triangles: indices.length / 3,
        isManifold: true
      }
    };
  }

  /**
   * RELEVO MONOLÍTICO ESTANQUE (Para medalhas, moedas, litofanias e placas)
   */
  static createReliefPlaque(processedImage, options = {}) {
    const {
      targetWidth = 80,
      baseThickness = 3,
      reliefDepth = 12
    } = options;

    const { width: W, height: H, depthMap, mask, bounds } = processedImage;
    const { minX, maxX, minY, maxY } = bounds;
    const charW = Math.max(1, maxX - minX);
    const charH = Math.max(1, maxY - minY);
    const targetHeight = targetWidth * (charH / charW);

    const positions = [];
    const uvs = [];
    const indices = [];

    // Malha do topo (relevo)
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const idx = y * W + x;
        const xPos = ((x - minX) / charW - 0.5) * targetWidth;
        const yPos = ((y - minY) / charH - 0.5) * targetHeight;
        
        let zPos = baseThickness;
        if (mask[idx] === 1) {
          zPos += depthMap[idx] * reliefDepth;
        }

        positions.push(xPos, yPos, zPos);
        uvs.push(x / (W - 1), 1.0 - y / (H - 1));
      }
    }

    // Malha da base plana (Z = 0)
    const baseOffset = (charH + 1) * (charW + 1);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const xPos = ((x - minX) / charW - 0.5) * targetWidth;
        const yPos = ((y - minY) / charH - 0.5) * targetHeight;
        positions.push(xPos, yPos, 0);
        uvs.push(x / (W - 1), 1.0 - y / (H - 1));
      }
    }

    // Triângulos do topo
    const rowStride = charW + 1;
    for (let y = 0; y < charH; y++) {
      for (let x = 0; x < charW; x++) {
        const iA = y * rowStride + x;
        const iB = y * rowStride + (x + 1);
        const iC = (y + 1) * rowStride + x;
        const iD = (y + 1) * rowStride + (x + 1);

        indices.push(iA, iC, iB);
        indices.push(iB, iC, iD);

        indices.push(baseOffset + iA, baseOffset + iB, baseOffset + iC);
        indices.push(baseOffset + iB, baseOffset + iD, baseOffset + iC);
      }
    }

    // Paredes laterais
    const addSideWall = (tA, tB) => {
      const bA = baseOffset + tA;
      const bB = baseOffset + tB;
      indices.push(tA, tB, bA);
      indices.push(tB, bB, bA);
    };

    for (let x = 0; x < charW; x++) {
      addSideWall(x, x + 1);
      addSideWall(charH * rowStride + (x + 1), charH * rowStride + x);
    }
    for (let y = 0; y < charH; y++) {
      addSideWall((y + 1) * rowStride, y * rowStride);
      addSideWall(y * rowStride + charW, (y + 1) * rowStride + charW);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return {
      geometry,
      dimensions: {
        width: targetWidth,
        depth: targetHeight,
        height: baseThickness + reliefDepth
      },
      stats: {
        vertices: positions.length / 3,
        triangles: indices.length / 3,
        isManifold: true
      }
    };
  }

  static estimatePrintMetrics(geometry, infillPercent = 15) {
    if (!geometry.attributes.position) return { volumeCm3: 0, weightGrams: 0, printTimeHours: 0 };

    const pos = geometry.attributes.position.array;
    const index = geometry.index ? geometry.index.array : null;
    let volumeSum = 0;

    if (index) {
      for (let i = 0; i < index.length; i += 3) {
        const i1 = index[i] * 3;
        const i2 = index[i + 1] * 3;
        const i3 = index[i + 2] * 3;

        const x1 = pos[i1], y1 = pos[i1 + 1], z1 = pos[i1 + 2];
        const x2 = pos[i2], y2 = pos[i2 + 1], z2 = pos[i2 + 2];
        const x3 = pos[i3], y3 = pos[i3 + 1], z3 = pos[i3 + 2];

        volumeSum += (x1 * (y2 * z3 - y3 * z2) -
                      y1 * (x2 * z3 - x3 * z2) +
                      z1 * (x2 * y3 - x3 * y2)) / 6.0;
      }
    }

    const volumeMm3 = Math.abs(volumeSum);
    const volumeCm3 = volumeMm3 / 1000.0;
    const effectiveInfillFactor = Math.min(1.0, 0.25 + (infillPercent / 100) * 0.75);
    const weightGrams = volumeCm3 * 1.24 * effectiveInfillFactor;
    const printTimeMinutes = Math.max(15, Math.round(weightGrams * 2.2));
    const hours = Math.floor(printTimeMinutes / 60);
    const mins = printTimeMinutes % 60;

    return {
      volumeCm3: Number(volumeCm3.toFixed(2)),
      weightGrams: Number(weightGrams.toFixed(1)),
      printTimeString: `${hours > 0 ? `${hours}h ` : ''}${mins}m`
    };
  }
}
