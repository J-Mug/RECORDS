/** Notes are always rendered as text so user HTML/JS cannot execute. */
export function WalkieNoteText({ note }: { note: string }) {
  return <p className="walkie-note-text">{note}</p>;
}
