/** Sale units for bakery items. */
export const ITEM_UNITS = ['piece', 'bag', 'pack', 'dozen', 'tray', 'box', 'kg'] as const;
export type ItemUnit = (typeof ITEM_UNITS)[number];

export const ITEM_UNIT_LABELS_AR: Record<ItemUnit, string> = {
  piece: 'حبة',
  bag: 'كيس',
  pack: 'ربطة',
  dozen: 'دزينة',
  tray: 'صدر',
  box: 'كرتونة',
  kg: 'كيلو',
};
