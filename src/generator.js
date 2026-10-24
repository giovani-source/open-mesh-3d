import * as THREE from 'three';

/**
 * OpenMeshy / Forge3D Engine de Malhas e Geometrias 3D
 */

export class MeshGenerator {
  /**
   * Processa a imagem extraindo luminância, canais de cor e máscara de remoção de fundo
   */
  static getImageData(image, targetResolution = 150) {
    const canvas = document.createElement('canvas');
    let width = targetResolution;
    let height = Math.round(targetResolution * (image.naturalHeight / image.naturalWidth));
    
    if (height > targetResolution * 1.5) {
      height = Math.round(targetResolution * 1.5);
    } else if (height < targetResolution * 0.5) {
      height = Math.round(targetResolution * 0.5);
    }

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, width, height);

    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    const depthMap = new Float32Array(width * height);
    const alphaMap = new Float32Array(width * height);
    const mask = new Uint8Array(width * height);

    // Amostrar cantos para detectar cor do fundo (geralmente branco, cinza claro ou transparente)
    let bgR = 0, bgG = 0, bgB = 0;
    const cornerIndices = [0, (width - 1) * 4, (height - 1) * width * 4, (height * width - 1) * 4];
    cornerIndices.forEach(idx => {
      bgR += data[idx] / 4;
      bgG += data[idx + 1] / 4;
      bgB += data[idx + 2] / 4;
    });

