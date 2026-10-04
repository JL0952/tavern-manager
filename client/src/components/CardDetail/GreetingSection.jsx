import CollapsibleSection from "./CollapsibleSection.jsx";
import GreetingCarousel from "./GreetingCarousel.jsx";

function GreetingSection({
  firstMes,
  alternateGreetings,
  groupOnlyGreetings,
  editing,
  onFirstMesChange,
  onAlternateGreetingsChange,
  onGroupOnlyGreetingsChange,
}) {
  const totalCount =
    (firstMes ? 1 : 0) + alternateGreetings.length + groupOnlyGreetings.length;

  function updateItem(items, index, value, onChange) {
    const nextItems = [...items];
    nextItems[index] = value;
    onChange(nextItems);
  }

  function deleteItem(items, index, onChange) {
    onChange(items.filter((_item, itemIndex) => itemIndex !== index));
  }

  return (
    <CollapsibleSection title="Greetings" summary={`${totalCount} total`}>
      <div className="space-y-4">
        <section className="rounded-2xl border border-tavern-200 bg-white p-4">
          <h3 className="text-sm font-bold text-tavern-900">Main Greeting</h3>
          {editing ? (
            <textarea
              className="mt-3 min-h-36 w-full rounded-2xl border border-tavern-200 px-4 py-3 text-sm leading-6 text-slate-700 outline-none focus:border-tavern-700 focus:ring-2 focus:ring-tavern-200"
              aria-label="Main Greeting"
              value={firstMes}
              onChange={(event) => onFirstMesChange(event.target.value)}
            />
          ) : (
            <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700">
              {firstMes || "No main greeting."}
            </p>
          )}
        </section>

        <GreetingCarousel
          title="Alternate Greetings"
          items={alternateGreetings}
          emptyMessage="No alternate greetings."
          editing={editing}
          addLabel="Add alternate greeting"
          deleteLabel="Delete current alternate greeting"
          onChange={(index, value) =>
            updateItem(alternateGreetings, index, value, onAlternateGreetingsChange)
          }
          onAdd={() => onAlternateGreetingsChange([...alternateGreetings, ""])}
          onDelete={(index) =>
            deleteItem(alternateGreetings, index, onAlternateGreetingsChange)
          }
        />

        <GreetingCarousel
          title="Group Only Greetings"
          items={groupOnlyGreetings}
          emptyMessage="No group-only greetings."
          editing={editing}
          addLabel="Add group-only greeting"
          deleteLabel="Delete current group-only greeting"
          onChange={(index, value) =>
            updateItem(groupOnlyGreetings, index, value, onGroupOnlyGreetingsChange)
          }
          onAdd={() => onGroupOnlyGreetingsChange([...groupOnlyGreetings, ""])}
          onDelete={(index) =>
            deleteItem(groupOnlyGreetings, index, onGroupOnlyGreetingsChange)
          }
        />
      </div>
    </CollapsibleSection>
  );
}

export default GreetingSection;
