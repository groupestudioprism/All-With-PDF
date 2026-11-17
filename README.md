# All With PDF

Tous les outils d'iLovePDF, **sans limites** : taille et nombre de fichiers illimités, sans compte, sans publicité, et **100 % dans le navigateur** — vos fichiers ne sont jamais envoyés à un serveur.

React + TypeScript + Vite · [pdf-lib](https://pdf-lib.js.org/) · [pdf.js](https://mozilla.github.io/pdf.js/) · [tesseract.js](https://tesseract.projectnaptha.com/) · JSZip

## Outils disponibles (23 + workflows)

| Catégorie | Outils |
|---|---|
| Organiser | Fusionner, Diviser (plages / tous les N / par page), Supprimer des pages, Extraire des pages, **Organiser** (vignettes glisser-déposer, multi-PDF), Scanner → PDF, Pages par feuille |
| Optimiser | Compresser (recompression des images JPEG en conservant le texte, ou rasterisation), Réparer (fichiers tronqués), OCR (multilingue) |
| Vers PDF | Image → PDF (JPG, PNG, WebP, GIF, BMP…) |
| Depuis PDF | PDF → Image (JPG / PNG / WebP jusqu'à 600 dpi), PDF → Texte |
| Modifier | **Éditeur visuel** (texte, formes, surlignage, dessin, images, **signature manuscrite**, blanc de correction, **caviardage définitif**), Pivoter, Numéroter, Filigrane (centré ou mosaïque), Rogner (manuel ou auto), Aplatir les formulaires |
| Sécurité | **Caviarder** par recherche (mots, regex, e-mails, téléphones, IBAN, cartes) avec suppression réelle du texte, Métadonnées (anonymiser) |
| Analyse | PDF → Markdown structuré, **Comparer** deux PDF (rapport HTML) |
| ⛓️ **Workflows** | Chaînez n'importe quels outils (ex. fusionner → numéroter → compresser), modèles fournis, enregistrement local, rejouable sur des lots |

« Continuer avec un autre outil… » est proposé après chaque résultat PDF.

## Pas encore implémenté (prochaines étapes)

- Word / Excel / PowerPoint / HTML ↔ PDF (nécessite un moteur type LibreOffice en WASM ou un backend)
- Protéger / déverrouiller par mot de passe (chiffrement : qpdf en WASM)
- Remplissage visuel des formulaires AcroForm, PDF/A
- Traduction et résumé IA (modèles locaux WebGPU ou API au choix de l'utilisateur)
- L'OCR télécharge les données de langue (CDN) à la première utilisation

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
