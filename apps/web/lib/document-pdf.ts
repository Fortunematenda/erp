const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

function sanitize(name: string) {
  return String(name || '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'document';
}

export async function fetchDocumentPdf(type: string, id: string, token: string | null | undefined): Promise<Blob> {
  const res = await fetch(`${BASE}/documents/${type}/${id}/pdf`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) throw new Error('PDF could not be generated.');
  return res.blob();
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function documentPdfFilename(type: string, numberOrId: string) {
  const isQuote = type === 'quotation' || type === 'quote';
  return `${isQuote ? 'Quote' : 'Invoice'}_${sanitize(numberOrId)}.pdf`;
}

/** Print via hidden iframe — avoids pop-up blockers (Xero/QB style). */
export async function printDocumentPdf(type: string, id: string, token: string | null | undefined) {
  const blob = await fetchDocumentPdf(type, id, token);
  const url = URL.createObjectURL(blob);

  const iframe = document.createElement('iframe');
  iframe.setAttribute('title', 'Print document');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none';
  document.body.appendChild(iframe);

  const cleanup = () => {
    try { iframe.remove(); } catch { /* ignore */ }
    URL.revokeObjectURL(url);
  };

  return new Promise<void>((resolve, reject) => {
    iframe.onload = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        setTimeout(cleanup, 1500);
        resolve();
      } catch (e: any) {
        cleanup();
        reject(new Error(e?.message || 'Could not open the print dialog.'));
      }
    };
    iframe.onerror = () => {
      cleanup();
      reject(new Error('Could not load PDF for printing.'));
    };
    iframe.src = url;
  });
}
