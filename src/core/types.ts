export type CategoryId = 'organize' | 'optimize' | 'to-pdf' | 'from-pdf' | 'edit' | 'security' | 'intelligence';

export const CATEGORIES: { id: CategoryId; label: string; color: string }[] = [
  { id: 'organize', label: 'Organiser', color: '#f97316' },
  { id: 'optimize', label: 'Optimiser', color: '#22c55e' },
  { id: 'to-pdf', label: 'Convertir en PDF', color: '#eab308' },
  { id: 'from-pdf', label: 'Convertir depuis PDF', color: '#3b82f6' },
  { id: 'edit', label: 'Modifier', color: '#a855f7' },
  { id: 'security', label: 'Sécurité', color: '#ef4444' },
  { id: 'intelligence', label: 'Analyse', color: '#14b8a6' },
];

export type OptionDef = { key: string; label: string; help?: string } & (
  | { type: 'text'; default: string; placeholder?: string }
  | { type: 'number'; default: number; min?: number; max?: number; step?: number }
  | { type: 'select'; default: string; choices: { value: string; label: string }[] }
  | { type: 'checkbox'; default: boolean }
  | { type: 'color'; default: string }
  | { type: 'password'; default: string; placeholder?: string }
);

export interface ToolOutput {
  name: string;
  data: Uint8Array | Blob;
  mime: string;
  /** Message d'information affiché avec le résultat */
  note?: string;
}

export type Progress = (ratio: number, message?: string) => void;
export type Options = Record<string, any>;

export interface Tool {
  id: string;
  name: string;
  icon: string;
  category: CategoryId;
  description: string;
  /** Type de fichiers acceptés */
  accept: 'pdf' | 'image' | 'text' | 'word';
  /** Plusieurs fichiers en entrée traités ensemble (fusion…) ; sinon chaque fichier est traité séparément */
  multiple: boolean;
  /** Nombre exact de fichiers (comparaison) */
  exactFiles?: number;
  options: OptionDef[];
  /** Sortie = PDF(s), peut être chaîné dans un workflow */
  outputsPdf: boolean;
  /** Interface dédiée au lieu du formulaire générique */
  custom?: 'organize' | 'editor' | 'forms';
  /** Nécessite le navigateur (canvas / pdf.js) */
  needsBrowser?: boolean;
  run: (files: File[], opts: Options, progress: Progress) => Promise<ToolOutput[]>;
}

export const PDF_MIME = 'application/pdf';
