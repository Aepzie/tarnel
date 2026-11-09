import type { LucideIcon } from 'lucide-react';
import {
  File,
  FileArchive,
  FileBraces,
  FileCode,
  FileHeadphone,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType,
  FileVideoCamera,
  Package,
} from 'lucide-react';

const GROUPS: [LucideIcon, string[]][] = [
  [FileArchive, ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'iso']],
  [FileImage, ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'bmp', 'ico', 'heic', 'tiff', 'psd']],
  [FileVideoCamera, ['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v', 'wmv', 'flv']],
  [FileHeadphone, ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus', 'wma']],
  [FileSpreadsheet, ['xls', 'xlsx', 'csv', 'tsv', 'ods', 'numbers']],
  [FileText, ['pdf', 'doc', 'docx', 'txt', 'md', 'rtf', 'odt', 'pages', 'epub']],
  [FileBraces, ['json', 'yaml', 'yml', 'toml', 'xml']],
  [FileCode, ['js', 'ts', 'tsx', 'jsx', 'py', 'rs', 'go', 'c', 'cpp', 'h', 'java', 'html', 'css', 'sh', 'ps1']],
  [FileType, ['ttf', 'otf', 'woff', 'woff2']],
  [Package, ['exe', 'msi', 'msix', 'appx', 'dmg', 'pkg', 'deb', 'rpm', 'appimage', 'apk']],
];

const BY_EXTENSION = new Map<string, LucideIcon>(GROUPS.flatMap(([icon, exts]) => exts.map((ext) => [ext, icon] as const)));

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

export function fileIconFor(filename: string): LucideIcon {
  return BY_EXTENSION.get(extensionOf(filename)) ?? File;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
