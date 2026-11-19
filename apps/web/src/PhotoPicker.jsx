import { useEffect, useMemo, useRef } from "react";

export const MAX_PHOTOS = 4;
const ACCEPT = "image/jpeg,image/png,image/webp";

/**
 * Photo picker that ADDS to the selection (picking again does not replace earlier photos),
 * with previews and a remove button. `files` is controlled by the parent.
 */
export default function PhotoPicker({ files, onChange, max = MAX_PHOTOS }) {
  const input = useRef(null);
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  function add(e) {
    const picked = [...e.target.files].filter((f) => ACCEPT.includes(f.type));
    onChange([...files, ...picked].slice(0, max));
    e.target.value = ""; // allow picking the same file again later
  }

  return (
    <div className="photo-picker">
      {files.map((f, i) => (
        <div key={`${f.name}-${i}`} className="photo">
          <img src={previews[i]} alt="" />
          <button type="button" className="remove" title="Remove" onClick={() => onChange(files.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      {files.length < max && (
        <button type="button" className="photo add" onClick={() => input.current?.click()}>
          <span>＋</span>
          <small>Add photo ({files.length}/{max})</small>
        </button>
      )}
      <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={add} />
    </div>
  );
}
