// ─── AUDIO POST-PROCESSING SERVICE (stub) ────────────────────────────────────
// The original service used a Canva-internal fal staging endpoint.
// This stub preserves all exported types and APIs but passes audio through
// unchanged — room acoustics are disabled in this standalone build.
// ─────────────────────────────────────────────────────────────────────────────

export type EnvironmentProfile =
  | 'bedroom' | 'kitchen' | 'home_office' | 'bathroom'
  | 'garden' | 'living_room' | 'office' | 'gym'
  | 'studio' | 'car' | 'outdoors' | 'loft' | 'workshop';

export const ENVIRONMENT_PROFILES: { id: EnvironmentProfile; label: string }[] = [
  { id: 'bedroom',      label: 'Bedroom' },
  { id: 'living_room',  label: 'Living Room' },
  { id: 'kitchen',      label: 'Kitchen' },
  { id: 'home_office',  label: 'Home Office' },
  { id: 'office',       label: 'Office' },
  { id: 'bathroom',     label: 'Bathroom' },
  { id: 'garden',       label: 'Garden' },
  { id: 'gym',          label: 'Gym' },
  { id: 'studio',       label: 'Studio' },
  { id: 'car',          label: 'Car' },
  { id: 'outdoors',     label: 'Outdoors' },
  { id: 'loft',         label: 'Loft' },
  { id: 'workshop',     label: 'Workshop' },
];

/** Pass-through stub — returns audio unchanged (room acoustics disabled). */
export const cloudPostProcess = async (
  voiceBlob: Blob,
  _environmentProfile: EnvironmentProfile,
  _onStatus?: (s: string) => void,
): Promise<Blob> => {
  return voiceBlob;
};