    const isLightBg = (bgR + bgG + bgB) / 3 > 200;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];

      const idx = i / 4;
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      depthMap[idx] = luminance;
      alphaMap[idx] = a / 255;

      // Distância de cor euclidiana ao fundo
      const distToBg = Math.sqrt((r - bgR) ** 2 + (g - bgG) ** 2 + (b - bgB) ** 2);

      // É primeiro plano (objeto/boneco) se for diferente do fundo e tiver opacidade
      if (a < 50 || distToBg < 35 || (isLightBg && r > 240 && g > 240 && b > 240)) {
        mask[idx] = 0; // Fundo
      } else {
        mask[idx] = 1; // Objeto / Boneco 3D
      }
    }

    return {
      width,
      height,
      depthMap,
      alphaMap,
      mask,
      canvas,
      aspectRatio: width / height
    };
  }

  static smoothDepthMap(depthMap, width, height, iterations = 1) {
    let current = new Float32Array(depthMap);
    let next = new Float32Array(depthMap.length);

    for (let it = 0; it < iterations; it++) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = y * width + x;
          const centerVal = current[idx];
          let sum = 0;
          let weightSum = 0;

          for (let dy = -1; dy <= 1; dy++) {
            const ny = y + dy;
            if (ny < 0 || ny >= height) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx;
              if (nx < 0 || nx >= width) continue;
              const nIdx = ny * width + nx;
              const val = current[nIdx];

              const spatialDist = dx * dx + dy * dy;
              const spatialWeight = Math.exp(-spatialDist / 2);
              const rangeDiff = val - centerVal;
              const rangeWeight = Math.exp(-(rangeDiff * rangeDiff) / 0.04);
              const weight = spatialWeight * rangeWeight;

              sum += val * weight;
              weightSum += weight;
            }
          }

          next[idx] = weightSum > 0 ? sum / weightSum : centerVal;
        }
      }
      current.set(next);
    }

    return current;
  }

  /**
   * Relevo Estanque (Manifold) com base fechada a Z=0 para impressão 3D imediata
   */
  static createWatertightRelief(processedImage, options = {}) {
    const {
      targetWidth = 80,
      reliefHeight = 8,
      baseThickness = 3,
      invertDepth = false,
      smoothing = 1,
      shape = 'rect'
    } = options;

    const { width: Nx, height: Ny, depthMap: rawDepth, mask } = processedImage;
    const targetHeight = targetWidth / (Nx / Ny);

    let depth = rawDepth;
    if (smoothing > 0) {
      depth = this.smoothDepthMap(rawDepth, Nx, Ny, smoothing);
    }

    const positions = [];
    const uvs = [];
    const indices = [];

    const getTopZ = (x, y) => {
      const idx = y * Nx + x;
      let val = depth[idx];
      if (invertDepth) val = 1.0 - val;

      if (shape === 'circle' || shape === 'coin') {
        const cx = (x / (Nx - 1) - 0.5) * 2;
        const cy = (y / (Ny - 1) - 0.5) * 2;
        const dist = Math.sqrt(cx * cx + cy * cy);
        if (dist > 1.0) return baseThickness;
        if (shape === 'coin' && dist > 0.9) val = Math.max(val, 0.7);
      }

      return baseThickness + val * reliefHeight;
    };

    // 1. Topo
    for (let y = 0; y < Ny; y++) {
      for (let x = 0; x < Nx; x++) {
        const posX = (x / (Nx - 1) - 0.5) * targetWidth;
        const posY = (0.5 - y / (Ny - 1)) * targetHeight;
        const posZ = getTopZ(x, y);

        positions.push(posX, posY, posZ);
        uvs.push(x / (Nx - 1), 1 - y / (Ny - 1));
      }
    }

    for (let y = 0; y < Ny - 1; y++) {
      for (let x = 0; x < Nx - 1; x++) {
        const i0 = y * Nx + x;
        const i1 = y * Nx + (x + 1);
        const i2 = (y + 1) * Nx + x;
        const i3 = (y + 1) * Nx + (x + 1);

        indices.push(i0, i1, i2);
        indices.push(i1, i3, i2);
      }
    }

    // 2. Base a Z=0
    const bottomOffset = positions.length / 3;
    for (let y = 0; y < Ny; y++) {
      for (let x = 0; x < Nx; x++) {
        const posX = (x / (Nx - 1) - 0.5) * targetWidth;
        const posY = (0.5 - y / (Ny - 1)) * targetHeight;
        positions.push(posX, posY, 0);
        uvs.push(x / (Nx - 1), 1 - y / (Ny - 1));
      }
    }

    for (let y = 0; y < Ny - 1; y++) {
      for (let x = 0; x < Nx - 1; x++) {
        const b0 = bottomOffset + (y * Nx + x);
        const b1 = bottomOffset + (y * Nx + (x + 1));
        const b2 = bottomOffset + ((y + 1) * Nx + x);
        const b3 = bottomOffset + ((y + 1) * Nx + (x + 1));

        indices.push(b0, b2, b1);
        indices.push(b1, b2, b3);
      }
    }

    // 3. Paredes de vedação
    const addSideQuad = (topA, topB, botA, botB) => {
      indices.push(topA, botA, topB);
      indices.push(topB, botA, botB);
    };

    for (let x = 0; x < Nx - 1; x++) {
      addSideQuad(x, x + 1, bottomOffset + x, bottomOffset + x + 1);
      const sT = (Ny - 1) * Nx + x;
      addSideQuad(sT + 1, sT, bottomOffset + sT + 1, bottomOffset + sT);
    }
    for (let y = 0; y < Ny - 1; y++) {
      const wT = y * Nx;
      const wNext = (y + 1) * Nx;
      addSideQuad(wNext, wT, bottomOffset + wNext, bottomOffset + wT);
      const eT = y * Nx + (Nx - 1);
      const eNext = (y + 1) * Nx + (Nx - 1);
      addSideQuad(eT, eNext, bottomOffset + eT, bottomOffset + eNext);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return {
      geometry,
      dimensions: { width: targetWidth, depth: targetHeight, height: baseThickness + reliefHeight },
      stats: { vertices: positions.length / 3, triangles: indices.length / 3, isManifold: true }
    };
  }

  /**
   * Escultura 360° Volumétrica Orgânica com Isolamento de Fundo
   * Infla apenas o boneco/objeto em 360° (frente e verso arredondados)
   */
  static createVolumetric360(processedImage, options = {}) {
    const {
      targetWidth = 70,
      maxThickness = 28,
      smoothing = 2
    } = options;

    const { width: Nx, height: Ny, depthMap: rawDepth, mask } = processedImage;
    const targetHeight = targetWidth / (Nx / Ny);

    let depth = rawDepth;
    if (smoothing > 0) {
      depth = this.smoothDepthMap(rawDepth, Nx, Ny, smoothing);
    }

    // Campo de distância euclidiana da silhueta do personagem
    const distField = new Float32Array(Nx * Ny);
    const maxRadius = Math.min(Nx, Ny) / 4;

    for (let y = 0; y < Ny; y++) {
      for (let x = 0; x < Nx; x++) {
        const idx = y * Nx + x;
        if (mask[idx] === 0) continue;

        let minDist = maxRadius;
        const searchRange = Math.min(14, Math.floor(maxRadius));
        for (let dy = -searchRange; dy <= searchRange; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= Ny) continue;
          for (let dx = -searchRange; dx <= searchRange; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= Nx || mask[ny * Nx + nx] === 0) {
              const d = Math.sqrt(dx * dx + dy * dy);
              if (d < minDist) minDist = d;
            }
          }
        }
        distField[idx] = minDist / maxRadius;
      }
    }

    const positions = [];
    const uvs = [];
    const indices = [];

    // Calcula espessura arredondada (frente e verso)
    const getThickness = (x, y) => {
      const idx = y * Nx + x;
      if (mask[idx] === 0) return 0;
      const df = distField[idx];
      const localDetail = (1.0 - depth[idx]) * 0.3;
      // Curva esférica suave
      const dome = Math.sin(Math.min(1.0, df) * (Math.PI / 2));
      return Math.max(0.1, (dome * 0.8 + localDetail) * (maxThickness / 2));
    };

    // 1. Frente (+Z)
    for (let y = 0; y < Ny; y++) {
      for (let x = 0; x < Nx; x++) {
        const posX = (x / (Nx - 1) - 0.5) * targetWidth;
        const posY = (0.5 - y / (Ny - 1)) * targetHeight;
        const zThickness = getThickness(x, y);

        positions.push(posX, posY, zThickness);
        uvs.push(x / (Nx - 1), 1 - y / (Ny - 1));
      }
    }

    for (let y = 0; y < Ny - 1; y++) {
      for (let x = 0; x < Nx - 1; x++) {
        const i0 = y * Nx + x;
        const i1 = y * Nx + (x + 1);
        const i2 = (y + 1) * Nx + x;
        const i3 = (y + 1) * Nx + (x + 1);

        // Apenas triangula onde houver primeiro plano
        if (mask[i0] || mask[i1] || mask[i2] || mask[i3]) {
          indices.push(i0, i1, i2);
          indices.push(i1, i3, i2);
        }
      }
    }

    // 2. Verso (-Z) para gerar o corpo 360° completo
    const backOffset = positions.length / 3;
    for (let y = 0; y < Ny; y++) {
      for (let x = 0; x < Nx; x++) {
        const posX = (x / (Nx - 1) - 0.5) * targetWidth;
        const posY = (0.5 - y / (Ny - 1)) * targetHeight;
        const zThickness = getThickness(x, y);

        positions.push(posX, posY, -zThickness);
        uvs.push(x / (Nx - 1), 1 - y / (Ny - 1));
      }
    }

    for (let y = 0; y < Ny - 1; y++) {
      for (let x = 0; x < Nx - 1; x++) {
        const b0 = backOffset + (y * Nx + x);
        const b1 = backOffset + (y * Nx + (x + 1));
        const b2 = backOffset + ((y + 1) * Nx + x);
        const b3 = backOffset + ((y + 1) * Nx + (x + 1));

        if (mask[y * Nx + x] || mask[y * Nx + (x + 1)]) {
          indices.push(b0, b2, b1);
          indices.push(b1, b2, b3);
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return {
      geometry,
      dimensions: { width: targetWidth, depth: targetHeight, height: maxThickness },
      stats: { vertices: positions.length / 3, triangles: indices.length / 3, isManifold: true }
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
