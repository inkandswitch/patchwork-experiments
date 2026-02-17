import { useState, useRef, useMemo, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import { Html } from '@react-three/drei/web/Html';
import * as THREE from 'three';
import type { AutomergeUrl } from '@automerge/automerge-repo';
import type { Point3D } from './projection';
import type { LeafDoc } from './tool';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScenePoint = {
  leaf: LeafDoc;
  position: Point3D;
};

type SceneViewProps = {
  points: ScenePoint[];
  onBack: () => void;
};

// ---------------------------------------------------------------------------
// Color palette by folder path
// ---------------------------------------------------------------------------

const PALETTE = [
  '#6366f1', // indigo
  '#f59e0b', // amber
  '#10b981', // emerald
  '#ef4444', // red
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#f97316', // orange
  '#ec4899', // pink
  '#14b8a6', // teal
  '#84cc16', // lime
];

function pathColor(path: string[]): string {
  const key = path.join('/') || '__root__';
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

// ---------------------------------------------------------------------------
// Point sphere component
// ---------------------------------------------------------------------------

type PointSphereProps = {
  point: ScenePoint;
  color: string;
  isHovered: boolean;
  onHover: (url: AutomergeUrl | null) => void;
};

function PointSphere({ point, color, isHovered, onHover }: PointSphereProps) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const baseScale = 0.12;
  const targetScale = isHovered ? 0.22 : baseScale;

  useFrame(() => {
    if (meshRef.current) {
      const s = meshRef.current.scale.x;
      const next = s + (targetScale - s) * 0.2;
      meshRef.current.scale.setScalar(next);
    }
  });

  return (
    <mesh
      ref={meshRef}
      position={point.position}
      onPointerOver={(e) => {
        e.stopPropagation();
        onHover(point.leaf.doc.url);
      }}
      onPointerOut={() => onHover(null)}
    >
      <sphereGeometry args={[1, 16, 16]} />
      <meshStandardMaterial
        color={color}
        emissive={isHovered ? color : '#000000'}
        emissiveIntensity={isHovered ? 0.4 : 0}
      />
      {isHovered && (
        <Html distanceFactor={10} style={{ pointerEvents: 'none' }}>
          <div className="bg-base-300 text-base-content text-xs rounded px-2 py-1 shadow-lg whitespace-nowrap">
            <div className="font-semibold">{point.leaf.doc.name}</div>
            {point.leaf.path.length > 0 && (
              <div className="text-base-content/60">
                {point.leaf.path.join('/')}
              </div>
            )}
          </div>
        </Html>
      )}
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Scene content (inside Canvas)
// ---------------------------------------------------------------------------

function SceneContent({
  points,
  hoveredUrl,
  onHover,
}: {
  points: ScenePoint[];
  hoveredUrl: AutomergeUrl | null;
  onHover: (url: AutomergeUrl | null) => void;
}) {
  const colorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of points) {
      const key = p.leaf.path.join('/');
      if (!map.has(key)) {
        map.set(key, pathColor(p.leaf.path));
      }
    }
    return map;
  }, [points]);

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 10, 5]} intensity={0.8} />
      <OrbitControls makeDefault />

      {points.map((point) => {
        const key = point.leaf.path.join('/');
        return (
          <PointSphere
            key={point.leaf.doc.url}
            point={point}
            color={colorMap.get(key) ?? PALETTE[0]}
            isHovered={hoveredUrl === point.leaf.doc.url}
            onHover={onHover}
          />
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main SceneView component
// ---------------------------------------------------------------------------

export function SceneView({ points, onBack }: SceneViewProps) {
  const [hoveredUrl, setHoveredUrl] = useState<AutomergeUrl | null>(null);

  return (
    <div className="h-full w-full relative">
      {/* Top-left controls overlay */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
        <button className="btn btn-sm btn-ghost bg-base-100/80 backdrop-blur" onClick={onBack}>
          Back to table
        </button>
        <span className="badge badge-ghost bg-base-100/80 backdrop-blur">{points.length} points</span>
      </div>

      {/* 3D Canvas — fills entire area */}
      <Canvas camera={{ position: [8, 6, 8], fov: 50 }}>
        <SceneContent
          points={points}
          hoveredUrl={hoveredUrl}
          onHover={setHoveredUrl}
        />
      </Canvas>
    </div>
  );
}
