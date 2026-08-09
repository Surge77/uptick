import { auth, signIn } from "@/auth";
import { redirect } from "next/navigation";

export default async function SignInPage() {
  const session = await auth();
  if (session?.user?.id) {
    redirect("/");
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
      }}
    >
      <div style={{ width: "min(360px, 100%)", textAlign: "center" }}>
        <h1 style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>Uptick</h1>
        <p style={{ color: "var(--muted)", marginTop: 0, marginBottom: "2rem" }}>
          Sign in to view your monitors.
        </p>

        <form
          action={async () => {
            "use server";
            await signIn("github", { redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            style={{
              width: "100%",
              padding: "0.7rem 1rem",
              background: "var(--panel)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              fontSize: "0.95rem",
              cursor: "pointer",
            }}
          >
            Continue with GitHub
          </button>
        </form>
      </div>
    </main>
  );
}
