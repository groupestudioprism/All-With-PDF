import type { Tool } from '../core/types';
import { extractPages, merge, organize, removePages, split } from './organize';
import { compress, ocr, repair } from './optimize';
import { imageToPdf, pdfToImage, pdfToMarkdown, pdfToText, scanToPdf } from './convert';
import { crop, editor, flatten, metadata, nUp, pageNumbers, rotate, watermark } from './edit';
import { compare, redact } from './security';
import { booklet, clean, fillForm, grayscale, headerFooter, info, pageOrder, pdfToCsv, pdfToPptx, pdfToWord, protect, resize, search, splitBySize, textToPdf_, unlock, wordToPdf } from './more';

export const TOOLS: Tool[] = [
  merge, split, splitBySize, removePages, extractPages, organize, pageOrder, nUp, booklet, scanToPdf,
  compress, grayscale, repair, ocr,
  imageToPdf, wordToPdf, textToPdf_,
  pdfToImage, pdfToText, pdfToWord, pdfToPptx, pdfToCsv,
  editor, fillForm, rotate, pageNumbers, headerFooter, watermark, crop, resize, flatten,
  protect, unlock, redact, clean, metadata,
  pdfToMarkdown, compare, search, info,
];

export const toolById = (id: string) => TOOLS.find((t) => t.id === id);
