/*
 * Тонкая прослойка, чтобы использовать app/groups.js из Node.
 * Источник один: app/groups.js (и браузер, и Node берут его отсюда).
 */
import fs from 'node:fs';
import vm from 'node:vm';

const SRC_PATH = new URL('../app/groups.js', import.meta.url);
const METRICS_PATH = new URL('../app/dejavu-metrics.js', import.meta.url);
const sandbox = { console };
// окно-заглушка: таблица ширин DejaVu кладётся так же, как её видит браузер
sandbox.window = sandbox;
vm.createContext(sandbox);
if (fs.existsSync(METRICS_PATH)) {
  vm.runInContext(fs.readFileSync(METRICS_PATH, 'utf8'), sandbox, { filename: 'app/dejavu-metrics.js' });
}
vm.runInContext(fs.readFileSync(SRC_PATH, 'utf8'), sandbox, { filename: 'app/groups.js' });

const api = sandbox.ExpoGroups;
if (!api) throw new Error('app/groups.js не загрузился (ExpoGroups не найден)');

export const groupBookings = api.groupBookings;
export const unionPath = api.unionPath;
export const fitText = api.fitText;
export const largestRect = api.largestRect;
export const mergedAsStands = api.mergedAsStands;
export const fitLabel = api.fitLabel;
export const textWidth = api.textWidth;
export const charWidth = api.charWidth;
export default api;
