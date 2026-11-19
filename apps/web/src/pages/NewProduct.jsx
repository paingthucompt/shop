import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import PhotoPicker from "../PhotoPicker.jsx";

export default function NewProduct() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [photos, setPhotos] = useState([]);
  const nav = useNavigate();

  async function submit(e) {
    e.preventDefault();
    if (!photos.length) return setError("Add at least one product photo");
    setBusy(true);
    setError("");
    try {
      const form = new FormData(e.target);
      for (const f of photos) form.append("images", f);
      const p = await api("/products", { method: "POST", form });
      nav(`/products/${p.id}`);
    } catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <>
      <h2>Add product</h2>
      <form onSubmit={submit} className="card form">
        <label>Product name *<input name="title" required maxLength={200} /></label>
        <label>Key details (features, size, material…)<textarea name="description" rows={4} /></label>
        <div className="row">
          <label>Price<input name="price" type="number" step="0.01" min="0" /></label>
          <label>Currency<select name="currency" defaultValue="THB"><option>THB</option><option>MMK</option><option>USD</option></select></label>
        </div>
        <label>Shopee / TikTok product link<input name="product_url" type="url" placeholder="https://shopee.co.th/..." /></label>
        <label>Affiliate link (optional — auto-created for Shopee when API is set up)<input name="affiliate_url" type="url" /></label>
        <div className="field">
          <span className="muted">Product photos * (1–4, clear shots from different angles — each becomes part of the video)</span>
          <PhotoPicker files={photos} onChange={setPhotos} />
        </div>
        {error && <p className="error">{error}</p>}
        <button disabled={busy}>{busy ? "Saving…" : "Save product"}</button>
      </form>
    </>
  );
}
