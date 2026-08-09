import Link from "next/link";

export default function NotFound() {
  return (
    <main className="center-screen">
      <div style={{ maxWidth: "400px", textAlign: "center" }}>
        <div className="label" style={{ letterSpacing: "0.12em" }}>
          404
        </div>
        <h1 style={{ marginTop: "0.35rem" }}>Not found</h1>
        <p className="muted" style={{ marginTop: "0.5rem", marginBottom: "1.75rem" }}>
          That page does not exist, or you do not have access to it.
        </p>
        <Link href="/" className="btn">
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
