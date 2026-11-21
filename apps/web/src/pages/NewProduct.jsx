import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import PhotoPicker from "../PhotoPicker.jsx";
import { ANGLES, STYLES } from "../options.js";
import { LANGS } from "../api.js";

// Runs on the product page in the user's own browser (so the shop's bot protection is not an issue) and
// opens "Add product" with the name, details, price and photo links it finds. Kept short: it is a bookmark.
const BOOKMARKLET_BODY = `(()=>{const m=n=>document.querySelector('meta[property="'+n+'"],meta[name="'+n+'"]')?.content||'';let p={};for(const s of document.querySelectorAll('script[type="application/ld+json"]')){try{const j=JSON.parse(s.textContent);const a=[].concat(j['@graph']||j);const f=a.find(x=>String(x['@type']).includes('Product'));if(f){p=f;break}}catch(e){}}const o=[].concat(p.offers||[])[0]||{};const cdn=/ibyteimg|byteimg|tiktokcdn|susercontent|slatic|lazcdn/;const im=[].concat(p.image||[],m('og:image'),[...document.images].filter(i=>cdn.test(i.currentSrc||i.src)&&(i.naturalWidth>=80)).map(i=>i.currentSrc||i.src)).map(x=>typeof x=='string'?x:x&&x.url).filter(u=>u&&u.startsWith('https:'));const d={url:location.href.split('?')[0],title:p.name||m('og:title')||document.title,description:String(p.description||m('og:description')||m('description')).slice(0,2500),price:o.price||o.lowPrice||'',currency:o.priceCurrency||'',images:[...new Set(im)].slice(0,30)};window.open(APP+'/products/new#import='+encodeURIComponent(JSON.stringify(d)))})()`;

function dataUrlToFile(src, name) {
  const [head, b64] = src.split(",");
  const mime = head.match(/^data:([^;]+)/)?.[1] || "image/jpeg";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: mime });
}

const EMPTY = { title: "", description: "", price: "", currency: "THB", product_url: "", affiliate_url: "", source: "" };

