/** QPDF (WASM) : chiffrement, déchiffrement. Un module neuf par appel (qpdf quitte à la fin de callMain). */
export async function runQpdf(args: string[], input: Uint8Array): Promise<{ data: Uint8Array | null; log: string; code: number }> {
  const createModule = (await import('@neslinesli93/qpdf-wasm')).default as any;
  let wasm: string;
  if (typeof window === 'undefined') {
    const { createRequire } = await import('node:module');
    wasm = createRequire(import.meta.url).resolve('@neslinesli93/qpdf-wasm/dist/qpdf.wasm');
  } else {
    wasm = (await import('@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url')).default;
  }
  const log: string[] = [];
  const mod = await createModule({
    locateFile: () => wasm,
    noInitialRun: true,
    print: (m: string) => log.push(m),
    printErr: (m: string) => log.push(m),
  });
  mod.FS.writeFile('/in.pdf', input);
  let code = 0;
  try {
    code = mod.callMain([...args, '/in.pdf', '/out.pdf']) ?? 0;
  } catch (e: any) {
    code = typeof e?.status === 'number' ? e.status : 2;
  }
  let data: Uint8Array | null = null;
  try { data = mod.FS.readFile('/out.pdf') as Uint8Array; } catch { /* pas de sortie */ }
  return { data, log: log.join('\n'), code };
}
