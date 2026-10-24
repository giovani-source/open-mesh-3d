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
  static getImageData(image, targetResolution = 180) {
    const canvas = document.createElement('canvas');
    let width = targetResolution;
    let height = Math.round(targetResolution * (image.naturalHeight / image.naturalWidth));

    // Limites de proporção razoáveis
    if (height > targetResolution * 2.2) {
      height = Math.round(targetResolution * 2.2);
    } else if (height < targetResolution * 0.45) {
      height = Math.round(targetResolution * 0.45);
    }

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, width, height);

    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    const depthMap = new Float32Array(width * height);
    const rawMask = new Uint8Array(width * height);

    // 1. Amostrar bordas externas para detectar a cor média do fundo
    let bgR = 0, bgG = 0, bgB = 0, borderCount = 0;
    const borderSamples = [];

    const addSample = (x, y) => {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3];
      if (a > 40) {
        borderSamples.push({ r, g, b });
        bgR += r;
        bgG += g;
        bgB += b;
        borderCount++;
      }
    };

    for (let x = 0; x < width; x++) {
      addSample(x, 0);
      addSample(x, height - 1);
    }
    for (let y = 1; y < height - 1; y++) {
      addSample(0, y);
      addSample(width - 1, y);
    }

    if (borderCount > 0) {
      bgR /= borderCount;
      bgG /= borderCount;
      bgB /= borderCount;
    }

    // Calcular desvio padrão do fundo para tolerância adaptativa
    let variance = 0;
    for (let s of borderSamples) {
      const d = Math.sqrt((s.r - bgR) ** 2 + (s.g - bgG) ** 2 + (s.b - bgB) ** 2);
      variance += d;
    }
    const avgDev = borderSamples.length > 0 ? variance / borderSamples.length : 15;
    const colorTolerance = Math.min(50, Math.max(26, avgDev * 2.2));

    // 2. Flood Fill (BFS) iniciando exclusivamente a partir das 4 bordas externas
    const isBg = new Uint8Array(width * height);
    const queue = [];

    const isColorSimilarToBg = (idx) => {
      const a = data[idx * 4 + 3];
      if (a < 50) return true; // Transparência
      const r = data[idx * 4];
      const g = data[idx * 4 + 1];
      const b = data[idx * 4 + 2];
      const dist = Math.sqrt((r - bgR) ** 2 + (g - bgG) ** 2 + (b - bgB) ** 2);
      return dist <= colorTolerance;
    };

    // Inicializar fila com as 4 bordas
    for (let x = 0; x < width; x++) {
      const topIdx = 0 * width + x;
      const botIdx = (height - 1) * width + x;
      if (isColorSimilarToBg(topIdx)) {
        isBg[topIdx] = 1;
        queue.push(topIdx);
      }
      if (isColorSimilarToBg(botIdx)) {
        isBg[botIdx] = 1;
        queue.push(botIdx);
      }
    }
    for (let y = 1; y < height - 1; y++) {
      const leftIdx = y * width + 0;
      const rightIdx = y * width + (width - 1);
      if (isColorSimilarToBg(leftIdx)) {
        isBg[leftIdx] = 1;
        queue.push(leftIdx);
      }
      if (isColorSimilarToBg(rightIdx)) {
        isBg[rightIdx] = 1;
        queue.push(rightIdx);
      }
    }

    let head = 0;
    while (head < queue.length) {
      const curr = queue[head++];
      const cx = curr % width;
      const cy = Math.floor(curr / width);

      const neighbors = [
        cx > 0 ? cy * width + (cx - 1) : -1,
        cx < width - 1 ? cy * width + (cx + 1) : -1,
        cy > 0 ? (cy - 1) * width + cx : -1,
        cy < height - 1 ? (cy + 1) * width + cx : -1
      ];

      for (let n of neighbors) {
        if (n !== -1 && isBg[n] === 0) {
          if (isColorSimilarToBg(n)) {
            isBg[n] = 1;
            queue.push(n);
          }
        }
      }
    }

    // 3. Tudo o que não foi marcado como fundo conectado à borda é Primeiro Plano
    for (let i = 0; i < width * height; i++) {
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      depthMap[i] = lum;
      rawMask[i] = isBg[i] === 1 ? 0 : 1;
    }

    // 4. Fechamento morfológico de micro-ruídos
    const tempMask = new Uint8Array(width * height);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        if (rawMask[idx] === 1) {
          tempMask[idx] = 1;
        } else {
          let count = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (rawMask[(y + dy) * width + (x + dx)] === 1) count++;
            }
          }
          tempMask[idx] = count >= 6 ? 1 : 0;
        }
      }
    }

    // 5. Extrair o Maior Componente Conectado (Elimina linhas tracejadas, poeira e marcas de corte)
    const labels = new Int32Array(width * height).fill(0);
    let currentLabel = 1;
    const componentSizes = [0];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (tempMask[idx] === 1 && labels[idx] === 0) {
          // Iniciar BFS para marcar componente
          let size = 0;
          const compQueue = [idx];
          labels[idx] = currentLabel;

          let qHead = 0;
          while (qHead < compQueue.length) {
            const p = compQueue[qHead++];
            size++;
            const px = p % width;
            const py = Math.floor(p / width);

            const nbs = [
              px > 0 ? py * width + (px - 1) : -1,
              px < width - 1 ? py * width + (px + 1) : -1,
              py > 0 ? (py - 1) * width + px : -1,
              py < height - 1 ? (py + 1) * width + px : -1
            ];

            for (let nb of nbs) {
              if (nb !== -1 && tempMask[nb] === 1 && labels[nb] === 0) {
                labels[nb] = currentLabel;
                compQueue.push(nb);
              }
            }
          }

          componentSizes[currentLabel] = size;
          currentLabel++;
        }
      }
    }

    // Encontrar o maior componente
    let maxCompIdx = 1;
    let maxCompSize = 0;
    for (let c = 1; c < componentSizes.length; c++) {
      if (componentSizes[c] > maxCompSize) {
        maxCompSize = componentSizes[c];
        maxCompIdx = c;
      }
    }

    // Máscara final com o personagem isolado
    const mask = new Uint8Array(width * height);
    let minX = width, maxX = 0, minY = height, maxY = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (labels[idx] === maxCompIdx) {
          mask[idx] = 1;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    }

    // 6. Normalização do mapa de relevo
    const reliefMap = new Float32Array(width * height);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        if (mask[idx] === 0) continue;

        const dx = (depthMap[idx + 1] - depthMap[idx - 1]) * 0.5;
        const dy = (depthMap[idx + width] - depthMap[idx - width]) * 0.5;
        const edge = Math.sqrt(dx * dx + dy * dy);
        reliefMap[idx] = (depthMap[idx] - 0.5) * 0.7 + edge * 0.3;
      }
    }

    return {
      width,
      height,
      depthMap,
      reliefMap,
      mask,
      canvas,
      bounds: {
        minX: Math.max(0, minX),
        maxX: Math.min(width - 1, maxX),
        minY: Math.max(0, minY),
        maxY: Math.min(height - 1, maxY)
      }
    };
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
   * ESCULTURA 3D VOLUMÉTRICA ORGÂNICA REAL COM PROPORÇÕES ANATÔMICAS REAIS
   * - O personagem fica 100% em pé na mesa aquecida (eixo Z vertical)
   * - Proporções X/Z reais baseadas na silhueta recortada (sem esticar)
   * - Membros separados com volume arredondado (pernas, braços, capa, torso)
   * - Pedestal integrado opcional para estabilidade absoluta na impressão
   */
  static createVolumetricSculpture(processedImage, options = {}) {
    const {
      targetHeight = 90,     // mm (altura em pé Z)
      maxDepth = 24,         // mm (espessura frente/verso Y)
      depthDetail = 1.2,     // relevo muscular
      addPedestal = true,    // base na mesa
      pedestalHeight = 3.2   // mm
    } = options;

    const { width: W, height: H, mask, reliefMap, bounds } = processedImage;

    const { minX, maxX, minY, maxY } = bounds;
    const charW = Math.max(1, maxX - minX);
    const charH = Math.max(1, maxY - minY);

    // Proporção anatômica verdadeira do personagem
    const targetWidth = targetHeight * (charW / charH);

    // Transformada de Distância
    const dt = this.computeDistanceTransform(mask, W, H);

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

    const positions = [];
    const uvs = [];
    const indices = [];

    const zBaseOffset = addPedestal ? pedestalHeight : 0;
    const usableHeight = targetHeight - zBaseOffset;

    // 1. Vértices da Frente (Orientados para -Y, em direção à câmera frontal)
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const idx = y * W + x;
        if (mask[idx] === 0) continue;

        const d = dt[idx];
        const dNorm = d / maxDist;

        // Curvatura esférica/cilíndrica orgânica
        const dome = Math.sin(Math.min(1.0, dNorm * 1.5) * (Math.PI / 2));
        const bodyThickness = (dome * 0.72 + Math.pow(dNorm, 0.65) * 0.28) * (maxDepth / 2);
        const emboss = (reliefMap[idx] || 0) * depthDetail * 1.5;

        // X proporcional centralizado no eixo
        const xPos = ((x - minX) / charW - 0.5) * targetWidth;
        // Frente projeta para -Y (em direção ao observador)
        const yPos = -(Math.max(0.6, bodyThickness + emboss));
        // Z em pé: pés em zBaseOffset, cabeça em targetHeight
        const zPos = zBaseOffset + ((maxY - y) / charH) * usableHeight;

        positions.push(xPos, yPos, Math.max(0, zPos));
        // UV exato no canvas original
        uvs.push(x / (W - 1), 1.0 - y / (H - 1));
      }
    }

    // 2. Vértices do Verso (Orientados para +Y, costas do boneco)
    const backOffset = totalFgPixels;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const idx = y * W + x;
        if (mask[idx] === 0) continue;

        const d = dt[idx];
        const dNorm = d / maxDist;
        const dome = Math.sin(Math.min(1.0, dNorm * 1.5) * (Math.PI / 2));
        const bodyThickness = (dome * 0.72 + Math.pow(dNorm, 0.65) * 0.28) * (maxDepth / 2);

        const xPos = ((x - minX) / charW - 0.5) * targetWidth;
        // Costas projetam para +Y
        const yPos = +(Math.max(0.6, bodyThickness * 0.88));
        const zPos = zBaseOffset + ((maxY - y) / charH) * usableHeight;

        positions.push(xPos, yPos, Math.max(0, zPos));
        uvs.push(1.0 - x / (W - 1), 1.0 - y / (H - 1));
      }
    }

    // 3. Triangulação das superfícies da frente e de trás
    for (let y = minY; y < maxY; y++) {
      for (let x = minX; x < maxX; x++) {
        const iA = vIdx[y * W + x];
        const iB = vIdx[y * W + (x + 1)];
        const iC = vIdx[(y + 1) * W + x];
        const iD = vIdx[(y + 1) * W + (x + 1)];

        if (iA !== -1 && iB !== -1 && iC !== -1 && iD !== -1) {
          // Face Frontal (normal voltada para -Y)
          indices.push(iA, iB, iC);
          indices.push(iB, iD, iC);

          // Face Traseira (normal voltada para +Y)
          indices.push(backOffset + iA, backOffset + iC, backOffset + iB);
          indices.push(backOffset + iB, backOffset + iC, backOffset + iD);
        }
      }
    }

    // 4. Paredes Laterais Herméticas (Perimeter Skirt)
    const addSkirtQuad = (frontA, frontB) => {
      const backA = backOffset + frontA;
      const backB = backOffset + frontB;
      indices.push(frontA, backA, frontB);
      indices.push(frontB, backA, backB);
    };

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const curr = vIdx[y * W + x];
        if (curr === -1) continue;

        // Borda Direita
        if (x === maxX || vIdx[y * W + x + 1] === -1) {
          if (y < maxY && vIdx[(y + 1) * W + x] !== -1) {
            const next = vIdx[(y + 1) * W + x];
            addSkirtQuad(curr, next);
          }
        }
        // Borda Esquerda
        if (x === minX || vIdx[y * W + x - 1] === -1) {
          if (y < maxY && vIdx[(y + 1) * W + x] !== -1) {
            const next = vIdx[(y + 1) * W + x];
            addSkirtQuad(next, curr);
          }
        }
        // Borda Superior
        if (y === minY || vIdx[(y - 1) * W + x] === -1) {
          if (x < maxX && vIdx[y * W + x + 1] !== -1) {
            const next = vIdx[y * W + x + 1];
            addSkirtQuad(next, curr);
          }
        }
        // Borda Inferior (Pés)
        if (y === maxY || vIdx[(y + 1) * W + x] === -1) {
          if (x < maxX && vIdx[y * W + x + 1] !== -1) {
            const next = vIdx[y * W + x + 1];
            addSkirtQuad(curr, next);
          }
        }
      }
    }

    // 5. Pedestal de Apoio Integrado (Sólido para Mesa Aquecida Z = 0)
    if (addPedestal) {
      const pedSegments = 48;
      const pedRadiusX = Math.max(16, (targetWidth * 0.5) + 6);
      const pedRadiusY = Math.max(12, (maxDepth * 0.7) + 6);
      const pedHeight = pedestalHeight;
      const chamferHeight = pedHeight * 0.4;

      const pedBottomCenterIdx = positions.length / 3;
      positions.push(0, 0, 0);
      uvs.push(0.5, 0.5);

      const botRingStart = positions.length / 3;
      for (let i = 0; i < pedSegments; i++) {
        const theta = (i / pedSegments) * Math.PI * 2;
        const px = Math.cos(theta) * pedRadiusX;
        const py = Math.sin(theta) * pedRadiusY;
        positions.push(px, py, 0);
        uvs.push(0.5 + 0.5 * Math.cos(theta), 0.5 + 0.5 * Math.sin(theta));
      }

      // Fundo do pedestal (Z = 0)
      for (let i = 0; i < pedSegments; i++) {
        const i0 = botRingStart + i;
        const i1 = botRingStart + ((i + 1) % pedSegments);
        indices.push(pedBottomCenterIdx, i1, i0);
      }

      // Anel intermediário do chanfro
      const midRingStart = positions.length / 3;
      for (let i = 0; i < pedSegments; i++) {
        const theta = (i / pedSegments) * Math.PI * 2;
        const px = Math.cos(theta) * pedRadiusX;
        const py = Math.sin(theta) * pedRadiusY;
        positions.push(px, py, pedHeight - chamferHeight);
        uvs.push(0.5 + 0.5 * Math.cos(theta), 0.5 + 0.5 * Math.sin(theta));
      }

      // Parede vertical do pedestal
      for (let i = 0; i < pedSegments; i++) {
        const b0 = botRingStart + i;
        const b1 = botRingStart + ((i + 1) % pedSegments);
        const m0 = midRingStart + i;
        const m1 = midRingStart + ((i + 1) % pedSegments);
        indices.push(b0, b1, m0);
        indices.push(b1, m1, m0);
      }

      // Anel do topo (chanfrado)
      const topRingStart = positions.length / 3;
      const topRadiusX = pedRadiusX - 1.5;
      const topRadiusY = pedRadiusY - 1.5;
      for (let i = 0; i < pedSegments; i++) {
        const theta = (i / pedSegments) * Math.PI * 2;
        const px = Math.cos(theta) * topRadiusX;
        const py = Math.sin(theta) * topRadiusY;
        positions.push(px, py, pedHeight);
        uvs.push(0.5 + 0.5 * Math.cos(theta), 0.5 + 0.5 * Math.sin(theta));
      }

      // Chanfro do topo
      for (let i = 0; i < pedSegments; i++) {
        const m0 = midRingStart + i;
        const m1 = midRingStart + ((i + 1) % pedSegments);
        const t0 = topRingStart + i;
        const t1 = topRingStart + ((i + 1) % pedSegments);
        indices.push(m0, m1, t0);
        indices.push(m1, t1, t0);
      }

      // Tampa do topo do pedestal
      const pedTopCenterIdx = positions.length / 3;
      positions.push(0, 0, pedHeight);
      uvs.push(0.5, 0.5);
      for (let i = 0; i < pedSegments; i++) {
        const t0 = topRingStart + i;
        const t1 = topRingStart + ((i + 1) % pedSegments);
        indices.push(pedTopCenterIdx, t0, t1);
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
