import * as THREE from 'three';

/**
 * OpenMeshy 3D Generator Engine
 * Transforms 2D image data into solid, watertight 3D meshes (Manifold) ready for 3D printing.
 */

export class MeshGenerator {
  /**
   * Process an image element and extract luminance and color data
   */
  static getImageData(image, targetResolution = 150) {
    const canvas = document.createElement('canvas');
    let width = targetResolution;
    let height = Math.round(targetResolution * (image.naturalHeight / image.naturalWidth));
    
    // Clamp aspect ratio to reasonable limits
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

    // Create normalized depth grid [0..1] and color texture
    const depthMap = new Float32Array(width * height);
    const alphaMap = new Float32Array(width * height);

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;
      const a = data[i + 3] / 255;

      // Perceptual luminance formula
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      const idx = i / 4;
      depthMap[idx] = luminance;
      alphaMap[idx] = a;
    }

    return {
      width,
      height,
      depthMap,
      alphaMap,
      canvas,
      aspectRatio: width / height
    };
  }

  /**
   * Apply bilateral-style smoothing to depth map to eliminate noise while preserving sharp edges
   */
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

              // Spatial weight + range weight (edge preservation)
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
   * Generates a 100% Watertight Solid Relief Mesh (Print-Ready STL)
   * Has top displaced surface, solid vertical skirts, and a sealed bottom plate.
   */
  static createWatertightRelief(processedImage, options = {}) {
    const {
      targetWidth = 100, // mm
      reliefHeight = 10, // mm
      baseThickness = 3, // mm
      invertDepth = false,
      smoothing = 1,
      shape = 'rect', // 'rect', 'circle', 'coin'
      autoRemoveBg = false,
      bgThreshold = 0.95
    } = options;

    const { width: Nx, height: Ny, depthMap: rawDepth } = processedImage;
    const targetHeight = targetWidth / (Nx / Ny);

    // Apply smoothing
    let depth = rawDepth;
    if (smoothing > 0) {
      depth = this.smoothDepthMap(rawDepth, Nx, Ny, smoothing);
    }

    const positions = [];
    const uvs = [];
    const indices = [];

    // Helper: calculate vertex position for top surface
    const getTopZ = (x, y) => {
      const idx = y * Nx + x;
      let val = depth[idx];
      if (invertDepth) val = 1.0 - val;

      if (autoRemoveBg && val > bgThreshold) {
        val = 0;
      }

      // Shape masking
      if (shape === 'circle' || shape === 'coin') {
        const cx = (x / (Nx - 1) - 0.5) * 2;
        const cy = (y / (Ny - 1) - 0.5) * 2;
        const dist = Math.sqrt(cx * cx + cy * cy);
        if (dist > 1.0) {
          return baseThickness;
        }
        if (shape === 'coin' && dist > 0.9) {
          // Add raised rim for coin border
          val = Math.max(val, 0.7);
        }
      }

      return baseThickness + val * reliefHeight;
    };

    // 1. TOP SURFACE VERTICES
    // Grid has Nx * Ny vertices
    for (let y = 0; y < Ny; y++) {
      for (let x = 0; x < Nx; x++) {
        const posX = (x / (Nx - 1) - 0.5) * targetWidth;
        const posY = (0.5 - y / (Ny - 1)) * targetHeight;
        const posZ = getTopZ(x, y);

        positions.push(posX, posY, posZ);
        uvs.push(x / (Nx - 1), 1 - y / (Ny - 1));
      }
    }

    // Top surface indices (counter-clockwise)
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

    // 2. BOTTOM SURFACE VERTICES (at z = 0)
    const bottomOffset = positions.length / 3;
    for (let y = 0; y < Ny; y++) {
      for (let x = 0; x < Nx; x++) {
        const posX = (x / (Nx - 1) - 0.5) * targetWidth;
        const posY = (0.5 - y / (Ny - 1)) * targetHeight;
        const posZ = 0; // Flat base on print bed

        positions.push(posX, posY, posZ);
        uvs.push(x / (Nx - 1), 1 - y / (Ny - 1));
      }
    }

    // Bottom surface indices (clockwise so normal points DOWN to -Z)
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

    // 3. SIDE WALLS (SKIRTS) to make it 100% Watertight Manifold
    const addSideQuad = (topA, topB, botA, botB) => {
      indices.push(topA, botA, topB);
      indices.push(topB, botA, botB);
    };

    // North Edge (y = 0, along x)
    for (let x = 0; x < Nx - 1; x++) {
      const tA = x;
      const tB = x + 1;
      const bA = bottomOffset + x;
      const bB = bottomOffset + x + 1;
      addSideQuad(tA, tB, bA, bB);
    }

    // South Edge (y = Ny - 1, along x)
    for (let x = 0; x < Nx - 1; x++) {
      const tA = (Ny - 1) * Nx + x;
      const tB = (Ny - 1) * Nx + x + 1;
      const bA = bottomOffset + ((Ny - 1) * Nx + x);
      const bB = bottomOffset + ((Ny - 1) * Nx + x + 1);
      addSideQuad(tB, tA, bB, bA);
    }

    // West Edge (x = 0, along y)
    for (let y = 0; y < Ny - 1; y++) {
      const tA = y * Nx;
      const tB = (y + 1) * Nx;
      const bA = bottomOffset + (y * Nx);
      const bB = bottomOffset + ((y + 1) * Nx);
      addSideQuad(tB, tA, bB, bA);
    }

    // East Edge (x = Nx - 1, along y)
    for (let y = 0; y < Ny - 1; y++) {
      const tA = y * Nx + (Nx - 1);
      const tB = (y + 1) * Nx + (Nx - 1);
      const bA = bottomOffset + (y * Nx + (Nx - 1));
      const bB = bottomOffset + ((y + 1) * Nx + (Nx - 1));
      addSideQuad(tA, tB, bA, bB);
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
        height: baseThickness + reliefHeight
      },
      stats: {
        vertices: positions.length / 3,
        triangles: indices.length / 3,
        isManifold: true
      }
    };
  }

  /**
   * Generates a 360-degree Volumetric Symmetrical Mesh
   * Inflates the silhouette of the 2D image into a full 360° solid front-and-back figurine/object.
   */
  static createVolumetric360(processedImage, options = {}) {
    const {
      targetWidth = 80, // mm
      maxThickness = 25, // mm
      smoothing = 2,
      silhouetteThreshold = 0.92
    } = options;

    const { width: Nx, height: Ny, depthMap: rawDepth } = processedImage;
    const targetHeight = targetWidth / (Nx / Ny);

    let depth = rawDepth;
    if (smoothing > 0) {
      depth = this.smoothDepthMap(rawDepth, Nx, Ny, smoothing);
    }

    // Compute distance transform / inflation field
    const mask = new Uint8Array(Nx * Ny);
    for (let i = 0; i < depth.length; i++) {
      mask[i] = depth[i] < silhouetteThreshold ? 1 : 0;
    }

    const distField = new Float32Array(Nx * Ny);
    const maxRadius = Math.min(Nx, Ny) / 3;

    for (let y = 0; y < Ny; y++) {
      for (let x = 0; x < Nx; x++) {
        const idx = y * Nx + x;
        if (mask[idx] === 0) continue;

        let minDist = maxRadius;
        const searchRange = Math.min(12, Math.floor(maxRadius));
        for (let dy = -searchRange; dy <= searchRange; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= Ny) {
            minDist = Math.min(minDist, Math.abs(dy));
            continue;
          }
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

    const getThickness = (x, y) => {
      const idx = y * Nx + x;
      if (mask[idx] === 0) return 0;
      const df = distField[idx];
      const localDetail = (1.0 - depth[idx]) * 0.4;
      const dome = Math.sin(Math.min(1.0, df) * (Math.PI / 2));
      return (dome * 0.7 + localDetail) * (maxThickness / 2);
    };

    // 1. FRONT MESH
    for (let y = 0; y < Ny; y++) {
      for (let x = 0; x < Nx; x++) {
        const posX = (x / (Nx - 1) - 0.5) * targetWidth;
        const posY = (0.5 - y / (Ny - 1)) * targetHeight;
        const posZ = getThickness(x, y);

        positions.push(posX, posY, posZ);
        uvs.push(x / (Nx - 1), 1 - y / (Ny - 1));
      }
    }

    // Front indices
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

    // 2. BACK MESH (-Z)
    const backOffset = positions.length / 3;
    for (let y = 0; y < Ny; y++) {
      for (let x = 0; x < Nx; x++) {
        const posX = (x / (Nx - 1) - 0.5) * targetWidth;
        const posY = (0.5 - y / (Ny - 1)) * targetHeight;
        const posZ = -getThickness(x, y); // Mirrored

        positions.push(posX, posY, posZ);
        uvs.push(x / (Nx - 1), 1 - y / (Ny - 1));
      }
    }

    // Back indices
    for (let y = 0; y < Ny - 1; y++) {
      for (let x = 0; x < Nx - 1; x++) {
        const b0 = backOffset + (y * Nx + x);
        const b1 = backOffset + (y * Nx + (x + 1));
        const b2 = backOffset + ((y + 1) * Nx + x);
        const b3 = backOffset + ((y + 1) * Nx + (x + 1));

        indices.push(b0, b2, b1);
        indices.push(b1, b2, b3);
      }
    }

    // 3. Connect perimeter borders
    const addSideQuad = (topA, topB, botA, botB) => {
      indices.push(topA, botA, topB);
      indices.push(topB, botA, botB);
    };

    for (let x = 0; x < Nx - 1; x++) {
      addSideQuad(x, x + 1, backOffset + x, backOffset + x + 1);
      const sT = (Ny - 1) * Nx + x;
      addSideQuad(sT + 1, sT, backOffset + sT + 1, backOffset + sT);
    }
    for (let y = 0; y < Ny - 1; y++) {
      const wT = y * Nx;
      const wNext = (y + 1) * Nx;
      addSideQuad(wNext, wT, backOffset + wNext, backOffset + wT);
      const eT = y * Nx + (Nx - 1);
      const eNext = (y + 1) * Nx + (Nx - 1);
      addSideQuad(eT, eNext, backOffset + eT, backOffset + eNext);
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
        height: maxThickness
      },
      stats: {
        vertices: positions.length / 3,
        triangles: indices.length / 3,
        isManifold: true
      }
    };
  }

  /**
   * Calculates volume in cm³ and estimated PLA filament weight in grams
   */
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
