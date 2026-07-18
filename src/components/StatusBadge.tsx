const STYLES: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "Draft — upload documents", cls: "bg-slate-100 text-slate-600" },
  DOCUMENTS_UPLOADED: { label: "Documents uploaded", cls: "bg-blue-100 text-blue-700" },
  ANALYZING: { label: "AI reviewing information", cls: "bg-amber-100 text-amber-700" },
  NEEDS_REVIEW: { label: "User verification required", cls: "bg-orange-100 text-orange-700" },
  COMPLETED: { label: "Analysis completed", cls: "bg-green-100 text-green-700" },
  FAILED: { label: "Analysis failed", cls: "bg-red-100 text-red-700" },
};

export default function StatusBadge({ status }: { status: string }) {
  const s = STYLES[status] ?? { label: status, cls: "bg-slate-100 text-slate-600" };
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>
      {s.label}
    </span>
  );
}
