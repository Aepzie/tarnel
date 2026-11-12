import { brandIconDataUrl } from '@shared/brand-mark';

/** Gives an internal tarnel:// page the app icon as its tab favicon (a data: URL, which main accepts). */
export function setBrandFavicon(): void {
  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/svg+xml';
  link.href = brandIconDataUrl();
  document.head.append(link);
}
