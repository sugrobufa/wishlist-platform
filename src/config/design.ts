// Типизированный доступ к handoff-контрактам дизайн-пакета.
// Значения не копируются в код — импортируются из единственного источника.
import roomsJson from "@design/rooms.json";
import zonesJson from "@design/zones.json";
import motionJson from "@design/motion.json";

export type ZoneRect = { x: number; y: number; w: number; h: number };

export type RoomZone = {
  key: string;
  label: string;
  pool: string;
  rect: ZoneRect;
  openFrame?: string;
  openVerb?: string;
};

export type Room = {
  id: string;
  name: string;
  sex: "F" | "M";
  accent: string;
  ink: string;
  base: string;
  zones: RoomZone[];
};

type RoomsContract = {
  scene: {
    phone: { w: number; h: number; image: { w: number; h: number; x: number; y: number } };
    desktop: { w: number; h: number; factorFromPhone: number };
  };
  cameraScale: { phone: number; desktop: number };
  hitTargetMin: number;
  rooms: Room[];
};

export const roomsContract = roomsJson as unknown as RoomsContract;
export const rooms = roomsContract.rooms;
export const scene = roomsContract.scene;
export const cameraScale = roomsContract.cameraScale;
export const zoneCatalog = zonesJson as Record<string, unknown>;
export const motion = motionJson as Record<string, unknown>;

/** Десктопные координаты выводятся, отдельной карты не существует (контракт). */
export function toDesktopRect(rect: ZoneRect): ZoneRect {
  const f = roomsContract.scene.desktop.factorFromPhone;
  return {
    x: (rect.x + Math.abs(roomsContract.scene.phone.image.x)) * f,
    y: rect.y * f,
    w: rect.w * f,
    h: rect.h * f,
  };
}
