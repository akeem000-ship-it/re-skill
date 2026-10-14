// The addresses of bank $1D's character-data tables: the tilemap patch lists (ApplyTilemapPatchList: entries
// [offset into the screen map (big-endian), source offset, count], $FF), the tile plots, graphics and sprite
// templates. Names and addresses from the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm: src/engine/menus/char_data/confirm_1d.asm and page_patches_1d.asm); the data stays in
// the ROM. A module of its own so the bank's other modules can share it without an import cycle at load time.
export const PATCH = {
  DrillDisplayData_1d: 0x5C25, StatPageTilemapPatch0: 0x5C2E,
  CharDataSummaryPageTilemapPatch0: 0x5C33, CharDataSummaryPageTilemapPatch1: 0x5C68,
  CharDataSummaryPageTilemapPatch2: 0x5C9D,
  StatPageTilemapPatch1: 0x5CA6, StatPageTilemapPatch2: 0x5CD0, StatPageTilemapPatch3: 0x5D0A,
  StatPageTilemapPatch4: 0x5D34, StatPageTilemapPatch5: 0x5DE5, StatPageTilemapPatch6: 0x5DF2,
  StatPageTilemapPatch7: 0x5E13, StatPageTilemapPatch8: 0x5E34,
  CharDataConfirmScreenTilemapPatch0: 0x5CBB, CharDataConfirmScreenTilemapPatch1: 0x5CED,
  CharDataConfirmScreenTilemapPatch2: 0x5D1F, CharDataConfirmScreenTilemapPatch3: 0x5D59,
  CharDataConfirmScreenTilemapPatch4: 0x5DBE, CharDataConfirmScreenTilemapPatch5: 0x6303,
  CharDataConfirmPromptTilemapPatch: 0x6310,
  CharDataSummaryFieldsTilePlot0: 0x5D7E, CharDataSummaryFieldsTilePlot1: 0x5D91,
};
// MainCharStatPageTilemapPatch00-28 and PartnerStatPageTilemapPatch00-28, by number
export const MAIN = [
  0x5DA4, 0x5DCB, 0x5E3D, 0x5E52, 0x5E73, 0x5E7C, 0x5E91, 0x5EB2, 0x5EBB, 0x5ED0, 0x5EF1, 0x5EFA, 0x5F0F, 0x5F30,
  0x6035, 0x6056, 0x6077, 0x6080, 0x60A1, 0x60C2, 0x60CB, 0x60EC, 0x610D, 0x6116, 0x6137, 0x6158, 0x615D, 0x6172,
  0x6193,
];
export const PARTNER = [
  0x5DB1, 0x5DD8, 0x5F39, 0x5F4E, 0x5F6F, 0x5F78, 0x5F8D, 0x5FAE, 0x5FB7, 0x5FCC, 0x5FED, 0x5FF6, 0x600B, 0x602C,
  0x6198, 0x61B9, 0x61DA, 0x61E3, 0x6204, 0x6225, 0x622E, 0x624F, 0x6270, 0x6279, 0x629A, 0x62BB, 0x62C4, 0x62D9,
  0x62FA,
];
// the pages' graphics and map pieces (LoadCharDataScreenPageGraphics, ShowCharDataScreen)
export const GFX = {
  CharDataScreenPalettes: 0x6334, CharDataScreenGfx14: 0x633C,
  CharDataScreenPagePatch0Tilemap: 0x6321, CharDataScreenPagePatch0Attrmap: 0x632B,
  CharDataScreenPagePatch1Tilemap: 0x63F4, CharDataScreenPagePatch1Attrmap: 0x6449,
  CharDataScreenPagePatch2Tilemap: 0x645B, CharDataScreenPagePatch2Attrmap: 0x647E,
  CharDataScreenPagePatch3Tilemap: 0x6485, CharDataScreenPagePatch3Attrmap: 0x6493,
  CharDataScreenPagePatch4Tilemap: 0x649A, CharDataScreenPagePatch4Attrmap: 0x64B2,
  CharDataScreenPagePatch5Tilemap: 0x6550, CharDataScreenPagePatch5Attrmap: 0x6568,
  CharDataScreenPageGfx10: 0x64BB, CharDataScreenPageGfx13: 0x656F, CharDataScreenPageGfx14: 0x65E4,
  CharDataScreenPageGraphicsGfx0: 0x667F, CharDataScreenPageGraphicsGfx1: 0x6721, CharDataScreenPageGraphicsGfx2: 0x67AB,
};
export const TEMPLATE = {
  DrawCharDataPageArrowsTask_SpriteTemplate0: 0x666A, DrawCharDataPageArrowsTask_SpriteTemplate1: 0x670C,
  DrawCharDataPageArrowsTask_SpriteTemplate2: 0x679A, DrawCharDataPageArrowsTask_SpriteTemplate3: 0x681B,
};
