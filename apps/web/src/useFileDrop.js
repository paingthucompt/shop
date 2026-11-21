import { useEffect, useRef, useState } from "react";

export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * Drag & drop + paste (⌘V / Ctrl+V) for image files.
 *   const { dragging, dropProps } = useFileDrop(onFiles, { enabled })
 * Spread dropProps on the drop zone. While enabled, pasting anywhere on the page adds copied images
 * (e.g. right-click → "Copy image" on a Shopee page), and a file dropped outside the zone is ignored
 * instead of making the browser navigate away to it.
 */
export function useFileDrop(onFiles, { enabled = true, paste = true } = {}) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0); // dragenter/dragleave fire for every child element
  const latest = useRef(onFiles);
  latest.current = onFiles;

  useEffect(() => {
    if (!enabled) return undefined;
    const onPaste = (e) => {
      const files = [...(e.clipboardData?.files || [])];
      if (!files.length) return; // plain text paste into an input stays untouched
      e.preventDefault();
      latest.current(files);
    };
    const stray = (e) => { if (hasFiles(e)) e.preventDefault(); };
    if (paste) window.addEventListener("paste", onPaste);
    window.addEventListener("dragover", stray);
    window.addEventListener("drop", stray);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("dragover", stray);
      window.removeEventListener("drop", stray);
    };
  }, [enabled, paste]);

  const reset = () => { depth.current = 0; setDragging(false); };
  const dropProps = {
    onDragEnter: (e) => {
      if (!enabled || !hasFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      setDragging(true);
    },
    onDragOver: (e) => {
      if (!enabled || !hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: () => {
      depth.current -= 1;
      if (depth.current <= 0) reset();
    },
    onDrop: (e) => {
      if (!enabled) return;
      e.preventDefault();
      e.stopPropagation();
      reset();
      const files = [...(e.dataTransfer?.files || [])];
      // a picture dragged from another web page arrives as a link, not a file
      if (!files.length && e.dataTransfer?.types?.includes("text/uri-list")) latest.current([], { fromWeb: true });
      else latest.current(files);
    },
  };
  return { dragging, dropProps };
}

const hasFiles = (e) => [...(e.dataTransfer?.types || [])].some((t) => t === "Files" || t === "text/uri-list");

/** split dropped/pasted files into usable photos (up to `room`) and a short notice about the rest */
export function pickPhotos(files, room, { fromWeb = false } = {}) {
  if (fromWeb) return { photos: [], notice: "That picture is a web link — right-click it → “Copy image”, then press ⌘V / Ctrl+V here." };
  const ok = files.filter((f) => PHOTO_TYPES.includes(f.type));
  const photos = ok.slice(0, Math.max(0, room));
  const notes = [];
  if (ok.length < files.length) notes.push(`${files.length - ok.length} file(s) skipped — only JPG, PNG or WebP photos`);
  if (ok.length > photos.length) notes.push(room > 0 ? `only ${room} more photo(s) fit (max 4)` : "already 4 photos — remove one first");
  return { photos, notice: notes.join(" · ") };
}
