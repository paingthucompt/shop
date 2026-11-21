import { useEffect, useMemo, useRef, useState } from "react";
import { PHOTO_TYPES, pickPhotos, useFileDrop } from "./useFileDrop.js";

export const MAX_PHOTOS = 4;

/**
 * Photo picker that ADDS to the selection (picking again does not replace earlier photos),
 * with previews and a remove button. Photos can also be dragged in or pasted (⌘V).
 * `files` is controlled by the parent.
 */
export default function PhotoPicker({ files, onChange, max = MAX_PHOTOS }) {
  const input = useRef(null);
  const [notice, setNotice] = useState("");
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  function addFiles(list, opts) {
    const { photos, notice: n } = pickPhotos(list, max - files.length, opts);
    setNotice(n);
    if (photos.length) onChange([...files, ...photos]);
  }
  const { dragging, dropProps } = useFileDrop(addFiles);

  return (
    <div className={`photo-drop${dragging ? " dragging" : ""}`} {...dropProps}>
      <div className="photo-picker">
        {files.map((f, i) => (
          <div key={`${f.name}-${i}`} className="photo">
            <img src={previews[i]} alt="" />
            <button type="button" className="remove" title="Remove" onClick={() => { setNotice(""); onChange(files.filter((_, j) => j !== i)); }}>✕</button>
          </div>
        ))}
        {files.length < max && (
          <button type="button" className="photo add" onClick={() => input.current?.click()}>
            <span>＋</span>
            <small>Add photo ({files.length}/{max})</small>
          </button>
        )}
      </div>
      <p className="drop-hint">{dragging ? "Drop the photos here" : "or drag & drop photos here · paste a copied image with ⌘V / Ctrl+V"}</p>
      {notice && <p className="error small-text">{notice}</p>}
      <input
        ref={input} type="file" accept={PHOTO_TYPES.join(",")} multiple hidden
        onChange={(e) => { addFiles([...e.target.files]); e.target.value = ""; /* allow picking the same file again */ }}
      />
    </div>
  );
}
