/**
 * Scan photos — the image behind every logged result, kept so the farmer can
 * check (and delete) false positives.
 *
 * Photos are downscaled to 512 px wide JPEGs (~40–80 KB) in
 * <documents>/scans/. Only the newest MAX_PHOTOS user photos are kept; older
 * scans keep their result but lose the image. Demo history uses a bundled
 * placeholder (DEMO_PHOTO).
 */

import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { clearIssuePhoto, getUserPhotoUris } from './db';

export const MAX_PHOTOS = 300;
/** Marker stored in photo_uri for seeded demo scans; rendered from a bundled image. */
export const DEMO_PHOTO = 'demo:leaf';

const scansDir = () => new Directory(Paths.document, 'scans');

/** Downscales and stores a camera frame. Falls back to a plain copy, then to the original URI. */
export async function persistScanPhoto(uri: string): Promise<string> {
  const dir = scansDir();
  try {
    if (!dir.exists) dir.create({ intermediates: true });
  } catch {}
  const dest = new File(dir, `scan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`);
  try {
    const image = await ImageManipulator.manipulate(uri).resize({ width: 512 }).renderAsync();
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.6 });
    await new File(saved.uri).move(dest); // move, not copy: no temp file left behind
    return dest.uri;
  } catch {
    try {
      await new File(uri).copy(dest);
      return dest.uri;
    } catch {
      return uri;
    }
  }
}

export function deletePhotoFile(uri: string | null | undefined): void {
  if (!uri || uri === DEMO_PHOTO) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {}
}

/** Keeps storage bounded: drops the image (not the scan) beyond MAX_PHOTOS. */
export async function prunePhotos(): Promise<void> {
  try {
    const photos = await getUserPhotoUris();
    const excess = photos.length - MAX_PHOTOS;
    for (let i = 0; i < excess; i++) {
      deletePhotoFile(photos[i].photoUri);
      await clearIssuePhoto(photos[i].id);
    }
  } catch {}
}