export default function NewProduct() {
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState(EMPTY);
  const set = (k) => (e) => setFields((f) => ({ ...f, [k]: e.target.value }));
  const [link, setLink] = useState("");
  const [importing, setImporting] = useState(false);
  const [importNotes, setImportNotes] = useState([]);
  const [spare, setSpare] = useState([]); // imported photos that did not fit in the 4 slots
  const bookmark = useRef(null);
  // React blocks javascript: links in JSX, so the bookmark's href is set directly
  useEffect(() => { bookmark.current?.setAttribute("href", `javascript:${BOOKMARKLET_BODY.replace("APP+", `${JSON.stringify(location.origin)}+`)}`); }, []);
  const [error, setError] = useState("");
  const [photos, setPhotos] = useState([]);
  const [langs, setLangs] = useState({ th: true, my: true });
  const [angle, setAngle] = useState("auto");
  const [style, setStyle] = useState("product");
  const nav = useNavigate();

  async function importLink(body) {
    setImporting(true); setError(""); setImportNotes([]);
    try {
      const r = await api("/products/import", { method: "POST", body });
      setFields((f) => ({
        ...f,
        title: r.title || f.title,
        description: r.description || f.description,
        price: r.price ?? f.price,
        currency: r.currency || f.currency,
        product_url: r.product_url || f.product_url,
        affiliate_url: r.affiliate_url || f.affiliate_url,
        source: r.platform || f.source,
      }));
      const files = r.images.map((img, i) => dataUrlToFile(img.src, `${r.platform || "product"}-${i + 1}.${img.mime.split("/")[1]}`));
      const room = Math.max(0, 4 - photos.length);
      setPhotos((cur) => [...cur, ...files.slice(0, room)]);
      setSpare(files.slice(room));
      setImportNotes([...(r.images.length ? [`Imported ${r.images.length} photo(s)${r.title ? " and the product name" : ""} — check them before saving.`] : []), ...r.notes]);
    } catch (err) { setError(err.message); }
    setImporting(false);
  }

  // opened by the bookmark: #import={...page data...}
  useEffect(() => {
    if (!location.hash.startsWith("#import=")) return;
    let page = null;
    try { page = JSON.parse(decodeURIComponent(location.hash.slice(8))); } catch { /* broken link */ }
    history.replaceState(null, "", location.pathname);
    if (page) importLink({ page });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e) {
    e.preventDefault();
    if (!photos.length) return setError("Add at least one product photo");
    const chosen = Object.keys(langs).filter((l) => langs[l]);
    if (!chosen.length) return setError("Choose at least one language");
    setBusy(true);
    setError("");
    try {
      const form = new FormData(e.target); // only named fields; the language / angle / style / link controls are not sent
      for (const f of photos) form.append("images", f);
      const p = await api("/products", { method: "POST", form });
      nav(`/products/${p.id}`, { state: { autoGenerate: { langs: chosen, angle, style } } });
    } catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <>
      <h2>Add product</h2>
      <div className="card form import">
        <label>Paste a TikTok Shop / Shopee link — fills in the name and photos
          <div className="row">
            <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://www.tiktok.com/view/product/… or https://shopee.co.th/…" />
            <button type="button" disabled={importing || !link.trim()} onClick={() => importLink({ url: link.trim() })}>{importing ? "Importing…" : "Import"}</button>
          </div>
        </label>
        {importNotes.map((n) => <p key={n} className="muted small-text">{n}</p>)}
        <details>
          <summary className="small-text">More photos + details: the “Send to Affiliate Studio” bookmark</summary>
          <p className="small-text">Drag this button to your bookmarks bar: <a ref={bookmark} className="bookmarklet" onClick={(e) => e.preventDefault()}>📦 Send to Affiliate Studio</a></p>
          <p className="muted small-text">Then open any TikTok Shop / Shopee / Lazada product page in your browser and click the bookmark — this page opens with the name, details, price and photos filled in. It only reads the page you are looking at.</p>
        </details>
      </div>
      <form onSubmit={submit} className="card form">
        <input type="hidden" name="source" value={fields.source} />
        <label>Product name *<input name="title" required maxLength={200} value={fields.title} onChange={set("title")} /></label>
        <label>Key details (features, size, material…)<textarea name="description" rows={4} value={fields.description} onChange={set("description")} /></label>
        <div className="row">
          <label>Price<input name="price" type="number" step="0.01" min="0" value={fields.price} onChange={set("price")} /></label>
          <label>Currency<select name="currency" value={fields.currency} onChange={set("currency")}><option>THB</option><option>MMK</option><option>USD</option></select></label>
        </div>
        <label>Shopee / TikTok product link<input name="product_url" type="url" placeholder="https://shopee.co.th/..." value={fields.product_url} onChange={set("product_url")} /></label>
        <label>Affiliate link (optional — auto-created for Shopee when API is set up)<input name="affiliate_url" type="url" value={fields.affiliate_url} onChange={set("affiliate_url")} /></label>
        <div className="field">
          <span className="muted">Product photos * (1–4, clear shots from different angles — each becomes part of the video)</span>
          <PhotoPicker files={photos} onChange={setPhotos} />
          {spare.length > 0 && (
            <div className="spare">
              <span className="muted small-text">More photos from the link — click one to use it{photos.length >= 4 ? " (remove a photo above first)" : ""}:</span>
              <div className="row">
                {spare.map((f, i) => (
                  <SpareThumb key={`${f.name}-${i}`} file={f} disabled={photos.length >= 4}
                    onPick={() => { setPhotos((cur) => [...cur, f]); setSpare((cur) => cur.filter((_, j) => j !== i)); }} />
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="field">
          <span className="muted">Video to make (right after saving, AI writes the scripts + the Google Flow storyboard and video prompts)</span>
          <div className="row">
            {Object.entries(LANGS).map(([k, label]) => (
              <label key={k} className="check"><input type="checkbox" checked={langs[k]} onChange={(e) => setLangs({ ...langs, [k]: e.target.checked })} /> {label}</label>
            ))}
          </div>
          <div className="row">
            <label className="check">Script angle
              <select value={angle} onChange={(e) => setAngle(e.target.value)}>
                {Object.entries(ANGLES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </label>
            <label className="check">Video style
              <select value={style} onChange={(e) => setStyle(e.target.value)}>
                {Object.entries(STYLES).map(([k, label]) => <option key={k} value={k}>{label.split(" (")[0]}</option>)}
              </select>
            </label>
          </div>
        </div>
        {error && <p className="error">{error}</p>}
        <button disabled={busy}>{busy ? "Saving…" : "Save & write Flow prompts"}</button>
      </form>
    </>
  );
}

function SpareThumb({ file, disabled, onPick }) {
  const [src, setSrc] = useState("");
  useEffect(() => { const u = URL.createObjectURL(file); setSrc(u); return () => URL.revokeObjectURL(u); }, [file]);
  return <button type="button" className="spare-photo" disabled={disabled} onClick={onPick}><img src={src} alt="" /></button>;
}
