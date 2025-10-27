// workshop_builder/ui/src/routes/support.tsx
import React, { useState } from "react";
import { Link } from "react-router-dom";

export default function Support() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");

  return (
    <section className="space-y-6">
      <div className="relative overflow-hidden rounded-xl hero-gradient animated-gradient px-6 py-8 text-white">
        <div className="mx-auto max-w-5xl">
          <div className="text-xs uppercase tracking-wider text-gray-300">Help</div>
          <h2 className="mt-1 text-2xl font-semibold">Support</h2>
          <p className="mt-2 text-sm text-gray-300">
            Stuck or have a feature request? Send us a note and we’ll get back to you.
          </p>
        </div>
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
      </div>

      <div className="mx-auto max-w-5xl space-y-4">
        <div className="card">
          <h3 className="mb-2 text-base font-semibold">Contact</h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="label">Email</label>
              <input
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                type="email"
                autoComplete="email"
              />
            </div>
            <div>
              <label className="label">Message</label>
              <textarea
                className="textarea"
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
                placeholder="How can we help?"
              />
            </div>
          </div>
          <div className="mt-3">
            <button
              className="btn"
              onClick={() => {
                // placeholder UX
                alert("Thanks! This demo does not send emails yet.");
                setEmail("");
                setMsg("");
              }}
            >
              Send
            </button>
          </div>
        </div>

        <div className="card">
          <h3 className="mb-2 text-base font-semibold">Resources</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
            <li>
              Docs: see the{" "}
              <Link to="/docs" className="text-indigo-600 underline">
                Documentation page
              </Link>
              .
            </li>
            <li>
              Health: verify services on{" "}
              <Link to="/settings" className="text-indigo-600 underline">
                Settings
              </Link>
              .
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
