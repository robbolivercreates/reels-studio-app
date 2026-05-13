/**
 * Hook wrapping reference-video library listing. Used by the wizard's source
 * 'video' tab "Saved" sub-tab to show previously downloaded/uploaded videos.
 */

import { useCallback, useEffect, useState } from 'react';
import { listReferences, referencesDir, type ReferenceMeta } from '../referenceVideoStore';

export const useReferenceLibrary = () => {
  const [refs, setRefs] = useState<ReferenceMeta[]>([]);
  const [folder, setFolder] = useState<string>('');

  const refresh = useCallback(async () => {
    try {
      const rows = await listReferences();
      setRefs(rows);
    } catch (e) {
      console.warn('[useReferenceLibrary] list failed', e);
    }
  }, []);

  useEffect(() => {
    void referencesDir().then(setFolder).catch(() => setFolder(''));
    void refresh();
  }, [refresh]);

  return { refs, folder, refresh };
};
