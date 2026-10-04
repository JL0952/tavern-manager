function ImportSummary({ summary }) {
  if (!summary) {
    return null;
  }

  return (
    <section className="mb-6 rounded-2xl border border-tavern-200 bg-white px-4 py-3 text-sm text-slate-700">
      <h2 className="font-bold text-tavern-900">Batch import complete</h2>
      <p className="mt-2">
        Imported: {summary.imported} | Replaced: {summary.replaced} | Skipped:{" "}
        {summary.skipped} | Failed: {summary.failed} | Conflicts resolved:{" "}
        {summary.conflictsResolved}
      </p>
      {summary.failures.length > 0 && (
        <div className="mt-3">
          <p className="font-semibold text-red-700">Failures</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {summary.failures.map((failure) => (
              <li key={`${failure.fileName}-${failure.message}`}>
                {failure.fileName}: {failure.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default ImportSummary;
