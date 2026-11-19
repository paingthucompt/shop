import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, LANGS } from "../api.js";

const STAGE = { clip: "Making the product clip…", "render:th": "Adding Thai voice & text…", "render:my": "Adding Myanmar voice & text…", done: "Done" };

function JobDetail({ id, onStatus }) {
  const [job, setJob] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let timer, cancelled = false;
    setJob(null); setError("");
    const load = () => api(`/jobs/${id}`).then((j) => {
      if (cancelled) return; // a response for a job we already navigated away from
      setJob(j);
      onStatus?.(j.id, j.status, j.stage);
      if (j.status === "queued" || j.status === "running") timer = setTimeout(load, 3000);
    }).catch((e) => !cancelled && setError(e.message));
    load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [id]);

  if (error) return <p className="error">{error}</p>;
  if (!job) return <p className="muted">Loading…</p>;
  return (
    <div className="card">
      <h3>Video job #{job.id} — <span className={`status ${job.status}`}>{job.status}</span></h3>
      {job.status !== "succeeded" && <p className="muted">{STAGE[job.stage] || "Waiting in queue…"}</p>}
      {job.error && <p className="error">{job.error}{job.refunded ? ` — ${job.credits_charged} credits refunded` : ""}</p>}
      <div className="videos">
        {job.videos.map((v) => (
          <div key={v.lang} className="video">
            <h4>{LANGS[v.lang]}</h4>
            <video src={v.url} controls playsInline />
            <div className="row">
              <a className="button" href={`${v.url}&download=1`}>Download MP4</a>
              {v.srt_url && <a className="ghost button" href={`${v.srt_url}&download=1`}>Captions .srt</a>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Jobs() {
  const { id } = useParams();
  const [jobs, setJobs] = useState([]);
  useEffect(() => { api("/jobs").then(setJobs).catch(() => {}); }, [id]);
  // keep the list row in sync with the job being watched
  const onStatus = (jobId, status, stage) =>
    setJobs((list) => list.map((j) => (j.id === jobId ? { ...j, status, stage } : j)));
  return (
    <>
      <h2>Videos</h2>
      {id && <JobDetail id={id} onStatus={onStatus} />}
      <table>
        <thead><tr><th>#</th><th>Product</th><th>Languages</th><th>Status</th><th>Created</th></tr></thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id}>
              <td><Link to={`/jobs/${j.id}`}>{j.id}</Link></td>
              <td>{j.product_title}</td>
              <td>{j.langs.join(", ")}</td>
              <td><span className={`status ${j.status}`}>{j.status}</span></td>
              <td>{new Date(j.created_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
