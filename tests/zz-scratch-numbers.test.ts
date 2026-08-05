import { it } from "vitest";
import { roomsContract, scene, hitTargetMin } from "../src/config/design";
import { visibleZones } from "../src/components/scene/zones";
import { rooms } from "../src/config/design";
import {
  sceneBand,
  sceneGap,
  sceneVisible,
  zoneOnScreen,
  zoneHitBox,
  clearBand,
  immersiveLayout,
  type Screen,
} from "../src/components/scene/immersive-layout";

const allZones = roomsContract.rooms.flatMap((room) =>
  room.zones.map((zone) => ({ id: `${room.id}/${zone.key}`, rect: zone.rect })),
);

const listed = new Set(
  rooms.flatMap((room) => visibleZones(room.zones, []).map((z) => `${room.id}/${z.key}`)),
);

const SCREENS: Screen[] = [
  { w: 1920, h: 1080 },
  { w: 1440, h: 900 },
  { w: 1280, h: 800 },
  { w: 1024, h: 768 },
  { w: 1280, h: 720 },
  { w: 2560, h: 800 },
];

it("numbers", () => {
  for (const s of SCREENS) {
    const b = sceneBand("desktop", s);
    const v = sceneVisible("desktop", s);
    const g = sceneGap("desktop", s);
    console.log(
      `\n=== ${s.w}x${s.h} band left=${b.left} top=${b.top} w=${b.width} h=${b.height} | visible ${JSON.stringify(v)} | gap ${JSON.stringify(g)}`,
    );
    const gone = allZones.filter(({ rect }) => {
      const hit = zoneHitBox(rect, "desktop", s);
      return hit.width <= 0 || hit.height <= 0;
    });
    const small = allZones.filter(({ rect }) => {
      const hit = zoneHitBox(rect, "desktop", s);
      return hit.width > 0 && hit.height > 0 && (hit.width < 44 - 0.05 || hit.height < 44 - 0.05);
    });
    console.log(`  срезаны целиком: ${gone.length} ${JSON.stringify(gone.map((z) => z.id))}`);
    console.log(
      `  цель меньше 44: ${small.length} ${JSON.stringify(
        small.map((z) => `${z.id} ${zoneHitBox(z.rect, "desktop", s).width.toFixed(1)}x${zoneHitBox(z.rect, "desktop", s).height.toFixed(1)}`),
      )}`,
    );
    console.log(`  из срезанных нет в указателе: ${JSON.stringify(gone.map((z) => z.id).filter((id) => !listed.has(id)))}`);
    const free = clearBand("desktop", s);
    const underTop = allZones.filter(({ rect }) => {
      const box = zoneOnScreen(rect, "desktop", s);
      return box.top + box.height <= free.top;
    });
    const underBottom = allZones.filter(({ rect }) => {
      const box = zoneOnScreen(rect, "desktop", s);
      return box.top >= free.bottom;
    });
    const touchTop = allZones.filter(({ rect }) => {
      const box = zoneOnScreen(rect, "desktop", s);
      return box.top < free.top && box.top + box.height > free.top;
    });
    const touchBottom = allZones.filter(({ rect }) => {
      const box = zoneOnScreen(rect, "desktop", s);
      return box.top + box.height > free.bottom && box.top < free.bottom;
    });
    console.log(
      `  под верхней полосой целиком: ${underTop.length} ${JSON.stringify(underTop.map((z) => z.id))}`,
    );
    console.log(
      `  под нижней полосой целиком: ${underBottom.length} ${JSON.stringify(underBottom.map((z) => z.id))}`,
    );
    console.log(`  задеты верхней: ${touchTop.length}; задеты нижней: ${touchBottom.length}`);
  }
  // Телефон — контроль неизменности
  for (const s of [
    { w: 430, h: 932 },
    { w: 375, h: 812 },
    { w: 390, h: 844 },
  ]) {
    const b = sceneBand("phone", s);
    console.log(`PHONE ${s.w}x${s.h}: ${JSON.stringify(b)} visible ${JSON.stringify(sceneVisible("phone", s))}`);
  }
  console.log("sidePad", immersiveLayout.phone.sidePad, immersiveLayout.desktop.sidePad, hitTargetMin, scene.desktop);
});
