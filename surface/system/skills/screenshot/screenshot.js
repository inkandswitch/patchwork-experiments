import { domToPng } from 'https://esm.sh/modern-screenshot';

export async function screenshot(element) {
  return domToPng(element);
}
