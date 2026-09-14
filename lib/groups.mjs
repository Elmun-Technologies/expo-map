/*
 * app/groups.js faylini Node'dan ishlatish uchun yupqa qatlam.
 * Manba bitta: app/groups.js (brauzer ham, Node ham shundan foydalanadi).
 */
import fs from 'node:fs';
import vm from 'node:vm';

const SRC_PATH = new URL('../app/groups.js', import.meta.url);
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(SRC_PATH, 'utf8'), sandbox, { filename: 'app/groups.js' });

const api = sandbox.ExpoGroups;
if (!api) throw new Error("app/groups.js yuklanmadi (ExpoGroups topilmadi)");

export const groupBookings = api.groupBookings;
export const unionPath = api.unionPath;
export const fitText = api.fitText;
export const largestRect = api.largestRect;
export const mergedAsStands = api.mergedAsStands;
export const fitLabel = api.fitLabel;
export const textWidth = api.textWidth;
export const charWidth = api.charWidth;
export default api;
