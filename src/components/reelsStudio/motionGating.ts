/**
 * Motion-generation gating rules.
 *
 * When the project's asset folder has files in it, Gemini gets confused if a
 * block has no specific asset attached — it picks one at random from the
 * universal list, references paths the runtime can't resolve, and the
 * HyperFrames render fails. The user's policy: if the folder has assets, the
 * user must explicitly attach one to each block before generation runs.
 *
 * If the folder is empty, motion generation falls through to text-only mode
 * (no asset list sent to Gemini) and this gate stays open.
 */
export const requiresAssetAttachment = (
  block: { attachedAssets?: unknown[] },
  projectAssetsCount: number,
): boolean =>
  projectAssetsCount > 0 && (block.attachedAssets?.length ?? 0) === 0;
