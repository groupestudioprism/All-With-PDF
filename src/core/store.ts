/** Fichiers transmis d'un outil à un autre (« Continuer avec… »). */
let handoff: File[] | null = null;
export const setHandoff = (f: File[] | null) => { handoff = f; };
export const takeHandoff = () => { const f = handoff; handoff = null; return f; };
