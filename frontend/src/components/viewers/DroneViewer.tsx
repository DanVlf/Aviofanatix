import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

type Props = {
  glbUrl?: string;
  pitch?: number;
  roll?: number;
  yaw?: number;
};

type RotatableObject = {
  rotation: {
    order: string;
    x: number;
    y: number;
    z: number;
  };
};

const applyTelemetryRotation = (object: RotatableObject, pitch: number, roll: number, yaw: number) => {
  object.rotation.order = "YXZ";
  object.rotation.x = THREE.MathUtils.degToRad(pitch);
  object.rotation.y = THREE.MathUtils.degToRad(yaw);
  object.rotation.z = THREE.MathUtils.degToRad(roll);
};

export function DroneViewer({ glbUrl, pitch = 0, roll = 0, yaw = 0 }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{
    renderer: any;
    scene: any;
    camera: any;
    drone: any;
    animId: number;
  } | null>(null);
  const [fileInput, setFileInput] = useState<string | null>(glbUrl ?? null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const w = el.clientWidth;
    const h = el.clientHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
    camera.position.set(0, 1.8, 4.5);
    camera.lookAt(0, 0, 0);

    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(4, 8, 4);
    dir.castShadow = true;
    scene.add(dir);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.4);
    fill.position.set(-4, -2, -4);
    scene.add(fill);

    const grid = new THREE.GridHelper(6, 12, 0x334455, 0x223344);
    (grid.material as any).opacity = 0.25;
    (grid.material as any).transparent = true;
    grid.position.y = -1.2;
    scene.add(grid);

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.18, 0.8),
      new THREE.MeshStandardMaterial({ color: 0x1a2a3a, metalness: 0.7, roughness: 0.3 })
    );
    const armMat = new THREE.MeshStandardMaterial({ color: 0x223344, metalness: 0.5, roughness: 0.4 });
    const propMat = new THREE.MeshStandardMaterial({ color: 0x17a2b8, metalness: 0.3, roughness: 0.5 });

    const armPositions: [number, number, number][] = [
      [0.5, 0, 0.5],
      [-0.5, 0, 0.5],
      [0.5, 0, -0.5],
      [-0.5, 0, -0.5],
    ];

    const drone = new THREE.Group();
    drone.add(body);

    armPositions.forEach(([x, y, z]) => {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.7), armMat);
      arm.position.set(x * 0.5, y, z * 0.5);
      arm.rotation.y = Math.atan2(x, z);
      drone.add(arm);

      const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 12), armMat);
      motor.position.set(x, 0.06, z);
      drone.add(motor);

      const prop = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.02, 0.08), propMat);
      prop.position.set(x, 0.12, z);
      drone.add(prop);
    });

    scene.add(drone);
    applyTelemetryRotation(drone, pitch, roll, yaw);

    let isDragging = false;
    let prevX = 0;
    let prevY = 0;
    let autoYaw = 0;
    let manualYaw = 0;
    let manualPitch = 0.2;

    const onMouseDown = (e: MouseEvent) => { isDragging = true; prevX = e.clientX; prevY = e.clientY; };
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      manualYaw += (e.clientX - prevX) * 0.01;
      manualPitch += (e.clientY - prevY) * 0.005;
      manualPitch = Math.max(-0.5, Math.min(0.8, manualPitch));
      prevX = e.clientX;
      prevY = e.clientY;
    };
    const onMouseUp = () => { isDragging = false; };

    renderer.domElement.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    let frameId = 0;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      if (!isDragging) autoYaw += 0.003;

      const totalYaw = autoYaw + manualYaw;
      camera.position.x = Math.sin(totalYaw) * 4.5 * Math.cos(manualPitch);
      camera.position.z = Math.cos(totalYaw) * 4.5 * Math.cos(manualPitch);
      camera.position.y = Math.sin(manualPitch) * 4.5 + 1;
      camera.lookAt(0, 0, 0);

      renderer.render(scene, camera);
    };
    animate();

    sceneRef.current = { renderer, scene, camera, drone, animId: frameId };

    const onResize = () => {
      if (!el) return;
      const w2 = el.clientWidth;
      const h2 = el.clientHeight;
      renderer.setSize(w2, h2);
      camera.aspect = w2 / h2;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(frameId);
      renderer.domElement.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    applyTelemetryRotation(s.drone as RotatableObject, pitch, roll, yaw);
  }, [pitch, roll, yaw]);

  useEffect(() => {
    if (!fileInput || !sceneRef.current) return;
    import("three/examples/jsm/loaders/GLTFLoader.js")
      .then(({ GLTFLoader }) => {
        const loader = new GLTFLoader();
        loader.load(fileInput, (gltf: any) => {
          const s = sceneRef.current;
          if (!s) return;
          s.scene.remove(s.drone);
          const model = gltf.scene;
          const box = new THREE.Box3().setFromObject(model);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);
          model.position.sub(center);
          model.scale.setScalar(2 / maxDim);
          applyTelemetryRotation(model, pitch, roll, yaw);
          s.scene.add(model);
          (s as any).drone = model;
        });
      })
      .catch(() => {});
  }, [fileInput, pitch, roll, yaw]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setFileInput(url);
  };

  return (
    <div className="panel drone-panel">
      <div className="panel-header">
        <h3>Drone Model</h3>
        <button className="glb-upload-btn" onClick={() => inputRef.current?.click()}>
          Load GLB
        </button>
        <input ref={inputRef} type="file" accept=".glb,.gltf" style={{ display: "none" }} onChange={handleFile} />
      </div>
      <div className="drone-viewport" ref={mountRef} />
    </div>
  );
}
