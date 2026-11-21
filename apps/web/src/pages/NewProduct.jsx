import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, LANGS, LANG_FLAG } from "../api.js";
import PhotoPicker from "../PhotoPicker.jsx";
import { ANGLE_KEYS, STYLE_KEYS, angleName, angleDesc, styleName, styleDesc } from "../options.js";
import { t } from "../i18n.js";

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

// the server's import notes are English: show the matching interface-language text when there is one
const NOTE_KEYS = [["Shopee protects", "new.noteShopee"], ["no product details", "new.noteTiktok"], ["Unknown link", "new.noteUnknown"], ["Only the main photo", "new.noteOnePhoto"]];
const localNote = (n) => { const hit = NOTE_KEYS.find(([s]) => n.includes(s)); return hit ? t(hit[1]) : n; };

const EMPTY = { title: "", description: "", price: "", currency: "THB", product_url: "", affiliate_url: "", source: "" };

export default function NewProduct() {
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState(EMPTY);
  const set = (k) => (e) => setFields((f) => ({ ...f, [k]: e.target.value }));
  const [link, setLink] = useState("");
  const [importing, setImporting] = useState(false);
  const [importNotes, setImportNotes] = useState([]);
  const [imported, setImported] = useState(0);
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
    setImporting(true); setError(""); setImportNotes([]); setImported(0);
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
      setImported(r.images.length + (r.title ? 1 : 0));
      setImportNotes(r.notes.map(localNote));
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
    if (!photos.length) return setError(t("new.needPhoto"));
    const chosen = Object.keys(langs).filter((l) => langs[l]);
    if (!chosen.length) return setError(t("new.needLang"));
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
    <div className="narrow">
      <Link to="/" className="back">← {t("nav.products")}</Link>
      <div className="page-head"><div><h1>{t("new.title")}</h1><p className="muted">{t("new.subtitle")}</p></div></div>

      <section className="card import">
        <h2 className="card-title"><span className="num">⚡</span>{t("new.importTitle")}</h2>
        <p className="muted small">{t("new.importText")}</p>
        <div className="input-row">
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://www.tiktok.com/view/product/…  ·  https://shopee.co.th/…"
            onKeyDown={(e) => { if (e.key === "Enter" && link.trim()) { e.preventDefault(); importLink({ url: link.trim() }); } }} />
          <button type="button" className="btn primary" disabled={importing || !link.trim()} onClick={() => importLink({ url: link.trim() })}>{importing ? t("new.importing") : t("new.import")}</button>
        </div>
        {imported > 0 && <p className="alert ok">✓ {t("new.imported")}</p>}
        {importNotes.map((n) => <p key={n} className="alert info">{n}</p>)}
        <details className="more">
          <summary>{t("new.bookmarkTitle")}</summary>
          <ol className="small">
            <li>{t("new.bookmark1")} <a ref={bookmark} className="bookmarklet" onClick={(e) => e.preventDefault()}>📦 {t("new.bookmarkName")}</a></li>
            <li>{t("new.bookmark2")}</li>
            <li>{t("new.bookmark3")}</li>
          </ol>
        </details>
      </section>

      <form onSubmit={submit} className="card form">
        <h2 className="card-title"><span className="num">✎</span>{t("new.detailsTitle")}</h2>
        <input type="hidden" name="source" value={fields.source} />
        <label><span>{t("new.name")} <span className="req">*</span></span><input name="title" required maxLength={200} value={fields.title} onChange={set("title")} placeholder={t("new.namePh")} /></label>
        <label>{t("new.details")}<textarea name="description" rows={4} value={fields.description} onChange={set("description")} placeholder={t("new.detailsPh")} />
          <span className="hint">{t("new.detailsHint")}</span></label>
        <div className="cols">
          <label>{t("new.price")}<input name="price" type="number" step="0.01" min="0" inputMode="decimal" value={fields.price} onChange={set("price")} /></label>
          <label className="narrow-field">{t("new.currency")}<select name="currency" value={fields.currency} onChange={set("currency")}><option>THB</option><option>MMK</option><option>USD</option></select></label>
        </div>

        <div className="field">
          <span className="label">{t("new.photos")} <span className="req">*</span></span>
          <span className="hint">{t("new.photosHint")}</span>
          <PhotoPicker files={photos} onChange={setPhotos} />
          {spare.length > 0 && (
            <div className="spare">
              <span className="hint">{t("new.spare")}{photos.length >= 4 ? ` ${t("new.spareFull")}` : ""}</span>
              <div className="row">
                {spare.map((f, i) => (
                  <SpareThumb key={`${f.name}-${i}`} file={f} disabled={photos.length >= 4}
                    onPick={() => { setPhotos((cur) => [...cur, f]); setSpare((cur) => cur.filter((_, j) => j !== i)); }} />
                ))}
              </div>
            </div>
          )}
        </div>

        <h2 className="card-title"><span className="num">🎬</span>{t("new.videoTitle")}</h2>
        <div className="field">
          <span className="label">{t("new.langs")}</span>
          <div className="chips">
            {Object.entries(LANGS).map(([k, label]) => (
              <label key={k} className={`chip${langs[k] ? " on" : ""}`}><input type="checkbox" checked={langs[k]} onChange={(e) => setLangs({ ...langs, [k]: e.target.checked })} />{LANG_FLAG[k]} {label}</label>
            ))}
          </div>
          <span className="hint">{t("new.langsHint")}</span>
        </div>
        <div className="cols">
          <label>{t("step1.angle")}
            <select value={angle} onChange={(e) => setAngle(e.target.value)}>{ANGLE_KEYS.map((k) => <option key={k} value={k}>{angleName(k)}</option>)}</select>
            <span className="hint">{angleDesc(angle)}</span>
          </label>
          <label>{t("step1.style")}
            <select value={style} onChange={(e) => setStyle(e.target.value)}>{STYLE_KEYS.map((k) => <option key={k} value={k}>{styleName(k)}</option>)}</select>
            <span className="hint">{styleDesc(style)}</span>
          </label>
        </div>

        <details className="more">
          <summary>{t("new.links")}</summary>
          <label>{t("new.productUrl")}<input name="product_url" type="url" placeholder="https://shopee.co.th/…" value={fields.product_url} onChange={set("product_url")} /></label>
          <label>{t("new.affiliateUrl")}<input name="affiliate_url" type="url" value={fields.affiliate_url} onChange={set("affiliate_url")} />
            <span className="hint">{t("new.affiliateHint")}</span></label>
        </details>

        {error && <p className="alert bad">{error}</p>}
        <div className="actions">
          <button className="btn primary lg" disabled={busy}>{busy ? t("new.saving") : `${t("new.save")} →`}</button>
          <span className="hint">{t("new.saveHint")}</span>
        </div>
      </form>
    </div>
  );
}

function SpareThumb({ file, disabled, onPick }) {
  const [src, setSrc] = useState("");
  useEffect(() => { const u = URL.createObjectURL(file); setSrc(u); return () => URL.revokeObjectURL(u); }, [file]);
  return <button type="button" className="spare-photo" disabled={disabled} onClick={onPick} title={t("new.usePhoto")}><img src={src} alt="" /></button>;
}
