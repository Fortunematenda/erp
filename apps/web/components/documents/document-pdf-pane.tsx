'use client';
import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Skeleton } from 'antd';
import { useAuth } from '@/lib/auth-store';
import { fetchDocumentPdf } from '@/lib/document-pdf';

/**
 * Renders the real server PDF (A4) so Preview matches Print / Download.
 */
export function DocumentPdfPane({
  type,
  id,
  className,
}: {
  type: string;
  id: string;
  number?: string;
  showActions?: boolean;
  autoPrint?: boolean;
  autoDownload?: boolean;
  className?: string;
}) {
  const token = useAuth((s) => s.token);

  const q = useQuery({
    queryKey: ['/documents', type, id, 'pdf'],
    queryFn: () => fetchDocumentPdf(type, id, token),
    enabled: !!type && !!id,
    staleTime: 0,
  });

  const url = useMemo(() => {
    if (!q.data) return null;
    return URL.createObjectURL(q.data);
  }, [q.data]);

  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  if (q.isLoading) return <Skeleton active paragraph={{ rows: 12 }} className={className} />;
  if (q.isError) return <Alert type="error" message={(q.error as Error)?.message || 'Could not load document PDF'} className={className} />;

  return (
    <div className={className}>
      {url && (
        <iframe
          title={`${type} document`}
          src={url}
          className="w-full rounded-md border border-[#e6e9f2] bg-white shadow-sm"
          style={{ height: 'calc(100vh - 120px)', minHeight: 920 }}
        />
      )}
    </div>
  );
}
