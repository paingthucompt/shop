import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Link, Navigate, useNavigate } from "react-router-dom";
import { api, auth } from "./api.js";
import Login from "./pages/Login.jsx";
import Products from "./pages/Products.jsx";
import NewProduct from "./pages/NewProduct.jsx";
import Product from "./pages/Product.jsx";
import Jobs from "./pages/Jobs.jsx";
import "./style.css";

function Shell({ children }) {
  const [me, setMe] = useState(null);
  const nav = useNavigate();
  useEffect(() => { api("/auth/me").then(setMe).catch(() => {}); }, []);
  if (!auth.token) return <Navigate to="/login" />;
  return (
    <>
      <header>
        <Link to="/" className="brand">Affiliate Video Studio</Link>
        <nav>
          <Link to="/">Products</Link>
          <Link to="/jobs">Videos</Link>
        </nav>
        <span className="credits">{me ? `${me.credits} credits` : ""}</span>
        <button className="ghost" onClick={() => { auth.token = null; nav("/login"); }}>Log out</button>
      </header>
      <main>{children}</main>
    </>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Shell><Products /></Shell>} />
        <Route path="/products/new" element={<Shell><NewProduct /></Shell>} />
        <Route path="/products/:id" element={<Shell><Product /></Shell>} />
        <Route path="/jobs" element={<Shell><Jobs /></Shell>} />
        <Route path="/jobs/:id" element={<Shell><Jobs /></Shell>} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
