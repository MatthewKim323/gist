// assetUrl (source `ft`, theme.js 4787-4789). Cache-buster dropped; assets live in public/theme/.
import { store } from "./store";

export function assetUrl(path: string): string {
  return `${store.assetsUrl}${path}`;
}

export default assetUrl;
