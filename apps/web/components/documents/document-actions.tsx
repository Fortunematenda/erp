'use client';
import { DocumentPdfPane } from './document-pdf-pane';

export function DocumentActions({ type, id }: { type: string; id: string; vm?: any }) {
  return <DocumentPdfPane type={type} id={id} />;
}
