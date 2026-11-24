# All With PDF

Tous les outils d'iLovePDF, **sans limites** : taille et nombre de fichiers illimités, sans compte, sans publicité, et **100 % dans le navigateur** — vos fichiers ne sont jamais envoyés à un serveur.

React + TypeScript + Vite · [pdf-lib](https://pdf-lib.js.org/) · [pdf.js](https://mozilla.github.io/pdf.js/) · [tesseract.js](https://tesseract.projectnaptha.com/) · JSZip

## Outils disponibles (40 + workflows)

| Catégorie | Outils |
|---|---|
| Organiser | Fusionner, Diviser (plages, tous les N, par page, **par taille**), Supprimer / Extraire des pages, **Organiser** par vignettes (multi-PDF), **Réordonner en lot** (inverser, paires/impaires, répéter, pages vierges), Pages par feuille, **Brochure** (imposition recto verso), Scanner vers PDF |
| Optimiser | Compresser (images JPEG recompressées en gardant le texte, ou rasterisation), **Noir et blanc**, Réparer (fichiers tronqués), OCR multilingue |
| Vers PDF | Image vers PDF, **Word vers PDF**, **Texte / Markdown vers PDF** |
| Depuis PDF | PDF vers image (jusqu'à 600 dpi), PDF vers texte, **PDF vers Word (.docx)**, **PDF vers PowerPoint (.pptx)**, **PDF vers Excel (.xlsx : détection des tableaux, nombres et dates typés, tableaux continués sur plusieurs pages fusionnés, CSV en option)** |
| Modifier | **Éditeur visuel** (texte, formes, surlignage, dessin, images, **signature**, blanc de correction, caviardage définitif), **Remplir un formulaire**, Pivoter, Numéroter, **En-tête et pied de page**, Filigrane, Rogner (manuel ou auto), **Changer le format**, Aplatir les formulaires |
| Sécurité | **Protéger par mot de passe (AES 256)**, **Déverrouiller**, **Caviarder** par recherche (mots, regex, e-mails, téléphones, IBAN, cartes), **Nettoyer** (annotations, JavaScript, pièces jointes), Métadonnées |
| Analyse | PDF vers Markdown, **Comparer** deux PDF, **Rechercher dans le PDF**, **Informations du PDF** |
| Workflows | Chaînez n'importe quels outils, modèles fournis, enregistrement local, rejouable sur des lots |

Affichage clair ou sombre, outils récemment utilisés, raccourci `/` pour la recherche.

## Limites connues

- PDF vers Word et PDF vers PowerPoint : le texte et les titres sont repris, pas la mise en page exacte (PowerPoint : diapositives en images, texte dans les notes). Word vers PDF : mise en forme simplifiée, sans images.
- Excel / PowerPoint / HTML vers PDF : nécessitent un moteur de rendu complet (LibreOffice en WASM ou serveur), non inclus.
- Traduction et résumé IA : non inclus.
- L'OCR télécharge les données de langue (CDN) à la première utilisation.

## Développement

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # tests des opérations PDF (Node)
npm run build    # sortie statique dans dist/
```

Ajouter un outil = créer un objet `Tool` dans `src/tools/` et l'ajouter à `src/tools/index.ts` : la page, le formulaire d'options, le traitement par lots, le téléchargement et les workflows sont générés automatiquement.

## Déploiement

Le workflow `.github/workflows/deploy.yml` publie sur GitHub Pages à chaque push sur `main` (Réglages → Pages → Source : *GitHub Actions*).

## Publication

Le site compilé est dans `docs/` et GitHub Pages le publie en mode « Deploy from a branch » (branche `main`, dossier `/` ou `/docs`, les deux fonctionnent). Après toute modification : `npm run build`, puis committer `docs/`.
