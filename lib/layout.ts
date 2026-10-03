/** Shared geometry for floating chrome (tab bar, accessories, top controls). */

import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const SIDE = 20;
export const TAB_BAR_HEIGHT = 62;
export const MINI_SIZE = 58;
export const ACCESSORY_HEIGHT = 58;
export const ACCESSORY_GAP = 8;

export function useChromeInsets() {
  const insets = useSafeAreaInsets();
  /** Tab bar's distance from the bottom edge (20 on a notched iPhone, as designed). */
  const tabBottom = Math.max(insets.bottom - 14, 16);
  return {
    top: insets.top + 8,
    tabBottom,
    /** Bottom of an accessory sitting above the full tab bar. */
    accessoryBottom: tabBottom + TAB_BAR_HEIGHT + ACCESSORY_GAP,
    /** Bottom of the inline accessory beside the minimized tab bar. */
    miniBottom: tabBottom + 4,
    /** Space scrolling content should leave for the tab bar. */
    tabClearance: tabBottom + TAB_BAR_HEIGHT + 24,
  };
}
