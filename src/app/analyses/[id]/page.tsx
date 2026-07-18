import AnalysisDetail from "@/components/AnalysisDetail";

export default async function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AnalysisDetail id={id} />;
}
