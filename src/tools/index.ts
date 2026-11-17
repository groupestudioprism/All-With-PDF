import type { Tool } from '../core/types';
import { extractPages, merge, organize, removePages, split } from './organize';
import { compress, ocr, repair } from './optimize';
import { imageToPdf, pdfToImage, pdfToMarkdown, pdfToText, scanToPdf } from './convert';
import { crop, editor, flatten, metadata, nUp, pageNumbers, rotate, watermark } from './edit';
import { compare, redact } from './security';

export const TOOLS: Tool[] = [
  merge, split, removePages, extractPages, organize, scanToPdf, nUp,
  compress, repair, ocr,
  imageToPdf,
  pdfToImage, pdfToText,
  editor, rotate, pageNumbers, watermark, crop, flatten,
  redact, metadata,
  pdfToMarkdown, compare,
];

export const toolById = (id: string) => TOOLS.find((t) => t.id === id);
