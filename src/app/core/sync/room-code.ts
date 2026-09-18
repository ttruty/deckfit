/** Room codes are 6 characters (§7). Case-insensitive on input, uppercase canonical. */
const ROOM_CODE = /^[A-Z0-9]{6}$/;

export function normalizeRoomCode(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  return ROOM_CODE.test(code) ? code : null;
}
