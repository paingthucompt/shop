import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";

export default function Products() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { api("/products").then(setItems).catch((e) => setError(e.message)); }, []);

  return (
    <>
      <div className="row between">
        <h2>Products</h2>
        <Link to="/products/new" className="button">+ Add product</Link>
      </div>
      {error && <p className="error">{error}</p>}
      {items && !items.length && <p className="muted">No products yet. Add one with 1–4 photos to start.</p>}
      <div className="grid">
        {items?.map((p) => (
          <Link key={p.id} to={`/products/${p.id}`} className="card product">
            {p.images[0]?.url && <img src={p.images[0].url} alt="" />}
            <strong>{p.title}</strong>
            {p.price && <span className="muted">{p.price} {p.currency}</span>}
          </Link>
        ))}
      </div>
    </>
  );
}
